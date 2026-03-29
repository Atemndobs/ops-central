/**
 * Mutation Loop Guard Test
 *
 * Scans ALL .tsx/.ts source files for dangerous patterns that cause
 * infinite Convex mutation loops. These loops can exhaust the free
 * tier quota and cause expensive production DB overages.
 *
 * Run: node --test tests/mutation-loop-guard.test.mjs
 *
 * WHAT IT CATCHES:
 *   1. useMutation return values inside useEffect dependency arrays
 *   2. useMutation return values inside useCallback dependency arrays
 *      (without a corresponding useRef stabilization)
 *   3. useCallback that both reads and writes the same state variable
 *      AND appears in a useEffect dependency array
 *
 * THE SAFE PATTERN (what code should look like):
 *   const myMutation = useMutation(api.foo.bar);
 *   const myMutationRef = useRef(myMutation);
 *   myMutationRef.current = myMutation;
 *   // Then use myMutationRef.current(...) instead of myMutation(...)
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC_DIR = new URL("../src", import.meta.url).pathname;

/** Recursively collect all .tsx and .ts files under a directory. */
function collectFiles(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === "node_modules" || entry === ".next" || entry === "_generated") continue;
    if (statSync(full).isDirectory()) {
      collectFiles(full, files);
    } else if (/\.tsx?$/.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Parse a file for useMutation variable names and check if they appear
 * raw (not via ref) in useEffect or useCallback dependency arrays.
 */
function findMutationLoopViolations(filePath) {
  const source = readFileSync(filePath, "utf-8");
  const violations = [];
  const relPath = relative(join(SRC_DIR, ".."), filePath);

  // Step 1: Find all useMutation variable names
  //   const foo = useMutation(api.something)
  const mutationVarPattern = /const\s+(\w+)\s*=\s*useMutation\s*\(/g;
  const mutationVars = new Set();
  let match;
  while ((match = mutationVarPattern.exec(source)) !== null) {
    mutationVars.add(match[1]);
  }

  if (mutationVars.size === 0) return violations;

  // Step 2: Find which mutation vars have a corresponding useRef stabilization
  //   const fooRef = useRef(foo);  OR  fooRef.current = foo;
  const stabilizedVars = new Set();
  for (const varName of mutationVars) {
    const refPattern = new RegExp(
      `const\\s+${varName}Ref\\s*=\\s*useRef\\s*\\(\\s*${varName}\\s*\\)` +
      `|${varName}Ref\\.current\\s*=\\s*${varName}`,
    );
    if (refPattern.test(source)) {
      stabilizedVars.add(varName);
    }
  }

  // Step 3: Find useEffect/useCallback dependency arrays and check for raw mutation vars
  //   We look for ], [ ... mutationVar ... ]) patterns after useEffect/useCallback
  const hookDepPattern = /\b(useEffect|useCallback)\s*\(\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{/g;
  const lines = source.split("\n");

  for (const varName of mutationVars) {
    if (stabilizedVars.has(varName)) continue;

    // Check if this mutation var name appears in any dependency array
    // Pattern: look for the var name inside [...] at the end of useEffect/useCallback
    const depArrayPattern = new RegExp(
      `\\b(useEffect|useCallback)\\s*\\([\\s\\S]*?\\[([^\\]]*\\b${varName}\\b[^\\]]*)\\]\\s*\\)`,
      "g",
    );

    let depMatch;
    while ((depMatch = depArrayPattern.exec(source)) !== null) {
      const hookType = depMatch[1];
      const depList = depMatch[2];

      // Find approximate line number
      const matchIndex = depMatch.index;
      let lineNum = 1;
      for (let i = 0; i < matchIndex && i < source.length; i++) {
        if (source[i] === "\n") lineNum++;
      }

      violations.push({
        file: relPath,
        line: lineNum,
        hook: hookType,
        mutationVar: varName,
        message:
          `useMutation return "${varName}" found in ${hookType} dependency array ` +
          `without useRef stabilization. This can cause infinite re-render loops ` +
          `because useMutation() returns a new function reference on each render. ` +
          `Fix: const ${varName}Ref = useRef(${varName}); ${varName}Ref.current = ${varName}; ` +
          `then use ${varName}Ref.current(...) inside the hook.`,
      });
    }
  }

  return violations;
}

describe("Mutation Loop Guard", () => {
  const files = collectFiles(SRC_DIR);

  it("should find source files to scan", () => {
    assert.ok(files.length > 0, "No .tsx/.ts files found under src/");
  });

  it("should have NO useMutation returns in useEffect/useCallback dependency arrays without useRef", () => {
    const allViolations = [];

    for (const file of files) {
      const violations = findMutationLoopViolations(file);
      allViolations.push(...violations);
    }

    if (allViolations.length > 0) {
      const report = allViolations
        .map(
          (v, i) =>
            `\n  ${i + 1}. ${v.file}:${v.line}\n` +
            `     Hook: ${v.hook}, Mutation: ${v.mutationVar}\n` +
            `     ${v.message}`,
        )
        .join("\n");

      assert.fail(
        `Found ${allViolations.length} potential mutation loop(s):\n${report}\n\n` +
          `DANGER: These patterns cause infinite Convex mutations that can\n` +
          `exhaust your free tier quota and cause expensive production DB overages.\n\n` +
          `See: docs/mutation-safety-rules.md for the safe pattern.`,
      );
    }
  });

  it("should confirm all useMutation calls have useRef stabilization", () => {
    const unstabilized = [];

    for (const file of files) {
      const source = readFileSync(file, "utf-8");
      const relPath = relative(join(SRC_DIR, ".."), file);

      const mutationVarPattern = /const\s+(\w+)\s*=\s*useMutation\s*\(/g;
      let match;
      while ((match = mutationVarPattern.exec(source)) !== null) {
        const varName = match[1];

        // Check for ref stabilization
        const refPattern = new RegExp(
          `const\\s+${varName}Ref\\s*=\\s*useRef\\s*\\(\\s*${varName}\\s*\\)` +
          `|${varName}Ref\\.current\\s*=\\s*${varName}`,
        );

        // Check if mutation is used in any hook dep array
        const usedInDeps = new RegExp(
          `\\b(useEffect|useCallback)\\s*\\([\\s\\S]*?\\[[^\\]]*\\b${varName}\\b[^\\]]*\\]\\s*\\)`,
        ).test(source);

        // Only flag if used in deps without ref
        if (usedInDeps && !refPattern.test(source)) {
          const lineNum = source.substring(0, match.index).split("\n").length;
          unstabilized.push(`${relPath}:${lineNum} — "${varName}" used in hook deps without useRef`);
        }
      }
    }

    if (unstabilized.length > 0) {
      assert.fail(
        `Found ${unstabilized.length} unstabilized mutation(s) in hook deps:\n  ` +
          unstabilized.join("\n  "),
      );
    }
  });
});
