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
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { scanConvexDir, totalOf, RULE_HELP } from "./lib/convex-scan.mjs";

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

/** Components that mount on (nearly) every screen — a heavy query here is worst-case. */
const ALWAYS_MOUNTED = /(layout|header|sidebar|nav|shell|topbar)/i;
const DOC_FAT_BYTES = 4096; // flag tables whose average document exceeds this

// ---------------------------------------------------------------- 1. static scan
const { counts, detail } = scanConvexDir(join(ROOT, "convex"), ROOT);
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

const blast = [];
for (const [file, hits] of Object.entries(detail)) {
  const module = file.replace(/^convex\//, "").replace(/\.ts$/, "");
  const byFn = new Map();
  for (const h of hits) {
    if (!h.fn || !h.kind?.startsWith("query")) continue; // only client-subscribable
    if (!byFn.has(h.fn)) byFn.set(h.fn, []);
    byFn.get(h.fn).push(h.rule);
  }
  for (const [fn, rules] of byFn) {
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

    // Reuse the snapshot export: all tables in ~7s, far cheaper than per-table reads.
    execFileSync("npx", ["convex", "export", "--path", zip], {
      cwd: ROOT,
      stdio: "ignore",
      env: { ...process.env, CONVEX_DEPLOY_KEY: key },
    });
    execFileSync("unzip", ["-qo", zip, "-d", join(tmp, "x")], { stdio: "ignore" });

    docs = [];
    const base = join(tmp, "x");
    for (const table of readdirSync(base, { withFileTypes: true })) {
      if (!table.isDirectory() || table.name.startsWith("_")) continue;
      const jsonl = join(base, table.name, "documents.jsonl");
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
        table: table.name,
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

// ------------------------------------------------------------------- 4. verdict
const knownTotal = totalOf(counts);
const fatTables = Array.isArray(docs) ? docs.filter((d) => d.fat) : [];
const verdict = regressions.length > 0 ? "FAIL" : blast.length > 0 || fatTables.length ? "WARN" : "PASS";

if (JSON_OUT) {
  console.log(
    JSON.stringify(
      {
        verdict,
        regressions: regressions.map((r) => ({
          file: r.file,
          rule: r.rule,
          was: r.was,
          now: r.now,
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
console.log(C.b("\nConvex performance audit") + C.dim("  (csoi perf)\n"));

console.log(C.b("1. QUERY HEALTH — new violations vs baseline"));
if (regressions.length === 0) {
  console.log(`   ${C.grn("✓")} no new violations`);
} else {
  for (const r of regressions) {
    console.log(`   ${C.red("✖")} ${r.file}  ${C.b(r.rule)}  ${r.was} → ${r.now}`);
    console.log(`       ${C.dim(RULE_HELP[r.rule] ?? "")}`);
    for (const h of r.hits) {
      console.log(`       L${h.line}${h.fn ? ` (${h.fn})` : ""}: ${C.dim(h.snippet)}`);
    }
  }
}
console.log(
  C.dim(`   known debt: ${knownTotal} violations across ${Object.keys(counts).length} files (within baseline)`),
);
if (improved > 0) {
  console.log(C.grn(`   ${improved} file/rule count(s) improved — ratchet down: npm run check:convex-readcost -- --update-baseline`));
}

console.log(C.b("\n2. BLAST RADIUS — violating queries × client subscriptions"));
if (blast.length === 0) {
  console.log(`   ${C.grn("✓")} no violating query is client-subscribed`);
} else {
  for (const b of blast.slice(0, 8)) {
    const flag = b.alwaysMounted.length ? C.red("ALWAYS-MOUNTED") : C.yel("mounted");
    console.log(
      `   ${flag} ${C.b(b.fn)}  ${b.rules.join(",")}  ${b.mounts} mount(s)` +
        (b.alwaysMounted.length ? C.dim(`  [${b.alwaysMounted.join(", ")}]`) : ""),
    );
  }
  console.log(C.dim("   reactive cost = per-exec reads × writes to that range × subscribers"));
}

if (WITH_DOCS) {
  console.log(C.b("\n3. DOCUMENT WEIGHT — live prod snapshot"));
  if (!Array.isArray(docs)) {
    console.log(`   ${C.red("✖")} ${docs?.error}`);
  } else {
    for (const d of docs.slice(0, 8)) {
      const mark = d.fat ? C.red("⚠") : C.grn("✓");
      console.log(
        `   ${mark} ${d.table.padEnd(24)} ${String(d.avgBytes).padStart(6)} B/doc  ${String(d.rows).padStart(6)} rows` +
          (d.fattestField ? C.dim(`  fattest: ${d.fattestField} (${d.fattestPct}%)`) : ""),
      );
    }
    console.log(C.dim(`   ctx.db.get() reads the WHOLE document — fat docs tax every read of that table`));
  }
}

console.log(
  "\n" +
    C.b("VERDICT: ") +
    (verdict === "FAIL" ? C.red(verdict) : verdict === "WARN" ? C.yel(verdict) : C.grn(verdict)) +
    (regressions.length ? C.red(`  ${regressions.length} regression(s)`) : ""),
);
console.log(
  C.dim(
    "Static proxy only — real per-function read bytes live on the Convex dashboard\n" +
      "(Usage → Database I/O → breakdown by function). `convex insights` refuses deploy keys.\n" +
      "Rules: convex/CLAUDE.md · Why: Docs/2026-07-14-convex-database-optimization-playbook.md\n",
  ),
);

process.exit(STRICT && regressions.length > 0 ? 1 : 0);
