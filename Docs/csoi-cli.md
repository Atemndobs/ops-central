# `csoi` — the project CLI

**`csoi` is *the* CLI for this project. When a command is needed, it goes in `csoi`.
Do not create a second CLI, npm script, or one-off wrapper alongside it.**

Source of truth: [`scripts/csoi`](../scripts/csoi) — version-controlled, so it works
on any machine, any server, and for any developer who clones this repo.

## Install (any machine, ~10 seconds)

```bash
./scripts/csoi install     # symlinks scripts/csoi -> ~/.local/bin/csoi
csoi help
```

It installs a **symlink, not a copy** — deliberately. The CLI then updates with
`git pull` instead of silently drifting from the repo. (This file spent months living
*only* in `~/.local/bin`, unversioned, on one laptop; a `git pull` now keeps every
machine in sync.)

If `~/.local/bin` isn't on your `PATH`, `csoi install` tells you and prints the line
to add. Install elsewhere with `CSOI_INSTALL_DIR=/usr/local/bin ./scripts/csoi install`.

## How paths resolve (why it's portable)

Every path derives from **the script's own location**, following symlinks — so there
are no hardcoded home directories. Nothing needs editing per machine.

| Env var | Default | What it is |
|---|---|---|
| `CSOI_PROJECT_DIR` | the repo containing `scripts/csoi` | admin repo root |
| `CSOI_MOBILE_DIR` | `<repo>/../jna-cleaners-app` | cleaners app repo |
| `CSOI_POSTHOG_ENV` | `<repo>/../../.env` | file holding the PostHog key |
| `CSOI_INSTALL_DIR` | `~/.local/bin` | where `csoi install` symlinks to |

Override any of them if your layout differs (CI runner, server, non-standard clone).

## Requirements

- **node 20+** and `npx` (the Convex CLI uses the regex `v` flag; on nvm: `nvm use lts/jod`).
  Commands that need it fail with that hint rather than a cryptic CLI error.
- Some commands additionally need: `jq` (property report name lookup), `curl`,
  `vercel` (logs), `python3`.
- Convex credentials come from the process env, falling back to
  `<repo>/.env.local` (`resolve_deploy_key`). `--prod` commands need
  `PROD_CONVEX_DEPLOY_KEY`.

## Commands

Run `csoi help` for the authoritative list — the header comment in `scripts/csoi`
*is* the help text. Grouped roughly:

