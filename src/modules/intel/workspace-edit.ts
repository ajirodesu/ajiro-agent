/**
 * Workspace-edit application + preview (§10 rename, §25 refactoring).
 *
 * Pure text-edit machinery: offset conversion, ordered application with
 * overlap detection, and file-grouped previews. Every refactoring path
 * (rename, extract, quick fix) funnels through here so preview → apply →
 * undo behave identically.
 */
import type { IntelRange, IntelTextEdit, IntelWorkspaceEdit } from "@/modules/intel/types";

export interface AppliedEdit {
  uri: string;
  before: string;
  after: string;
}

export interface EditPreview {
  uri: string;
  hunks: EditHunk[];
  changeCount: number;
}

export interface EditHunk {
  startLine: number;
  endLine: number;
  before: string[];
  after: string[];
}

export function offsetAtLines(text: string, line: number, column: number): number {
  const lines = text.split("\n");
  const clampedLine = Math.min(Math.max(line, 1), lines.length);
  const content = lines[clampedLine - 1] ?? "";
  const clampedColumn = Math.min(Math.max(column, 1), content.length + 1);
  let offset = 0;
  for (let i = 0; i < clampedLine - 1; i += 1) {
    offset += (lines[i] ?? "").length + 1;
  }
  return offset + clampedColumn - 1;
}

export function rangeToOffsets(
  text: string,
  range: IntelRange,
): { start: number; end: number } {
  const start = offsetAtLines(text, range.start.line, range.start.column);
  const end = offsetAtLines(text, range.end.line, range.end.column);
  return { start: Math.min(start, end), end: Math.max(start, end) };
}

/**
 * Apply edits to one file. Overlapping edits are rejected (returns the
 * conflicting pair) instead of applied — rename/refactor must be safe.
 */
export function applyTextEdits(
  text: string,
  edits: { range: IntelRange; newText: string }[],
): { text: string; overlap: boolean } {
  const spans = edits.map((edit) => ({ ...rangeToOffsets(text, edit.range), newText: edit.newText }));
  spans.sort((a, b) => b.start - a.start);
  for (let i = 0; i + 1 < spans.length; i += 1) {
    const current = spans[i] as { start: number; end: number };
    const next = spans[i + 1] as { start: number; end: number };
    if (next.end > current.start) return { text, overlap: true };
  }
  let next = text;
  for (const span of spans) {
    next = next.slice(0, span.start) + span.newText + next.slice(span.end);
  }
  return { text: next, overlap: false };
}

export function applyWorkspaceEdit(
  files: Map<string, string>,
  edit: IntelWorkspaceEdit,
): { applied: AppliedEdit[]; skipped: string[]; overlapUris: string[] } {
  const byUri = new Map<string, IntelTextEdit[]>();
  for (const fileEdit of edit.edits) {
    const list = byUri.get(fileEdit.uri) ?? [];
    list.push(fileEdit);
    byUri.set(fileEdit.uri, list);
  }
  const applied: AppliedEdit[] = [];
  const skipped: string[] = [];
  const overlapUris: string[] = [];
  for (const [uri, edits] of byUri) {
    const before = files.get(uri);
    if (before === undefined) {
      skipped.push(uri);
      continue;
    }
    const result = applyTextEdits(before, edits);
    if (result.overlap) {
      overlapUris.push(uri);
      continue;
    }
    files.set(uri, result.text);
    applied.push({ uri, before, after: result.text });
  }
  return { applied, skipped, overlapUris };
}

/** Undo an apply by restoring `before` snapshots (LIFO). */
export function revertAppliedEdits(files: Map<string, string>, applied: AppliedEdit[]): void {
  for (let i = applied.length - 1; i >= 0; i -= 1) {
    const entry = applied[i] as AppliedEdit;
    files.set(entry.uri, entry.before);
  }
}

export function previewWorkspaceEdit(
  files: Map<string, string>,
  edit: IntelWorkspaceEdit,
  contextLines = 2,
): EditPreview[] {
  const previews: EditPreview[] = [];
  const byUri = new Map<string, IntelTextEdit[]>();
  for (const fileEdit of edit.edits) {
    const list = byUri.get(fileEdit.uri) ?? [];
    list.push(fileEdit);
    byUri.set(fileEdit.uri, list);
  }
  for (const [uri, edits] of byUri) {
    const before = files.get(uri);
    if (before === undefined) continue;
    const result = applyTextEdits(before, edits);
    if (result.overlap) continue;
    const beforeLines = before.split("\n");
    const afterLines = result.text.split("\n");
    const changed = new Set<number>();
    const maxLines = Math.max(beforeLines.length, afterLines.length);
    for (let i = 0; i < maxLines; i += 1) {
      if (beforeLines[i] !== afterLines[i]) {
        for (let c = -contextLines; c <= contextLines; c += 1) {
          if (i + c >= 0) changed.add(i + c);
        }
      }
    }
    const sorted = [...changed].sort((a, b) => a - b);
    const hunks: EditHunk[] = [];
    let run: number[] = [];
    for (const line of sorted) {
      if (run.length > 0 && line !== (run[run.length - 1] as number) + 1) {
        hunks.push(toHunk(beforeLines, afterLines, run));
        run = [];
      }
      run.push(line);
    }
    if (run.length > 0) hunks.push(toHunk(beforeLines, afterLines, run));
    previews.push({ uri, hunks, changeCount: edits.length });
  }
  return previews;
}

function toHunk(beforeLines: string[], afterLines: string[], lines: number[]): EditHunk {
  return {
    startLine: (lines[0] ?? 0) + 1,
    endLine: (lines[lines.length - 1] ?? 0) + 1,
    before: lines.map((line) => beforeLines[line] ?? ""),
    after: lines.map((line) => afterLines[line] ?? ""),
  };
}
