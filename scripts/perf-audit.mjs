#!/usr/bin/env node
/**
 * `csoi perf` — Convex performance audit.
 *
 * Run this MANUALLY after a feature and paste the report; it is designed so a
 * reviewer (human or AI) can judge the change from the report alone, without
 * re-reading the codebase.
 *
 * It answers three questions:
 *   1. Did we write bad queries?          -> static anti-pattern scan (convex/CLAUDE.md R1-R4)
 *   2. Did we make something ELSE worse?  -> diff vs the committed ratchet baseline
 *   3. Is the code in good shape?         -> blast radius + document weight + a verdict
 *
 * Every finding carries a plain-English "what it means" so the report is readable
 * without knowing the rule names — the rule ids (bare-scan, query-in-loop, …) are
 * the ratchet's vocabulary, not something a reader should have to memorise.
 *
 * WHAT IT CANNOT DO: pull real per-function read bytes. `npx convex insights`
 * requires interactive user auth and explicitly refuses deploy keys, so billing
 * ground truth stays on the dashboard (Usage -> Database I/O -> breakdown by
 * function). This tool is the cheap proxy you can run every time; the dashboard is
 * the weekly truth. See Docs/2026-07-14-convex-database-optimization-playbook.md.
 *
 * Usage:
 *   csoi perf                 # report
 *   csoi perf --json          # machine-readable (paste this to an AI reviewer)
 *   csoi perf --docs          # + live document-weight scan (exports prod, ~10s)
 *   csoi perf --strict        # exit 1 on regressions (for CI / pre-push)
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { scanConvexDir, totalOf } from "./lib/convex-scan.mjs";
import { progress, table, wrap } from "./lib/report-ui.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = join(ROOT, "scripts", "convex-readcost-baseline.json");

const argv = process.argv.slice(2);
const JSON_OUT = argv.includes("--json");
const WITH_DOCS = argv.includes("--docs");
const STRICT = argv.includes("--strict");

const C = {
  red: (s) => (JSON_OUT ? s : `\x1b[31m${s}\x1b[0m`),
  yel: (s) => (JSON_OUT ? s : `\x1b[33m${s}\x1b[0m`),
  grn: (s) => (JSON_OUT ? s : `\x1b[32m${s}\x1b[0m`),
  dim: (s) => (JSON_OUT ? s : `\x1b[2m${s}\x1b[0m`),
  b: (s) => (JSON_OUT ? s : `\x1b[1m${s}\x1b[0m`),
};

const p = progress(!JSON_OUT && process.stderr.isTTY);

/**
 * Plain-English gloss per rule id, in two lengths. RULE_HELP (in convex-scan.mjs)
 * is the terse reviewer-facing hint shared with the ratchet; this is the version
 * for someone reading the report cold.
 *
 * `tag` is what goes in a table cell — it has to survive being read at a glance in
 * ~20 columns, so it says the symptom, not the fix. `what`/`fix` are the long form,
 * shown once in a legend under the table rather than repeated on every row (that
 * repetition is what made the old report unreadable).
 */
const PLAIN = {
  "bare-scan": {
    tag: "scans whole table",
    what: "reads every row in the table to answer one question, so it gets slower and pricier as the table grows",
    fix: "bound it with an index range (R1)",
  },
  "post-index-filter": {
    tag: "filters after reading",
    what: "throws rows away AFTER reading them — you already paid for every one",
    fix: "move the condition into the index (R2)",
  },
  "giant-take": {
    tag: "grabs 5,000+ rows",
    what: "pulls 5,000+ rows in one go — a table scan wearing a seatbelt",
    fix: "bound the range, not the count (R4)",
  },
  "query-in-loop": {
    tag: "1 query per row",
    what: "runs a separate query for EVERY row — 100 rows means 100 queries",
    fix: "batch the reads and join in memory (R3)",
  },
};
const plainTag = (rule) => PLAIN[rule]?.tag ?? rule;
const plainWhat = (rule) => PLAIN[rule]?.what ?? rule;
const plainFix = (rule) => PLAIN[rule]?.fix ?? "";

/** Legend for the rule tags actually present, so jargon is explained once, not per row. */
function legend(rules) {
  const seen = [...new Set(rules)].filter((r) => PLAIN[r]);
  if (seen.length === 0) return "";
  const w = Math.max(...seen.map((r) => plainTag(r).length));
  const body = Math.max(30, (process.stdout.columns || 100) - w - 8);
  const rows = seen.map((r) =>
    wrap(`${plainWhat(r)} → ${plainFix(r)}`, body)
      .map((line, i) => C.dim(`     ${(i === 0 ? plainTag(r) : "").padEnd(w)}  ${line}`))
      .join("\n"),
  );
  return C.dim("\n   what those mean:\n") + rows.join("\n");
}

