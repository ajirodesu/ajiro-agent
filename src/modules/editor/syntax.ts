/**
 * Shared syntax highlighting for the code editor: refractor HAST flattened
 * to colored runs. Same token discipline as the chat code blocks; unknown
 * languages and oversized inputs fall back to plain text. Node-safe.
 */
import { refractor } from "refractor";
import jsx from "refractor/jsx";
import tsx from "refractor/tsx";

refractor.register(jsx);
refractor.register(tsx);

export const MAX_HIGHLIGHT_CHARS = 200_000;

export type HighlightRun = {
  text: string;
  color: string | null;
  bold?: boolean;
  italic?: boolean;
};

export type SyntaxPalette = {
  base: string;
  keyword: string;
  string: string;
  comment: string;
  number: string;
  function: string;
  type: string;
  property: string;
  tag: string;
  punctuation: string;
};

type HastNode =
  | { type: "text"; value: string }
  | {
      type: "element";
      properties?: { className?: unknown };
      children: HastNode[];
    };

function tokenColor(
  classNames: string[],
  palette: SyntaxPalette,
): Omit<HighlightRun, "text"> {
  const set = new Set(classNames);
  if (set.has("comment")) return { color: palette.comment, italic: true };
  if (set.has("string") || set.has("char") || set.has("regex"))
    return { color: palette.string };
  if (set.has("number") || set.has("boolean"))
    return { color: palette.number };
  if (set.has("keyword") || set.has("operator") || set.has("important"))
    return { color: palette.keyword, bold: true };
  if (set.has("function")) return { color: palette.function };
  if (
    set.has("class-name") ||
    set.has("type") ||
    set.has("builtin") ||
    set.has("constant")
  )
    return { color: palette.type };
  if (set.has("property") || set.has("attr-name") || set.has("variable"))
    return { color: palette.property };
  if (set.has("tag") || set.has("selector"))
    return { color: palette.tag };
  if (set.has("punctuation")) return { color: palette.punctuation };
  return { color: null };
}

function flatten(
  nodes: HastNode[],
  inherited: Omit<HighlightRun, "text">,
  palette: SyntaxPalette,
  runs: HighlightRun[],
): void {
  for (const node of nodes) {
    if (node.type === "text") {
      if (node.value) runs.push({ ...inherited, text: node.value });
      continue;
    }
    const raw = node.properties?.className;
    const classNames = Array.isArray(raw)
      ? raw.filter((entry): entry is string => typeof entry === "string")
      : [];
    const own = tokenColor(classNames, palette);
    flatten(node.children, { ...inherited, ...own }, palette, runs);
  }
}

export function highlightToRuns(
  code: string,
  language: string | null,
  palette: SyntaxPalette,
): HighlightRun[] | null {
  if (!language || !refractor.registered(language)) return null;
  if (code.length > MAX_HIGHLIGHT_CHARS) return null;
  try {
    const root = refractor.highlight(code, language)
      .children as HastNode[];
    const runs: HighlightRun[] = [];
    flatten(root, { color: palette.base }, palette, runs);
    // Coalesce adjacent same-style runs to keep the render tree small.
    const merged: HighlightRun[] = [];
    for (const run of runs) {
      const last = merged[merged.length - 1];
      if (
        last &&
        last.color === run.color &&
        last.bold === run.bold &&
        last.italic === run.italic
      ) {
        last.text += run.text;
      } else {
        merged.push({ ...run });
      }
    }
    return merged;
  } catch {
    return null;
  }
}
