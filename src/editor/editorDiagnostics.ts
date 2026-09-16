/**
 * Editor diagnostics — the SOLE linter/format bridge for the status footer.
 * Pure + Node-safe so footer counts and unit tests share one implementation.
 */
import { grammarKeyForPath } from "@/editor/editorLanguages";

export type DiagnosticSeverity = "error" | "warning";

export type EditorDiagnostic = {
  severity: DiagnosticSeverity;
  message: string;
  line: number;
  column: number;
};

export type FormatCheck = {
  valid: boolean;
  unsupported: boolean;
  message: string | null;
};

const JS_FAMILY = new Set([
  "javascript",
  "typescript",
  "jsx",
  "tsx",
  "vue",
  "angular",
]);

function clampLine(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 1
    ? Math.floor(value)
    : fallback;
}

function todoWarnings(text: string): EditorDiagnostic[] {
  const out: EditorDiagnostic[] = [];
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    const marker = /(TODO|FIXME|XXX)\b/.exec(line);
    if (marker) {
      out.push({
        severity: "warning",
        message: marker[0],
        line: index + 1,
        column: marker.index + 1,
      });
    }
  });
  return out;
}

async function jsDiagnostics(text: string): Promise<EditorDiagnostic[]> {
  if (!text.trim()) return [];
  try {
    const parser = await import("@babel/parser");
    parser.parse(text, {
      sourceType: "unambiguous",
      allowImportExportEverywhere: true,
      allowReturnOutsideFunction: true,
      plugins: ["typescript", "jsx", "decorators-legacy"],
    });
    return [];
  } catch (error) {
    const err = error as {
      message?: string;
      loc?: { line?: number; column?: number };
    };
    const message = String(err?.message ?? "Syntax error").split("\n")[0];
    return [
      {
        severity: "error",
        message,
        line: clampLine(err?.loc?.line, 1),
        column: clampLine((err?.loc?.column ?? 0) + 1, 1),
      },
    ];
  }
}

function jsonDiagnostics(text: string): EditorDiagnostic[] {
  if (!text.trim()) return [];
  try {
    JSON.parse(text);
    return [];
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid JSON";
    const at = /position\s+(\d+)/i.exec(message)?.[1];
    let line = 1;
    let column = 1;
    if (at !== undefined) {
      const offset = Math.min(Number(at), text.length);
      const upto = text.slice(0, offset);
      line = upto.split("\n").length;
      column = offset - upto.lastIndexOf("\n");
    }
    return [{ severity: "error", message, line, column }];
  }
}

/** Real diagnostics for the current buffer — never stubbed. */
export async function computeDiagnostics(
  path: string,
  text: string,
): Promise<EditorDiagnostic[]> {
  const key = grammarKeyForPath(path);
  const warnings = todoWarnings(text);
  if (key === "json") return [...jsonDiagnostics(text), ...warnings];
  if (key !== null && JS_FAMILY.has(key)) {
    return [...(await jsDiagnostics(text)), ...warnings];
  }
  return warnings;
}

export function countBySeverity(diagnostics: EditorDiagnostic[]): {
  errors: number;
  warnings: number;
} {
  return {
    errors: diagnostics.filter((d) => d.severity === "error").length,
    warnings: diagnostics.filter((d) => d.severity === "warning").length,
  };
}

/** Real format/validity check for the format footer icon. */
export async function checkFormat(
  path: string,
  text: string,
): Promise<FormatCheck> {
  const key = grammarKeyForPath(path);
  if (key === "json") {
    if (!text.trim()) return { valid: true, unsupported: false, message: null };
    try {
      JSON.parse(text);
      return { valid: true, unsupported: false, message: null };
    } catch (error) {
      return {
        valid: false,
        unsupported: false,
        message: error instanceof Error ? error.message : "Invalid JSON",
      };
    }
  }
  if (key !== null && JS_FAMILY.has(key)) {
    const errors = await jsDiagnostics(text);
    return errors.length === 0
      ? { valid: true, unsupported: false, message: null }
      : { valid: false, unsupported: false, message: errors[0].message };
  }
  return { valid: true, unsupported: true, message: null };
}

/** Real formatter: canonical JSON re-serialization. Null when N/A. */
export function formatBuffer(path: string, text: string): string | null {
  if (grammarKeyForPath(path) !== "json" || !text.trim()) return null;
  try {
    return `${JSON.stringify(JSON.parse(text), null, 2)}\n`;
  } catch {
    return null;
  }
}

/** Relative-time formatting shared by the history panel. */
export function formatRelativeTime(
  isoTimestamp: string,
  nowMs = Date.now(),
): string {
  const then = Date.parse(isoTimestamp);
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.floor((nowMs - then) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes === 1 ? "1 min ago" : `${minutes} mins ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return days === 1 ? "1 day ago" : `${days} days ago`;
  return new Date(then).toLocaleDateString();
}
