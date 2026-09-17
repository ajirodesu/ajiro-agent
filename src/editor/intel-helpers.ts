/**
 * Pure intel UI helpers (no React imports — unit-testable in Node).
 */
import type { EditorDiagnostic } from "@/editor/editorDiagnostics";

/** Map a CodeMirror bundle grammar key to an intel language id. */
export function intelLanguageIdForGrammar(grammarKey: string | null): string {
  if (!grammarKey) return "plaintext";
  const lower = grammarKey.toLowerCase();
  if (lower === "typescript" || lower === "javascript") return lower;
  if (lower === "scss" || lower === "mkscss") return "scss";
  if (lower === "mkpython" || lower === "cython") return "python";
  if (lower === "mkxml") return "xml";
  if (lower === "gssql" || lower === "pgsql" || lower === "mysql" || lower === "sqlite" || lower === "mssql") {
    return "sql";
  }
  return lower;
}

export function isTsJsLanguage(languageId: string): boolean {
  return (
    languageId === "typescript" ||
    languageId === "javascript" ||
    languageId === "tsx" ||
    languageId === "jsx"
  );
}

/** Compare a session URI (`file:///project/src/a.ts`) with an open path. */
export function urisMatch(sessionUri: string, openPath: string): boolean {
  const normalize = (value: string): string => {
    let next = value.replace(/\\/g, "/");
    next = next.replace(/^file:\/\//, "");
    if (next.startsWith("project/")) next = next.slice("project/".length);
    return next.replace(/^\/+/, "");
  };
  const a = normalize(sessionUri);
  const b = normalize(openPath);
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}

/** Local checks that survive alongside semantic results (TODO markers). */
export function filterLocalTodos(diagnostics: EditorDiagnostic[]): EditorDiagnostic[] {
  return diagnostics.filter((diagnostic) => /^(TODO|FIXME|XXX)$/.test(diagnostic.message));
}
