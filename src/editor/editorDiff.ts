/**
 * Editor line/character diff — the SOLE diff algorithm for Edit History
 * compare mode. Real Myers-style LCS on lines (bounded for phone memory),
 * plus prefix/suffix character spans for changed line pairs.
 *
 * Pure + Node-safe. Never a placeholder "changed" flag.
 */
export type DiffLineKind = "context" | "add" | "remove";

export type CharSpan = { start: number; end: number };

export type DiffRow =
  | { kind: "context"; leftNo: number; rightNo: number; text: string }
  | { kind: "remove"; leftNo: number; rightNo: null; text: string }
  | { kind: "add"; leftNo: null; rightNo: number; text: string }
  | {
      kind: "change";
      leftNo: number;
      rightNo: number;
      leftText: string;
      rightText: string;
      leftSpan: CharSpan;
      rightSpan: CharSpan;
    };

function splitLines(content: string): string[] {
  return content.replace(/\r\n/g, "\n").split("\n");
}

function commonPrefix(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i += 1;
  return i;
}

function commonSuffix(a: string, b: string, before: number): number {
  let i = 0;
  while (
    i < a.length - before &&
    i < b.length - before &&
    a.charCodeAt(a.length - 1 - i) === b.charCodeAt(b.length - 1 - i)
  ) {
    i += 1;
  }
  return i;
}

/** Character-level changed spans for one paired changed line. */
export function charSpansForPair(
  left: string,
  right: string,
): { leftSpan: CharSpan; rightSpan: CharSpan } {
  const prefix = commonPrefix(left, right);
  const suffix = commonSuffix(left, right, prefix);
  return {
    leftSpan: { start: prefix, end: left.length - suffix },
    rightSpan: { start: prefix, end: right.length - suffix },
  };
}

function lcsTable(left: string[], right: string[]): number[][] {
  // Bounded: cap the comparison matrix so huge files can't OOM a phone.
  const cap = 2000;
  const a = left.length > cap ? left.slice(0, cap) : left;
  const b = right.length > cap ? right.slice(0, cap) : right;
  const table: number[][] = Array.from(
    { length: a.length + 1 },
    () => new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i][j] =
        a[i] === b[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  return table;
}

/**
 * Full dual-gutter diff rows: left numbers = historical revision, right
 * numbers = comparison target. Changed line *pairs* become `change` rows
 * with inline character spans so the UI can highlight just the changed
 * span (e.g. one appended character) instead of the whole line.
 */
export function diffLines(previous: string, next: string): DiffRow[] {
  const left = splitLines(previous);
  const right = splitLines(next);
  const table = lcsTable(left, right);
  const cap = 2000;
  const aLen = Math.min(left.length, cap);
  const bLen = Math.min(right.length, cap);

  type Op = { kind: DiffLineKind; text: string };
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < aLen && j < bLen) {
    if (left[i] === right[j]) {
      ops.push({ kind: "context", text: left[i] });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      ops.push({ kind: "remove", text: left[i] });
      i += 1;
    } else {
      ops.push({ kind: "add", text: right[j] });
      j += 1;
    }
  }
  while (i < left.length) {
    ops.push({ kind: "remove", text: left[i] });
    i += 1;
  }
  while (j < right.length) {
    ops.push({ kind: "add", text: right[j] });
    j += 1;
  }

  const rows: DiffRow[] = [];
  let leftNo = 1;
  let rightNo = 1;
  let k = 0;
  while (k < ops.length) {
    const op = ops[k];
    if (op.kind === "context") {
      rows.push({ kind: "context", leftNo, rightNo, text: op.text });
      leftNo += 1;
      rightNo += 1;
      k += 1;
      continue;
    }
    // Pair each remove-run with the following add-run as changed pairs.
    const removes: string[] = [];
    const adds: string[] = [];
    while (k < ops.length && ops[k].kind === "remove") {
      removes.push(ops[k].text);
      k += 1;
    }
    while (k < ops.length && ops[k].kind === "add") {
      adds.push(ops[k].text);
      k += 1;
    }
    const pairs = Math.min(removes.length, adds.length);
    for (let p = 0; p < pairs; p += 1) {
      const { leftSpan, rightSpan } = charSpansForPair(removes[p], adds[p]);
      rows.push({
        kind: "change",
        leftNo,
        rightNo,
        leftText: removes[p],
        rightText: adds[p],
        leftSpan,
        rightSpan,
      });
      leftNo += 1;
      rightNo += 1;
    }
    for (let p = pairs; p < removes.length; p += 1) {
      rows.push({ kind: "remove", leftNo, rightNo: null, text: removes[p] });
      leftNo += 1;
    }
    for (let p = pairs; p < adds.length; p += 1) {
      rows.push({ kind: "add", leftNo: null, rightNo, text: adds[p] });
      rightNo += 1;
    }
  }
  return rows;
}
