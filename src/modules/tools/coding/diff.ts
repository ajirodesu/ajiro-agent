/**
 * Diff utilities for coding tools (no external dependency).
 *
 * Author: AjiroDesu
 */

export type DiffLine = {
  kind: "context" | "add" | "remove";
  text: string;
};

function splitLines(content: string) {
  return content.replace(/\r\n/g, "\n").split("\n");
}

function lcsMatrix(
  left: string[],
  right: string[],
): number[][] {
  const table: number[][] = Array.from(
    { length: left.length + 1 },
    () => new Array<number>(right.length + 1).fill(0),
  );

  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      table[i][j] =
        left[i] === right[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  return table;
}

/**
 * Line-level diff with bounded context. Not a full unified diff — intentionally
 * compact so tool outputs and approval dialogs stay readable on a phone.
 */
// The LCS table costs left.length * right.length cells; past this budget a
// real-world file pair (e.g. 10k x 10k lines) would OOM the process.
const MAX_DIFF_CELLS = 2_000_000;
const MAX_FALLBACK_LINES = 200;

export function computeLineDiff(
  previous: string,
  next: string,
  contextLines = 2,
): DiffLine[] {
  const left = splitLines(previous);
  const right = splitLines(next);
  if (left.length * right.length > MAX_DIFF_CELLS) {
    // Degrade to a head-truncated whole-file replace instead of crashing.
    return [
      ...left
        .slice(0, MAX_FALLBACK_LINES)
        .map((text) => ({ kind: "remove" as const, text })),
      ...(left.length > MAX_FALLBACK_LINES
        ? [
            {
              kind: "context" as const,
              text: `… (${left.length - MAX_FALLBACK_LINES} more removed lines omitted: file too large for line diff)`,
            },
          ]
        : []),
      ...right
        .slice(0, MAX_FALLBACK_LINES)
        .map((text) => ({ kind: "add" as const, text })),
      ...(right.length > MAX_FALLBACK_LINES
        ? [
            {
              kind: "context" as const,
              text: `… (${right.length - MAX_FALLBACK_LINES} more added lines omitted: file too large for line diff)`,
            },
          ]
        : []),
    ];
  }
  const table = lcsMatrix(left, right);
  const full: DiffLine[] = [];

  let i = 0;
  let j = 0;

  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      full.push({ kind: "context", text: left[i] });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      full.push({ kind: "remove", text: left[i] });
      i += 1;
    } else {
      full.push({ kind: "add", text: right[j] });
      j += 1;
    }
  }

  while (i < left.length) {
    full.push({ kind: "remove", text: left[i] });
    i += 1;
  }

  while (j < right.length) {
    full.push({ kind: "add", text: right[j] });
    j += 1;
  }

  const changedIndexes = full
    .map((line, index) => (line.kind === "context" ? -1 : index))
    .filter((index) => index >= 0);

  if (changedIndexes.length === 0) {
    return [];
  }

  const keep = new Set<number>();

  for (const index of changedIndexes) {
    for (
      let windowIndex = Math.max(0, index - contextLines);
      windowIndex <= Math.min(full.length - 1, index + contextLines);
      windowIndex += 1
    ) {
      keep.add(windowIndex);
    }
  }

  const trimmed: DiffLine[] = [];
  let skipping = false;

  full.forEach((line, index) => {
    if (keep.has(index)) {
      trimmed.push(line);
      skipping = false;
    } else if (!skipping) {
      trimmed.push({ kind: "context", text: "…" });
      skipping = true;
    }
  });

  return trimmed;
}

export function formatLineDiff(path: string, diff: DiffLine[]) {
  if (diff.length === 0) {
    return `${path}: no changes`;
  }

  const additions = diff.filter((line) => line.kind === "add").length;
  const removals = diff.filter((line) => line.kind === "remove").length;
  const body = diff
    .map((line) =>
      line.kind === "add"
        ? `+ ${line.text}`
        : line.kind === "remove"
          ? `- ${line.text}`
          : `  ${line.text}`,
    )
    .join("\n");

  return `${path} (+${additions} / -${removals})\n${body}`;
}
