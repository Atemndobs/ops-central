#!/usr/bin/env node
/**
 * Convex read-cost static checker — the enforcement layer for convex/CLAUDE.md.
 *
 * Born from the 2026-07-14 incident (10.66 GB reads vs a 6 GB cap from an
 * 8-property dataset). See Docs/2026-07-14-convex-database-optimization-playbook.md.
 *
 * Flags three statically-detectable anti-patterns in convex/**:
 *   bare-scan          ctx.db.query(...) chain that reaches .collect/.take/.first/
 *                      .unique/.paginate without a .withIndex/.withSearchIndex —
 *                      a full table scan (AP1/R1).
 *   post-index-filter  .filter(...) inside a query chain — does NOT reduce docs
 *                      scanned; the predicate belongs in an index (AP2/R2).
 *   giant-take         .take(N) with N >= 5000 — a scan wearing a seatbelt (R4).
 *
 * RATCHET MODEL: scripts/convex-readcost-baseline.json records the per-file,
 * per-rule counts of KNOWN, accepted debt at adoption time. The check FAILS only
 * when a file's count for a rule EXCEEDS its baseline — so new violations cannot
 * land, while existing debt is paid down at leisure. When you fix violations, run
 * with --update-baseline to ratchet the ceiling down (the script refuses to
 * ratchet UP that way unless --force is also passed).
 *
 * Usage:
 *   node scripts/check-convex-readcost.mjs                  # check (CI mode)
 *   node scripts/check-convex-readcost.mjs --update-baseline
 *   node scripts/check-convex-readcost.mjs --update-baseline --force
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { scanConvexDir, totalOf } from "./lib/convex-scan.mjs";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const CONVEX_DIR = join(ROOT, "convex");
const BASELINE_PATH = join(ROOT, "scripts", "convex-readcost-baseline.json");

const UPDATE = process.argv.includes("--update-baseline");
const FORCE = process.argv.includes("--force");

const TERMINATORS = [".collect(", ".take(", ".first(", ".unique(", ".paginate("];
const GIANT_TAKE_THRESHOLD = 5000;
const CHAIN_WINDOW = 1500; // chars — generous enough for multi-line chains

/** Recursively list .ts files under convex/, skipping generated + tests. */
function listSourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "_generated") continue;
      out.push(...listSourceFiles(full));
    } else if (
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".test.ts") &&
      !entry.name.endsWith(".d.ts")
    ) {
      out.push(full);
    }
  }
  return out;
}

function lineOf(source, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (source[i] === "\n") line++;
  return line;
}

/**
 * Extract the query chain starting at `ctx.db.query(` / `.db.query(`:
 * walk forward until a `;` at brace/paren depth 0, or the window limit.
 */
function chainWindowAt(source, start) {
  let depth = 0;
  const end = Math.min(source.length, start + CHAIN_WINDOW);
  for (let i = start; i < end; i++) {
    const ch = source[i];
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (ch === ";" && depth <= 0) return source.slice(start, i + 1);
  }
  return source.slice(start, end);
}

function findViolations(source) {
  const violations = []; // { rule, line, snippet }
  const re = /\bdb\.query\(/g;
  let match;
  while ((match = re.exec(source)) !== null) {
    const chain = chainWindowAt(source, match.index);
    const line = lineOf(source, match.index);
    const hasIndex =
      chain.includes(".withIndex(") || chain.includes(".withSearchIndex(");
    const terminator = TERMINATORS.find((t) => chain.includes(t));
    const snippet = chain.split("\n")[0].trim().slice(0, 110);

    if (terminator && !hasIndex) {
      violations.push({ rule: "bare-scan", line, snippet });
    }
    // `.filter(` on the DB chain (not JS array .filter after collect): only count
    // occurrences BEFORE the terminator, since post-collect .filter is plain JS.
    const terminatorIdx = terminator ? chain.indexOf(terminator) : chain.length;
    const filterIdx = chain.indexOf(".filter(");
    if (filterIdx !== -1 && filterIdx < terminatorIdx) {
      violations.push({ rule: "post-index-filter", line, snippet });
    }
    const takeMatch = chain.match(/\.take\(\s*([A-Z_0-9]+|\d+)/);
    if (takeMatch) {
      const raw = takeMatch[1];
      const num = /^\d+$/.test(raw)
        ? Number(raw)
        : resolveNumericConst(source, raw);
      if (num !== null && num >= GIANT_TAKE_THRESHOLD) {
        violations.push({ rule: "giant-take", line, snippet });
      }
    }
  }
  return violations;
}

/** Resolve `const NAME = 5000;` style constants declared in the same file. */
function resolveNumericConst(source, name) {
  const m = source.match(
    new RegExp(`const\\s+${name}\\s*=\\s*([\\d_]+)\\s*;`),
  );
  return m ? Number(m[1].replaceAll("_", "")) : null;
}

// ---- run ----
const { counts: current, detail } = scanConvexDir(CONVEX_DIR, ROOT);

if (UPDATE) {
  if (existsSync(BASELINE_PATH) && !FORCE) {
    // Refuse to ratchet UP silently.
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
    let regressions = 0;
    for (const [file, rules] of Object.entries(current)) {
      for (const [rule, count] of Object.entries(rules)) {
        if (count > (baseline[file]?.[rule] ?? 0)) regressions++;
      }
    }
    if (regressions > 0) {
      console.error(
        `✖ Refusing to raise the baseline (${regressions} rule-count increase(s)). ` +
          `Fix the new violations, or pass --force with justification in the commit message.`,
      );
      process.exit(1);
    }
  }
  writeFileSync(BASELINE_PATH, JSON.stringify(current, null, 2) + "\n");
  const total = totalOf(current);
  console.log(`✓ Baseline written: ${total} accepted violation(s) across ${Object.keys(current).length} file(s).`);
  process.exit(0);
}

if (!existsSync(BASELINE_PATH)) {
  console.error(
    "✖ No baseline found. Run: node scripts/check-convex-readcost.mjs --update-baseline",
  );
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
let failed = false;
let improved = 0;

const allFiles = new Set([...Object.keys(current), ...Object.keys(baseline)]);
for (const file of [...allFiles].sort()) {
  const rules = new Set([
    ...Object.keys(current[file] ?? {}),
    ...Object.keys(baseline[file] ?? {}),
  ]);
  for (const rule of rules) {
    const now = current[file]?.[rule] ?? 0;
    const was = baseline[file]?.[rule] ?? 0;
    if (now > was) {
      failed = true;
      console.error(`\n✖ ${file}: ${rule} ${was} → ${now} (NEW violation(s))`);
      for (const v of (detail[file] ?? []).filter((v) => v.rule === rule)) {
        console.error(`    L${v.line}: ${v.snippet}`);
      }
    } else if (now < was) {
      improved++;
    }
  }
}

if (failed) {
  console.error(
    "\nRead-cost check FAILED. Convex bills by documents SCANNED — see convex/CLAUDE.md " +
      "and Docs/2026-07-14-convex-database-optimization-playbook.md. " +
      "Bound the read with .withIndex(...) + .take(...), or (rare, justified) update the baseline.",
  );
  process.exit(1);
}

const totalNow = totalOf(current);
console.log(`✓ Read-cost check passed. ${totalNow} known violation(s) within baseline.`);
if (improved > 0) {
  console.log(
    `  ${improved} file/rule count(s) improved — ratchet down with --update-baseline.`,
  );
}
