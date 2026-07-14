#!/usr/bin/env node
/**
 * cswa — ChezSoi Ops project CLI.
 *
 * Usage:
 *   npm run cswa:backup                  # database only (recommended)
 *   npm run cswa:backup -- --with-files  # also pull Convex file storage
 *   node scripts/cswa.mjs backup [--with-files] [--keep N]
 *
 * Subcommands:
 *   backup   Download a full snapshot of the PROD Convex database to ./backups/
 *            (gitignored). Prod is `lovable-oriole-182` via PROD_CONVEX_DEPLOY_KEY.
 *
 * COST — measured 2026-07-14, not guessed:
 *   A full export of all 121 tables is 15.4 MB uncompressed / 3.2 MB zipped, and
 *   takes ~7s. It is CHEAP. Do not be misled by the dashboard's "Database Storage:
 *   209.5 MB" — that figure is dominated by INDEX storage and overhead, not
 *   documents. Even a daily backup would be well under half a GB of document reads
 *   per month, comfortably inside the 6 GB Database I/O cap. (Convex builds the
 *   snapshot server-side, then you download it; the download itself is Data Egress,
 *   which sits at ~33 MB against a 6 GB cap.)
 *
 *   --with-files is the expensive flag: it adds Convex file storage (~674 MB),
 *   ~200x the transfer. Photos live on Backblaze B2, not Convex, so that storage is
 *   largely legacy. Off by default — turn it on only for a true disaster-recovery
 *   archive, not routine snapshots.
 *
 * See Docs/2026-07-14-convex-database-optimization-playbook.md for the read-cost
 * context this command was built alongside.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BACKUP_DIR = join(ROOT, "backups");
const ENV_FILE = join(ROOT, ".env.local");
const KEY_NAME = "PROD_CONVEX_DEPLOY_KEY";

const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const OFF = "\x1b[0m";

function die(msg) {
  console.error(`${RED}✖ ${msg}${OFF}`);
  process.exit(1);
}

/** The Convex CLI needs Node 20+ (it uses the regex `v` flag). */
function assertNodeVersion() {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 20) {
    die(
      `Node ${process.versions.node} is too old for the Convex CLI (needs 20+).\n` +
        `  Run:  nvm use lts/jod   (then re-run this command)`,
    );
  }
}

/** Read a single key out of .env.local without pulling in a dotenv dep. */
function readDeployKey() {
  if (!existsSync(ENV_FILE)) die(`.env.local not found at ${ENV_FILE}`);
  for (const line of readFileSync(ENV_FILE, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    if (trimmed.slice(0, eq).trim() !== KEY_NAME) continue;
    const value = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (value) return value;
  }
  die(`${KEY_NAME} not found in .env.local — cannot reach prod.`);
}

function human(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

/** Local timestamp, filename-safe: 2026-07-14_2131 */
function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

function pruneOld(keep) {
  const zips = readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith("convex-prod-") && f.endsWith(".zip"))
    .map((f) => ({ f, t: statSync(join(BACKUP_DIR, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  for (const { f } of zips.slice(keep)) {
    unlinkSync(join(BACKUP_DIR, f));
    console.log(`${DIM}  pruned old backup: ${f}${OFF}`);
  }
}

function backup(args) {
  assertNodeVersion();
  const withFiles = args.includes("--with-files");
  const keepIdx = args.indexOf("--keep");
  const keep = keepIdx !== -1 ? Number(args[keepIdx + 1]) : 5;
  if (!Number.isInteger(keep) || keep < 1) die("--keep expects a positive integer");

  const key = readDeployKey();
  mkdirSync(BACKUP_DIR, { recursive: true });
  const out = join(BACKUP_DIR, `convex-prod-${stamp()}.zip`);

  console.log(`${DIM}  Full snapshot of all tables (~15 MB of documents, ~3 MB zipped).${OFF}`);
  if (withFiles) {
    console.log(
      `${YELLOW}⚠ --with-files also pulls Convex file storage (~674 MB) — ~200x the transfer.\n` +
        `  Photos live on Backblaze B2, not Convex, so this is mostly legacy data.\n` +
        `  Use it for a disaster-recovery archive, not routine snapshots.${OFF}`,
    );
  }
  console.log(`${DIM}  target: lovable-oriole-182 (prod)${OFF}`);
  console.log(`${DIM}  output: ${out}${OFF}\n`);

  const cliArgs = ["convex", "export", "--path", out];
  if (withFiles) cliArgs.push("--include-file-storage");

  try {
    execFileSync("npx", cliArgs, {
      cwd: ROOT,
      stdio: "inherit",
      env: { ...process.env, CONVEX_DEPLOY_KEY: key },
    });
  } catch {
    die("convex export failed (see output above).");
  }

  if (!existsSync(out)) die(`export reported success but ${out} is missing.`);
  const size = statSync(out).size;
  console.log(`\n${GREEN}✓ Backup written${OFF}  ${out}  ${DIM}(${human(size)})${OFF}`);

  pruneOld(keep);
  console.log(
    `${DIM}  backups/ is gitignored — this snapshot is NOT committed. Copy it somewhere durable (NAS/MinIO) if it matters.${OFF}`,
  );
}

const [sub, ...rest] = process.argv.slice(2);
switch (sub) {
  case "backup":
    backup(rest);
    break;
  default:
    console.log(
      `cswa — ChezSoi Ops project CLI\n\n` +
        `  backup [--with-files] [--keep N]   Snapshot PROD Convex DB to ./backups/ (gitignored)\n\n` +
        `Examples:\n` +
        `  npm run cswa:backup\n` +
        `  npm run cswa:backup -- --with-files --keep 3\n`,
    );
    if (sub) die(`unknown subcommand: ${sub}`);
}
