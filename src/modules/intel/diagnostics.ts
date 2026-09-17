/**
 * Diagnostics aggregation (§16).
 *
 * Merges syntax, semantic, and provider diagnostics into one ordered list
 * per file: errors → warnings → info → hints, then by line/column, then by
 * source for determinism. Also maps intel diagnostics onto the editor's
 * existing line/column `EditorDiagnostic` shape so the Problems panel and
 * footer keep working unchanged.
 */
import type { EditorDiagnostic } from "@/editor/editorDiagnostics";
import type { IntelDiagnostic, IntelSeverity } from "@/modules/intel/types";

const SEVERITY_RANK: Record<IntelSeverity, number> = {
  error: 0,
  warning: 1,
  info: 2,
  hint: 3,
};

export function mergeDiagnostics(lists: IntelDiagnostic[][]): IntelDiagnostic[] {
  const merged = lists.flat();
  const seen = new Set<string>();
  const deduped = merged.filter((diagnostic) => {
    const key = [
      diagnostic.source,
      diagnostic.severity,
      diagnostic.message,
      diagnostic.range.start.line,
      diagnostic.range.start.column,
      diagnostic.range.end.line,
      diagnostic.range.end.column,
      String(diagnostic.code ?? ""),
    ].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return deduped.sort((a, b) => {
    const severity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (severity !== 0) return severity;
    if (a.range.start.line !== b.range.start.line) {
      return a.range.start.line - b.range.start.line;
    }
    if (a.range.start.column !== b.range.start.column) {
      return a.range.start.column - b.range.start.column;
    }
    return a.source < b.source ? -1 : a.source > b.source ? 1 : 0;
  });
}

export function toEditorDiagnostics(diagnostics: IntelDiagnostic[]): EditorDiagnostic[] {
  return diagnostics
    .filter((diagnostic) => diagnostic.severity === "error" || diagnostic.severity === "warning")
    .map((diagnostic) => ({
      severity: diagnostic.severity as "error" | "warning",
      message: diagnostic.code !== null ? `${diagnostic.message}` : diagnostic.message,
      line: diagnostic.range.start.line,
      column: diagnostic.range.start.column,
    }));
}

export function countIntelDiagnostics(diagnostics: IntelDiagnostic[]): {
  errors: number;
  warnings: number;
  infos: number;
  hints: number;
} {
  return {
    errors: diagnostics.filter((diagnostic) => diagnostic.severity === "error").length,
    warnings: diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length,
    infos: diagnostics.filter((diagnostic) => diagnostic.severity === "info").length,
    hints: diagnostics.filter((diagnostic) => diagnostic.severity === "hint").length,
  };
}