/** Middle-truncate so both the module and the function name stay legible. */
function ellipsis(s, max) {
  if (s.length <= max) return s;
  const head = Math.ceil((max - 1) / 2);
  return `${s.slice(0, head)}…${s.slice(s.length - (max - 1 - head))}`;
}

/** Components that mount on (nearly) every screen — a heavy query here is worst-case. */
const ALWAYS_MOUNTED = /(layout|header|sidebar|nav|shell|topbar)/i;
const DOC_FAT_BYTES = 4096; // flag tables whose average document exceeds this

const fmtBytes = (n) => (n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`);

// ---------------------------------------------------------------- 1. static scan
const { counts, detail } = scanConvexDir(join(ROOT, "convex"), ROOT, (done, total) =>
  p.step("scanning convex/", done, total),
);
const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : {};

const regressions = [];
let improved = 0;
for (const file of new Set([...Object.keys(counts), ...Object.keys(baseline)])) {
  const rules = new Set([
    ...Object.keys(counts[file] ?? {}),
    ...Object.keys(baseline[file] ?? {}),
  ]);
  for (const rule of rules) {
    const now = counts[file]?.[rule] ?? 0;
    const was = baseline[file]?.[rule] ?? 0;
    if (now > was) {
      regressions.push({
        file,
        rule,
        was,
        now,
        hits: (detail[file] ?? []).filter((v) => v.rule === rule),
      });
    } else if (now < was) improved++;
  }
}

// ------------------------------------------------- 2. blast radius (client mounts)
function clientMountsFor(module, fn) {
  // module: "properties/queries" -> api.properties.queries.<fn>
  const apiPath = `api.${module.split("/").join(".")}.${fn}`;
  const roots = [join(ROOT, "src"), join(ROOT, "..", "jna-cleaners-app")];
  const files = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    try {
      const out = execFileSync(
        "grep",
        ["-rl", "--include=*.tsx", "--include=*.ts", "-F", apiPath, root],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      );
      files.push(...out.trim().split("\n").filter(Boolean));
    } catch {
      /* grep exits 1 when nothing matches */
    }
  }
  return files.filter((f) => !f.includes("/node_modules/"));
}

// Collect the candidate functions first so the progress bar has a real denominator
// (one grep per function over two repos is the slowest part of a plain run).
const candidates = [];
for (const [file, hits] of Object.entries(detail)) {
  const module = file.replace(/^convex\//, "").replace(/\.ts$/, "");
  const byFn = new Map();
  for (const h of hits) {
    if (!h.fn || !h.kind?.startsWith("query")) continue; // only client-subscribable
    if (!byFn.has(h.fn)) byFn.set(h.fn, []);
    byFn.get(h.fn).push(h.rule);
  }
  for (const [fn, rules] of byFn) candidates.push({ module, fn, rules });
}

const blast = [];
for (const [i, { module, fn, rules }] of candidates.entries()) {
  p.step("checking UI usage", i + 1, candidates.length);
  const mounts = clientMountsFor(module, fn);
  if (mounts.length === 0) continue;
  const always = mounts.filter((m) => ALWAYS_MOUNTED.test(m));
  blast.push({
    fn: `${module}.${fn}`,
    rules: [...new Set(rules)],
    mounts: mounts.length,
    alwaysMounted: always.map((m) => m.split("/").pop()),
    // severity: a cheap query on 10 always-mounted screens beats an ugly rare one
    score: mounts.length * (always.length ? 3 : 1) * rules.length,
  });
}
blast.sort((a, b) => b.score - a.score);

// ------------------------------------------------- 3. document weight (opt-in, live)
let docs = null;
if (WITH_DOCS) {
  const tmp = mkdtempSync(join(tmpdir(), "csoi-perf-"));
  const zip = join(tmp, "snap.zip");
  try {
    let key = process.env.PROD_CONVEX_DEPLOY_KEY;
    if (!key && existsSync(join(ROOT, ".env.local"))) {
      const m = readFileSync(join(ROOT, ".env.local"), "utf8").match(
        /^PROD_CONVEX_DEPLOY_KEY=(.*)$/m,
      );
      if (m) key = m[1].trim().replace(/^["']|["']$/g, "");
    }
    if (!key) throw new Error("PROD_CONVEX_DEPLOY_KEY not found");

    // Convex's export is a sync child process, so it blocks the event loop — no
    // animated spinner is possible here, just an honest "this will take a while".
    p.note("exporting prod snapshot (~10s)…");

    // Reuse the snapshot export: all tables in ~7s, far cheaper than per-table reads.
    execFileSync("npx", ["convex", "export", "--path", zip], {
      cwd: ROOT,
      stdio: "ignore",
      env: { ...process.env, CONVEX_DEPLOY_KEY: key },
    });
    execFileSync("unzip", ["-qo", zip, "-d", join(tmp, "x")], { stdio: "ignore" });

    docs = [];
    const base = join(tmp, "x");
    const tables = readdirSync(base, { withFileTypes: true }).filter(
      (t) => t.isDirectory() && !t.name.startsWith("_"),
    );
    for (const [i, tbl] of tables.entries()) {
      p.step("weighing tables", i + 1, tables.length);
      const jsonl = join(base, tbl.name, "documents.jsonl");
      if (!existsSync(jsonl)) continue;
      const lines = readFileSync(jsonl, "utf8").split("\n").filter(Boolean);
      if (lines.length === 0) continue;
      const sample = lines.slice(0, 50).map((l) => JSON.parse(l));
      const totalBytes = sample.reduce((a, d) => a + Buffer.byteLength(JSON.stringify(d)), 0);
      const avg = Math.round(totalBytes / sample.length);
      // fattest field, averaged across the sample
      const fieldBytes = {};
      for (const d of sample) {
        for (const [k, v] of Object.entries(d)) {
          fieldBytes[k] = (fieldBytes[k] ?? 0) + Buffer.byteLength(JSON.stringify(v));
        }
      }
      const [fatField, fatBytes] = Object.entries(fieldBytes).sort((a, b) => b[1] - a[1])[0] ?? [];
      docs.push({
        table: tbl.name,
        rows: lines.length,
        avgBytes: avg,
        fattestField: fatField ?? null,
        fattestPct: fatField ? Math.round(((fatBytes / sample.length) / avg) * 100) : 0,
        fat: avg > DOC_FAT_BYTES,
      });
    }
    docs.sort((a, b) => b.avgBytes - a.avgBytes);
  } catch (e) {
    docs = { error: String(e.message ?? e) };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

p.done();

// ------------------------------------------------------------------- 4. verdict
const knownTotal = totalOf(counts);
const fatTables = Array.isArray(docs) ? docs.filter((d) => d.fat) : [];
const verdict = regressions.length > 0 ? "FAIL" : blast.length > 0 || fatTables.length ? "WARN" : "PASS";

const VERDICT_MEANS = {
  FAIL: "This change ADDED new expensive queries — fix them before merging.",
  WARN: "You added nothing new, but expensive queries that were already there are live in the UI (see 2). Not urgent — worth a ticket.",
  PASS: "No new expensive queries, and none of the existing ones are wired to a screen.",
};

if (JSON_OUT) {
  console.log(
    JSON.stringify(
      {
        verdict,
        verdictMeans: VERDICT_MEANS[verdict],
        regressions: regressions.map((r) => ({
          file: r.file,
          rule: r.rule,
          was: r.was,
          now: r.now,
          means: plainWhat(r.rule),
          fix: plainFix(r.rule),
          hits: r.hits.map((h) => ({ line: h.line, fn: h.fn, snippet: h.snippet })),
        })),
        knownDebt: { total: knownTotal, files: Object.keys(counts).length },
        improved,
        blastRadius: blast.slice(0, 10),
        documentWeight: docs,
        note: "Static proxy only. Real per-function read bytes require the Convex dashboard (Usage > Database I/O > by function) — `convex insights` refuses deploy keys.",
      },
      null,
      2,
    ),
  );
  process.exit(STRICT && regressions.length > 0 ? 1 : 0);
}

// -------------------------------------------------------------------- 5. report
const TBL = { dim: C.dim };

console.log(C.b("\nConvex performance audit") + C.dim("  (csoi perf)\n"));

console.log(C.b("1. QUERY HEALTH") + C.dim("  — did this change add bad queries?"));
if (regressions.length === 0) {
  console.log(`   ${C.grn("✓")} no new violations — nothing you wrote made reads more expensive`);
} else {
  console.log(
    table(
      [
        { key: "file", header: "file" },
        { key: "problem", header: "problem" },
        { key: "count", header: "was → now", align: "right" },
        { key: "means", header: "what it means", flex: true },
      ],
      regressions.map((r) => ({
        file: C.red(r.file.replace(/^convex\//, "")),
        problem: plainTag(r.rule),
        count: `${r.was} → ${C.b(r.now)}`,
        means: `This ${plainWhat(r.rule)}. Fix: ${plainFix(r.rule)}.`,
      })),
      TBL,
    ),
  );
  console.log(C.dim("\n   where:"));
  for (const r of regressions) {
    for (const h of r.hits) {
      console.log(
        C.dim(`     ${r.file}:${h.line}${h.fn ? ` (${h.fn})` : ""}  ${h.snippet}`),
      );
    }
  }
}
console.log(
  C.dim(
    `   known debt: ${knownTotal} violations across ${Object.keys(counts).length} files — pre-existing, already in the baseline`,
  ),
);
if (improved > 0) {
  console.log(
    C.grn(`   ${improved} file/rule count(s) improved`) +
      C.dim(" — lock the win in: npm run check:convex-readcost -- --update-baseline"),
  );
}

console.log(C.b("\n2. BLAST RADIUS") + C.dim("  — which bad queries are actually live in the UI?"));
if (blast.length === 0) {
  console.log(`   ${C.grn("✓")} no violating query is subscribed by a screen`);
} else {
  const shown = blast.slice(0, 8);
  console.log(
    table(
      [
        { key: "fn", header: "query" },
        { key: "mounts", header: "screens", align: "right" },
        { key: "means", header: "what it means", flex: true },
      ],
      shown.map((b) => {
        const tags = b.rules.map(plainTag).join(" + ");
        const symptom = tags.charAt(0).toUpperCase() + tags.slice(1);
        const screens = `${b.mounts} screen${b.mounts === 1 ? "" : "s"}`;
        const reach = b.alwaysMounted.length
          ? C.red(`on EVERY page (${b.alwaysMounted.join(", ")}) — fix first`)
          : b.mounts >= 3
            ? C.yel(`on ${screens} — worth fixing`)
            : C.dim(`on ${screens} — low priority`);
        return {
          fn: C.b(ellipsis(b.fn, 34)),
          mounts: String(b.mounts),
          means: `${symptom}, ${reach}`,
        };
      }),
      TBL,
    ),
  );
  console.log(legend(shown.flatMap((b) => b.rules)));
  console.log(
    C.dim("\n   reactive cost = reads per run × writes to that range × subscribers"),
  );
}

if (WITH_DOCS) {
  console.log(C.b("\n3. DOCUMENT WEIGHT") + C.dim("  — how fat is one row in prod?"));
  if (!Array.isArray(docs)) {
    console.log(`   ${C.red("✖")} ${docs?.error}`);
  } else {
    console.log(
      table(
        [
          { key: "mark", header: " " },
          { key: "table", header: "table" },
          { key: "avg", header: "per row", align: "right" },
          { key: "rows", header: "rows", align: "right" },
          { key: "means", header: "what it means", flex: true },
        ],
        docs.slice(0, 8).map((d) => ({
          mark: d.fat ? C.red("⚠") : C.grn("✓"),
          table: d.fat ? C.red(d.table) : d.table,
          avg: fmtBytes(d.avgBytes),
          rows: String(d.rows),
          means: d.fat
            ? `Every read pays the full ${fmtBytes(d.avgBytes)}` +
              (d.fattestField ? ` — "${d.fattestField}" is ${d.fattestPct}% of it.` : ".")
            : C.dim("Cheap to read."),
        })),
        TBL,
      ),
    );
    console.log(
      C.dim("\n   ctx.db.get() reads the WHOLE document — fat rows tax every read of that table"),
    );
  }
}

const vColor = verdict === "FAIL" ? C.red : verdict === "WARN" ? C.yel : C.grn;
console.log(
  "\n" +
    C.b("VERDICT: ") +
    vColor(C.b(verdict)) +
    (regressions.length ? C.red(`  ${regressions.length} regression(s)`) : ""),
);
console.log(C.dim(`   ${VERDICT_MEANS[verdict]}`));
console.log(
  C.dim(
    "\nStatic proxy only — real per-function read bytes live on the Convex dashboard\n" +
      "(Usage → Database I/O → breakdown by function). `convex insights` refuses deploy keys.\n" +
      "Rules: convex/CLAUDE.md · Why: Docs/2026-07-14-convex-database-optimization-playbook.md\n",
  ),
);

process.exit(STRICT && regressions.length > 0 ? 1 : 0);
