/**
 * Merge-conflict marker parsing + resolution (§38). Pure: parse hunks out of
 * conflicted text, rebuild per Keep Current / Keep Incoming / Keep Both, and
 * accept manual content. Never auto-chooses — the caller picks per hunk.
 */
export type ConflictHunk = {
  index: number;
  startLine: number;
  endLine: number;
  ours: string[];
  theirs: string[];
};

export type ConflictFile = {
  path: string;
  hunks: ConflictHunk[];
};

const MARK_START = /^<{7}.*$/;
const MARK_MID = /^={7}$/;
const MARK_END = /^>{7}.*$/;

export function hasConflictMarkers(text: string): boolean {
  return text.split("\n").some(
    (line) => MARK_START.test(line) || MARK_MID.test(line) || MARK_END.test(line),
  );
}

export function parseConflictHunks(path: string, text: string): ConflictFile {
  const lines = text.split("\n");
  const hunks: ConflictHunk[] = [];
  let index = 0;
  let line = 0;
  while (line < lines.length) {
    if (!MARK_START.test(lines[line]!)) {
      line += 1;
      continue;
    }
    const startLine = line + 1;
    const ours: string[] = [];
    line += 1;
    while (line < lines.length && !MARK_MID.test(lines[line]!)) {
      ours.push(lines[line]!);
      line += 1;
    }
    if (line >= lines.length) break;
    line += 1;
    const theirs: string[] = [];
    while (line < lines.length && !MARK_END.test(lines[line]!)) {
      theirs.push(lines[line]!);
      line += 1;
    }
    if (line >= lines.length) break;
    line += 1;
    hunks.push({ index: index++, startLine, endLine: line, ours, theirs });
  }
  return { path, hunks };
}

export type HunkChoice =
  | { kind: "current" }
  | { kind: "incoming" }
  | { kind: "both" }
  | { kind: "manual"; content: string };

export function resolveHunk(hunk: ConflictHunk, choice: HunkChoice): string[] {
  switch (choice.kind) {
    case "current":
      return [...hunk.ours];
    case "incoming":
      return [...hunk.theirs];
    case "both":
      return [...hunk.ours, ...hunk.theirs];
    case "manual":
      return choice.content.split("\n");
  }
}

/** Rebuilds full file text with one hunk replaced by its resolution. */
export function applyHunkResolution(
  text: string,
  hunk: ConflictHunk,
  resolved: string[],
): string {
  const lines = text.split("\n");
  const before = lines.slice(0, hunk.startLine - 1);
  const after = lines.slice(hunk.endLine);
  return [...before, ...resolved, ...after].join("\n");
}
