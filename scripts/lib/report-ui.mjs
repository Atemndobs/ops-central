/**
 * Terminal presentation helpers for `csoi perf`.
 *
 * Split from perf-audit.mjs so the audit file stays about Convex and this file
 * stays about pixels. Two jobs:
 *   - table()      column layout that survives ANSI colour codes and wraps the
 *                  trailing "what it means" column instead of overflowing.
 *   - progress()   a bar on stderr while the audit greps/exports, so `csoi perf`
 *                  doesn't look hung. stderr, so `csoi perf > report.txt` stays clean.
 */

const ANSI = /\x1b\[[0-9;]*m/g;

export const visLen = (s) => String(s).replace(ANSI, "").length;

export function pad(s, w, align = "left") {
  const gap = Math.max(0, w - visLen(s));
  return align === "right" ? " ".repeat(gap) + s : s + " ".repeat(gap);
}

/**
 * Word-wrap to `w` visible columns. Never splits a word; long tokens overflow.
 *
 * ANSI-aware in both directions: colour codes cost no width, and a colour still open
 * at a line break is closed and reopened on the next line. Without that reopen, a
 * colour set on line 1 would bleed across the newline and paint the following line's
 * padding and column separators.
 */
export function wrap(text, w) {
  const lines = [];
  let line = "";
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    if (line && visLen(line) + 1 + visLen(word) > w) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  if (lines.length === 0) return [""];

  let open = "";
  return lines.map((raw) => {
    const withInherited = open + raw;
    open = (withInherited.match(ANSI) ?? []).reduce(
      (state, code) => (code === "\x1b[0m" ? "" : state + code),
      "",
    );
    return open ? `${withInherited}\x1b[0m` : withInherited;
  });
}

/**
 * Render rows as an aligned table.
 *
 * cols: [{ key, header, align?, flex? }] — exactly one column may set `flex`, and
 * it absorbs the leftover terminal width and wraps onto continuation lines.
 */
export function table(cols, rows, opts = {}) {
  const { indent = "   ", width = process.stdout.columns || 100, dim = (s) => s } = opts;
  const sep = dim(" │ ");
  const sepW = 3;

  const natural = cols.map((c) =>
    Math.max(visLen(c.header), ...rows.map((r) => visLen(r[c.key] ?? ""))),
  );

  const flexIdx = cols.findIndex((c) => c.flex);
  if (flexIdx !== -1) {
    const fixed = natural.reduce((a, w, i) => (i === flexIdx ? a : a + w), 0);
    const chrome = indent.length + sepW * (cols.length - 1);
    natural[flexIdx] = Math.max(24, width - fixed - chrome - 1);
  }

  const out = [];
  out.push(
    indent + dim(cols.map((c, i) => pad(c.header.toUpperCase(), natural[i], c.align)).join(" │ ")),
  );
  out.push(indent + dim("─".repeat(Math.min(width - indent.length - 1, natural.reduce((a, w) => a + w, 0) + sepW * (cols.length - 1)))));

  for (const row of rows) {
    const wrapped = cols.map((c, i) =>
      c.flex ? wrap(row[c.key] ?? "", natural[i]) : [String(row[c.key] ?? "")],
    );
    const height = Math.max(...wrapped.map((w) => w.length));
    for (let line = 0; line < height; line++) {
      const cells = cols.map((c, i) => pad(wrapped[i][line] ?? "", natural[i], c.align));
      out.push((indent + cells.join(sep)).trimEnd());
    }
  }
  return out.join("\n");
}

/**
 * Progress bar on stderr. Silent unless stderr is a TTY, so piped/JSON runs and CI
 * logs are unaffected. Node's sync child_process calls block the event loop, so this
 * is caller-ticked rather than animated — every tick is real work completed.
 */
export function progress(enabled) {
  const W = 20;
  let active = false;
  const write = (s) => {
    if (!enabled) return;
    process.stderr.write(`\r\x1b[2K${s}`);
    active = true;
  };
  return {
    step(label, done, total) {
      const pct = total > 0 ? done / total : 0;
      const filled = Math.round(pct * W);
      write(
        `\x1b[2m${pad(label, 20)}\x1b[0m [${"█".repeat(filled)}${"░".repeat(W - filled)}] ` +
          `${String(Math.round(pct * 100)).padStart(3)}%`,
      );
    },
    note(label) {
      write(`\x1b[2m${label}\x1b[0m`);
    },
    done() {
      if (enabled && active) process.stderr.write("\r\x1b[2K");
      active = false;
    },
  };
}
