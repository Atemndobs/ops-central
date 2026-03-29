#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();
const issues = [];

function expectContains(path, expected) {
  if (!existsSync(path)) {
    issues.push(`Missing file: ${path}`);
    return;
  }
  const content = readFileSync(path, "utf8");
  if (!content.includes(expected)) {
    issues.push(`Expected "${expected}" in ${path}`);
  }
}

expectContains(join(repoRoot, "AGENTS.md"), "BIG FAT WARNING");
expectContains(join(repoRoot, "CLAUDE.md"), "BIG FAT WARNING");
expectContains(join(repoRoot, "GEMINI.md"), "BIG FAT WARNING");
expectContains(join(repoRoot, "package.json"), "\"check:convex-owner\"");
expectContains(join(repoRoot, "convex", "convex.json"), "\"functions\": \"./\"");

if (issues.length > 0) {
  console.error("Convex owner safety check failed:");
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
  process.exit(1);
}

console.log("Convex owner safety check passed.");
