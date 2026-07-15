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
- **Analytics (PostHog)** — `analytics stats|visits|sites|top-pages|raw`
- **Mobile mirror** — `mobile:check` (typecheck mobile against admin's convex),
  `mobile:drift` (diff admin convex vs the mobile mirror)
- **Backup** — `backup [--with-files] [--keep N]`
- **Dev/danger** — `purge:synthetic`, `reset:job`, `reset:completed`, `reset:all`
- **Meta** — `install`, `help`

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
