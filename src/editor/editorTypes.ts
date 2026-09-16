/**
 * Editor message protocol — the SOLE bridge between React Native and the
 * offline CodeMirror WebView.
 *
 * RN → WebView (`EditorWebViewInbound`) drives document, grammar, theme,
 * history, and search. WebView → RN (`EditorWebViewOutbound`) reports
 * readiness, text changes, and cursor movement. Everything crossing the
 * boundary is JSON-serializable; document text travels verbatim.
 */
export interface EditorTheme {
  dark: boolean;
  /** Editor chrome background. */
  background: string;
  /** Default text color. */
  foreground: string;
  gutterBackground: string;
  gutterForeground: string;
  cursor: string;
  /** Selection background (any CSS color, rgba allowed). */
  selection: string;
  /** Active-line background. */
  activeLine: string;
  /** Matching-bracket background. */
  matchingBracket: string;
  keyword: string;
  string: string;
  comment: string;
  number: string;
  function: string;
  type: string;
  operator: string;
  tag: string;
  attribute: string;
  variable: string;
  punctuation: string;
  regex: string;
}

export type EditorSearchAction =
  | "next"
  | "prev"
  | "replace-one"
  | "replace-all"
  | "select-next";

export type EditorWebViewInbound =
  | { type: "set-doc"; text: string }
  | { type: "grammar"; key: string | null }
  | { type: "theme"; theme: EditorTheme }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "indent"; outdent: boolean }
  | { type: "focus" }
  | {
      type: "search";
      action: EditorSearchAction;
      query: string;
      replace?: string;
    }
  | { type: "count"; query: string };

export type EditorWebViewOutbound =
  | { type: "ready" }
  | { type: "change"; text: string }
  | { type: "cursor"; line: number; column: number }
  | { type: "find-count"; count: number }
  | { type: "error"; message: string };
