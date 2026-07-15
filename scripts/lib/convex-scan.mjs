/**
 * Shared Convex read-cost scanner.
 *
 * Single source of truth for the static anti-pattern rules, used by BOTH
 * scripts/check-convex-readcost.mjs (the CI ratchet) and scripts/perf-audit.mjs
 * (`csoi perf`). Kept in one place on purpose: duplicated helpers rotting
 * independently is itself one of the root causes catalogued in
 * Docs/2026-07-14-convex-database-optimization-playbook.md (the indexed
 * `listOpsUserIds` existed while a full-scan copy ran on every job write).
 *
 * Rules map to convex/CLAUDE.md:
 *   bare-scan          R1  query chain reaching a terminator with no .withIndex()
 *   post-index-filter  R2  .filter() inside the chain — does NOT bound reads
 *   giant-take         R4  .take(N >= 5000) — a scan wearing a seatbelt
 *   query-in-loop      R3  ctx.db.query() inside a .map()/for body — a query PER ROW
 *
 * Deliberately NOT flagged: `ctx.db.get()` inside `Promise.all(ids.map(...))` over a
 * de-duplicated id set. That is the CORRECT batching pattern (see enrichJobs), and
 * flagging it would bury the real findings in false positives. `query-in-loop` only
 * fires on a full .query() per row, which is nearly always wrong.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const TERMINATORS = [".collect(", ".take(", ".first(", ".unique(", ".paginate("];
export const GIANT_TAKE_THRESHOLD = 5000;
const CHAIN_WINDOW = 1500; // chars — generous enough for multi-line chains
const LOOP_WINDOW = 2000;

export const RULE_HELP = {
  "bare-scan": "full table scan — bound it with .withIndex(range) (R1)",
  "post-index-filter": ".filter() does NOT reduce docs scanned — use an index (R2)",
  "giant-take": ".take(>=5000) — bound the range instead (R4)",
  "query-in-loop": "a full query PER ROW — batch it, resolve in memory (R3)",
};

/** Recursively list .ts sources under a dir, skipping generated + tests. */
export function listSourceFiles(dir) {
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

export function lineOf(source, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (source[i] === "\n") line++;
  return line;
}

/**
 * Blank out comments (and string bodies) so rules never fire on prose.
 *
 * Without this, a `/* … for (property, period) … *\/` docstring was reported as a
 * query-in-loop, and any comment mentioning db.query would count as a scan. Every
 * character is replaced with a space rather than removed, and newlines are kept, so
 * indices/line numbers remain exactly aligned with the original source.
 *
 * String bodies are blanked too: a table name inside a comment-like string can't
 * trip a rule, and no rule needs to read string CONTENT (only the shape of the
 * chain). Quote characters themselves are preserved so `.query("x")` still parses.
 */
export function stripCommentsAndStrings(source) {
  const out = source.split("");
  let i = 0;
  const n = source.length;
  let state = "code";
  while (i < n) {
    const c = source[i];
    const d = source[i + 1];
    if (state === "code") {
      if (c === "/" && d === "/") {
        out[i] = out[i + 1] = " ";
        state = "line";
        i += 2;
        continue;
      }
      if (c === "/" && d === "*") {
        out[i] = out[i + 1] = " ";
        state = "block";
        i += 2;
        continue;
      }
      if (c === "'") state = "squote";
      else if (c === '"') state = "dquote";
      else if (c === "`") state = "backtick";
      i++;
      continue;
    }
    if (state === "line") {
      if (c === "\n") state = "code";
      else out[i] = " ";
      i++;
      continue;
    }
    if (state === "block") {
      if (c === "*" && d === "/") {
        out[i] = out[i + 1] = " ";
        state = "code";
        i += 2;
        continue;
      }
      if (c !== "\n") out[i] = " ";
      i++;
      continue;
    }
    // inside a string literal
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (
      (state === "squote" && c === "'") ||
      (state === "dquote" && c === '"') ||
      (state === "backtick" && c === "`")
    ) {
      state = "code";
      i++;
      continue;
    }
    if (c !== "\n") out[i] = " ";
    i++;
  }
  return out.join("");
}

/** Walk forward from `start` to the matching `;` at depth 0 (or a window cap). */
function chainWindowAt(source, start, cap = CHAIN_WINDOW) {
  let depth = 0;
  const end = Math.min(source.length, start + cap);
  for (let i = start; i < end; i++) {
    const ch = source[i];
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (ch === ";" && depth <= 0) return source.slice(start, i + 1);
  }
  return source.slice(start, end);
}

/** Resolve `const NAME = 5000;` declared in the same file. */
function resolveNumericConst(source, name) {
  const m = source.match(new RegExp(`const\\s+${name}\\s*=\\s*([\\d_]+)\\s*;`));
  return m ? Number(m[1].replaceAll("_", "")) : null;
}

/**
 * Map exported Convex functions to their line ranges, so a violation can be
 * attributed to `properties/queries.getAll` rather than just a line number. That
 * attribution is what lets the blast-radius pass cross-reference client mounts.
 */
export function mapExportedFunctions(rawSource) {
  const source = stripCommentsAndStrings(rawSource);
  const re =
    /export\s+const\s+([a-zA-Z0-9_]+)\s*=\s*(query|mutation|action|internalQuery|internalMutation|internalAction)\s*\(/g;
  const fns = [];
  let m;
  while ((m = re.exec(source)) !== null) {
    fns.push({ name: m[1], kind: m[2], start: lineOf(source, m.index) });
  }
  for (let i = 0; i < fns.length; i++) {
    fns[i].end = i + 1 < fns.length ? fns[i + 1].start - 1 : Infinity;
  }
  return fns;
}

export function functionAtLine(fns, line) {
  return fns.find((f) => line >= f.start && line <= f.end) ?? null;
}

/**
 * Extract the BALANCED region starting at the first `open` char at/after `from`.
 * Returns "" if no opener is found nearby.
 *
 * Why this exists: the chain-walker above stops at the first `;` at depth 0, which
 * is right for a `db.query(...)....collect();` chain but WRONG for a loop — a
 * `for (…) { … }` body contains no depth-0 `;`, so the walker sails past the closing
 * brace and swallows the NEXT statement. That produced a flood of false positives
 * (a `for` loop doing ctx.db.delete followed by an unrelated ctx.db.query got
 * flagged). Loops need brace-matching, not semicolon-hunting.
 */
function balancedFrom(source, from, open, close, cap) {
  const start = source.indexOf(open, from);
  if (start === -1 || start > from + 300) return "";
  let depth = 0;
  const end = Math.min(source.length, start + cap);
  for (let i = start; i < end; i++) {
    if (source[i] === open) depth++;
    else if (source[i] === close) {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return "";
}

/**
 * Find `ctx.db.query(` executed once per row inside a .map()/.forEach()/for body.
 * `scan` is the comment/string-stripped source (detection); `source` is the original
 * (snippets). Their indices are identical by construction.
 */
function findQueryInLoop(scan, source) {
  const out = [];
  const re = /\.map\(|\.forEach\(|\bfor\s*\(/g;
  let m;
  while ((m = re.exec(scan)) !== null) {
    const isFor = m[0].startsWith("for");
    let body;
    if (isFor) {
      // Skip the `(init; cond; step)` / `(const x of xs)` header, then take `{ … }`.
      const header = balancedFrom(scan, m.index, "(", ")", 400);
      if (!header) continue;
      body = balancedFrom(scan, m.index + header.length, "{", "}", LOOP_WINDOW);
    } else {
      // `.map(` / `.forEach(` — the callback lives inside the call's parens.
      body = balancedFrom(scan, m.index, "(", ")", LOOP_WINDOW);
    }
    if (!body) continue;

    // Only a full query PER ROW. `ctx.db.get()` inside `Promise.all(ids.map(...))`
    // over a de-duplicated id set is the CORRECT batching pattern (see enrichJobs)
    // and is deliberately not flagged — flagging it would bury the real findings.
    if (!/ctx\.db\s*\.\s*query\(/.test(body)) continue;

    out.push({
      rule: "query-in-loop",
      line: lineOf(scan, m.index),
      snippet: source.slice(m.index, m.index + 110).split("\n")[0].trim(),
    });
  }
  return out;
}

/** All static violations in one file's source. */
export function findViolations(source) {
  // Detect on the stripped source so comments/strings can never trip a rule; slice
  // snippets from the ORIGINAL so the report stays readable. Indices align because
  // stripCommentsAndStrings preserves length and newlines.
  const scan = stripCommentsAndStrings(source);
  const violations = [];
  const re = /\bdb\.query\(/g;
  let match;
  while ((match = re.exec(scan)) !== null) {
    const chain = chainWindowAt(scan, match.index);
    const line = lineOf(scan, match.index);
    const hasIndex = chain.includes(".withIndex(") || chain.includes(".withSearchIndex(");
    const terminator = TERMINATORS.find((t) => chain.includes(t));
    const snippet = source.slice(match.index, match.index + 110).split("\n")[0].trim();

    if (terminator && !hasIndex) violations.push({ rule: "bare-scan", line, snippet });

    const terminatorIdx = terminator ? chain.indexOf(terminator) : chain.length;
    const filterIdx = chain.indexOf(".filter(");
    if (filterIdx !== -1 && filterIdx < terminatorIdx) {
      violations.push({ rule: "post-index-filter", line, snippet });
    }

    const takeMatch = chain.match(/\.take\(\s*([A-Z_0-9]+|\d+)/);
    if (takeMatch) {
      const raw = takeMatch[1];
      const num = /^\d+$/.test(raw) ? Number(raw) : resolveNumericConst(scan, raw);
      if (num !== null && num >= GIANT_TAKE_THRESHOLD) {
        violations.push({ rule: "giant-take", line, snippet });
      }
    }
  }
  violations.push(...findQueryInLoop(scan, source));
  return violations;
}

/**
 * Scan a convex/ dir. Returns { counts, detail } where counts is
 * { relPath: { rule: n } } (the ratchet's shape) and detail carries lines +
 * owning function names. `onProgress(done, total)` is optional and fires per file.
 */
export function scanConvexDir(convexDir, repoRoot, onProgress) {
  const counts = {};
  const detail = {};
  const files = listSourceFiles(convexDir);
  for (const [i, file] of files.entries()) {
    onProgress?.(i + 1, files.length);
    const source = readFileSync(file, "utf8");
    const violations = findViolations(source);
    if (violations.length === 0) continue;
    const rel = file.replace(`${repoRoot}/`, "");
    const fns = mapExportedFunctions(source);
    detail[rel] = violations.map((v) => ({
      ...v,
      fn: functionAtLine(fns, v.line)?.name ?? null,
      kind: functionAtLine(fns, v.line)?.kind ?? null,
    }));
    counts[rel] = {};
    for (const v of violations) counts[rel][v.rule] = (counts[rel][v.rule] ?? 0) + 1;
  }
  return { counts, detail };
}

export function totalOf(counts) {
  return Object.values(counts)
    .flatMap((r) => Object.values(r))
    .reduce((a, b) => a + b, 0);
}