- **Hospitable sync** — `sync`, `sync:reservations`, `sync:properties`, `webhook-test`
- **Inspect** — `events`, `jobs`, `stays`, `data <table>`, `raw <function>`, `logs`
- **Convex env** — `env`, `env:set`
- **Users** — `user check <email>`, `user set-role <email> <role>` (`--prod` for prod)
- **Reporting** — `property report <name-or-id> <YYYY-MM>`
- **Analytics (PostHog)** — `analytics stats|visits|sites|top-pages|raw` (see below)
- **Mobile mirror** — `mobile:check` (typecheck mobile against admin's convex),
  `mobile:drift` (diff admin convex vs the mobile mirror)
- **Backup** — `backup [--with-files] [--keep N]`
- **Dev/danger** — `purge:synthetic`, `reset:job`, `reset:completed`, `reset:all`
- **Meta** — `install`, `help`

### `csoi analytics` — PostHog

Reports against **project 514212 ("chezsoi")** — this app's own PostHog.

> **Three PostHog projects exist and they are easy to confuse.** 514212 is this app.
> 211614 ("JnA-BusinessSolutions") collects the marketing sites (`chezsoistays.com`,
> `jnabusinesssolutions.com`). 169649 ("Readme", org Atem) belongs to an unrelated
> app (Reel Plug). `csoi analytics` was hardcoded to **211614** until 2026-07-15, so
> any pageview/session number it printed before then described the marketing sites,
> **not** this app. Don't trust historical readings.

Config — resolved per value as **env var → `.env.local` → `<workspace>/.env`**:

```bash
POSTHOG_PERSONAL_API_KEY_OPSCENTRAL=phx_...   # PostHog → Settings → Personal API keys
POSTHOG_PROJECT_ID_OPSCENTRAL=514212          # optional; 514212 is the default
```

The personal key needs **Query** read access on the project. It is a *personal*
key (`phx_`), not the project's write token (`phc_`) — keep it out of git; the app
env files are gitignored.

The app itself is configured separately, in `.env.local` **and in Vercel for
production** (prod is what real traffic uses):

```bash
NEXT_PUBLIC_POSTHOG_API_KEY=phc_...            # project 514212's write token
NEXT_PUBLIC_POSTHOG_API_HOST=https://us.i.posthog.com
```

`src/lib/posthog/client.ts` falls back to `NEXT_PUBLIC_POSTHOG_KEY` /
`NEXT_PUBLIC_POSTHOG_HOST` if the `_API_` names are absent — so delete the old
names rather than leaving them, or a stale fallback silently reports to the wrong
project.

### `csoi perf` — performance audit

Run it **manually** after a feature and paste the report. It's built so a reviewer
(human or AI) can judge a change from the report alone, without re-reading the code —
which is the point: it keeps review cheap.

```bash
csoi perf              # report
csoi perf --json       # machine-readable — paste this to an AI reviewer
csoi perf --docs       # + live document-weight scan (exports prod, ~10s)
csoi perf --strict     # exit 1 on regressions (CI / pre-push)
```

It answers three questions:

| Question | How |
|---|---|
| Did we write bad queries? | Static scan for the anti-patterns in `convex/CLAUDE.md` (R1–R4) |
| **Did we make something ELSE worse?** | **Diff vs the committed ratchet baseline** — any *new* violation anywhere is a regression, reported with file, line, function and snippet |
| Is the code in good shape? | **Blast radius** (violations × client mount points, flagging always-mounted screens) + **document weight** + a PASS/WARN/FAIL verdict |

**Reading the report.** Every finding is a table row ending in a plain-English *what it
means*, so you can act on it without knowing the rule names. The rule ids (`bare-scan`,
`query-in-loop`, …) are the ratchet's vocabulary — the report shows the symptom
("scans whole table") and expands each one *once* in a legend under the table rather
than on every row. A progress bar goes to **stderr** while it greps and exports, so
`csoi perf > report.txt` and `--json` stay clean.

**Blast radius** matters because reactive cost is `per-exec reads × writes to that
range × subscribers`. A cheap query on ten always-mounted screens beats an ugly one
behind a rarely-opened page — the ranking reflects that.

**Document weight** (`--docs`) exports a prod snapshot and reports average bytes per
document per table plus the fattest field. `ctx.db.get()` reads the WHOLE document,
so a fat field taxes *every* read of that table. This is how `properties.metadata`
(72% dead Hospitable payload) and the 240 KB `users.avatarUrl` were found — neither
was visible as a "bad query".

#### What it deliberately cannot do

**Real per-function read bytes.** `npx convex insights` requires interactive user auth
and explicitly refuses deploy keys, so billing ground truth stays on the dashboard:
**Usage → Database I/O → breakdown by function.** Treat `csoi perf` as the cheap proxy
you run every time, and the dashboard as the weekly truth. The playbook's measurement
protocol covers both.

#### Extending the rules

Rules live in `scripts/lib/convex-scan.mjs`, shared with the CI ratchet
(`npm run check:convex-readcost`) so they cannot rot apart. A new rule also needs a
`PLAIN` entry in `scripts/perf-audit.mjs` (tag + what + fix) or it will surface in the
report as a bare rule id. Table/progress rendering lives in `scripts/lib/report-ui.mjs`. When adding a rule, test it
against a **true positive, a correct pattern, and a false-positive guard** — the
`query-in-loop` rule initially flagged 39 files of noise (it matched comments, and its
loop-body extraction overshot the closing brace) and would have trained everyone to
ignore the tool. `ctx.db.get()` inside `Promise.all(ids.map(...))` over a de-duplicated
id set is CORRECT batching and is deliberately never flagged.

### `csoi backup`

Snapshots the **prod** Convex database to `<repo>/backups/` (gitignored — snapshots
contain guest names, addresses, and financials; never commit them).

```bash
csoi backup                 # all tables
csoi backup --keep 3        # retain the 3 newest (default 5)
csoi backup --with-files    # also Convex file storage — rarely wanted
```

Measured 2026-07-14: all **121 tables = 15.4 MB uncompressed / 3.2 MB zipped, ~7s**.
Do **not** be misled by the dashboard's *"Database Storage: 209.5 MB"* — that figure
is dominated by **index storage**, not documents. Backups are cheap.
`--with-files` is the only expensive flag (~674 MB, ~200× the transfer), and photos
live on **Backblaze B2**, not Convex, so it's largely legacy data.

> A snapshot on one laptop is not a backup. Copy it somewhere durable (NAS/MinIO).

## Adding a command

1. **Extend `csoi`. Do not build a parallel CLI.** (One was built by mistake and had
   to be reverted — PR #263 → #264.)
2. Add a `case` branch in `scripts/csoi`. Reuse the existing helpers:
   - `PROJECT_DIR` — already `cd`-ed into before dispatch, so relative paths work.
   - `resolve_deploy_key PROD_CONVEX_DEPLOY_KEY` — env first, then `.env.local`;
     returns 1 if missing.
3. Add a line to the header comment (that block *is* `csoi help`).
4. **If you add header lines, bump the `sed -n '4,NNp'` range in the `help` case** —
   a stale range silently truncates the help output.
5. Validate flags and `exit 2` on usage errors, matching the existing commands.
6. `bash -n scripts/csoi` before committing.

## Related

- Read-cost rules for anything touching `convex/`: [`convex/CLAUDE.md`](../convex/CLAUDE.md)
- Why the database got expensive: [Convex Database Optimization Playbook](2026-07-14-convex-database-optimization-playbook.md)
