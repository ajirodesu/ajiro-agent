/**
 * Git-aware coding intelligence (§35): conflict diagnostics + conflict
 * navigation over the EXISTING git implementation (`git-conflicts.ts`).
 * Nothing here reimplements Git — it only surfaces conflicts as editor
 * diagnostics with jump targets.
 */
import {
  hasConflictMarkers,
  parseConflictHunks,
  type ConflictFile,
} from "@/modules/ide/git-conflicts";
import type { IntelDiagnostic } from "@/modules/intel/types";

export interface ConflictDiagnostic {
  diagnostic: IntelDiagnostic;
  /** Hunk index inside the parsed ConflictFile. */
  hunkIndex: number;
}

export function conflictDiagnosticsFor(
  path: string,
  text: string,
): { file: ConflictFile | null; diagnostics: ConflictDiagnostic[] } {
  if (!hasConflictMarkers(text)) return { file: null, diagnostics: [] };
  const file = parseConflictHunks(path, text);
  const diagnostics: ConflictDiagnostic[] = file.hunks.map((hunk, index) => ({
    hunkIndex: index,
    diagnostic: {
      severity: "error",
      message: `Merge conflict (${hunk.ours.length} ours / ${hunk.theirs.length} theirs lines)`,
      source: "git-conflict",
      code: "merge-conflict",
      range: {
        start: { line: hunk.startLine, column: 1 },
        end: { line: hunk.endLine, column: 1 },
      },
      related: [],
      fixable: true,
    },
  }));
  return { file, diagnostics };
}

/** Next/previous conflict hunk line from a cursor line (wraps around). */
export function nearestConflictLine(hunkStartLines: number[], cursorLine: number, direction: 1 | -1): number | null {
  if (hunkStartLines.length === 0) return null;
  const sorted = [...hunkStartLines].sort((a, b) => a - b);
  if (direction === 1) {
    for (const line of sorted) {
      if (line > cursorLine) return line;
    }
    return sorted[0] ?? null;
  }
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const line = sorted[i] as number;
    if (line < cursorLine) return line;
  }
  return sorted[sorted.length - 1] ?? null;
}
