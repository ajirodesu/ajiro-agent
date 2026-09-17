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
  /** 1px gutter/code separator line (theme border token). */
  gutterBorder: string;
  /** Faint indentation-guide color (low-contrast theme token). */
  indentGuide: string;
  /** Warning/attention color for the footer warning count. */
  warning: string;
  /** Error color for diagnostic squiggles and the footer error count. */
  error: string;
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

/**
 * Coding-intelligence payloads (§3 pipeline). All intel traffic is
 * additive: `op`/`id` envelopes multiplex over the same inbox channel, and
 * old hosts ignore unknown `intel:*` ops. Positions are 1-based
 * line/column; ranges are end-exclusive.
 */
export type IntelBridgePosition = { line: number; column: number };
export type IntelBridgeRange = {
  start: IntelBridgePosition;
  end: IntelBridgePosition;
};

export type EditorIntelInbound =
  /** Host → WebView: enable/disable the semantic engine + feature flags. */
  | {
      type: "intel:configure";
      enabled: boolean;
      features: {
        semanticCompletion: boolean;
        hover: boolean;
        signatureHelp: boolean;
        semanticTokens: boolean;
        inlayHints: boolean;
        inlineGhost: boolean;
      };
    }
  /** Host → WebView: open/update a project file snapshot for the TS host. */
  | { type: "intel:file"; uri: string; version: number; text: string | null }
  /** Host → WebView: switch the open document identity (tab switch). */
  | { type: "intel:reopen"; uri: string; version: number; text: string }
  /** Host → WebView: response to an `intel:need-file` request. */
  | {
      type: "intel:file-response";
      id: number;
      uri: string;
      version: number;
      text: string | null;
    }
  /** Host → WebView: workspace aux data (symbols, snippets, paths, AI). */
  | {
      type: "intel:aux-data";
      symbols: { label: string; kind: string; detail: string | null; uri: string }[];
      snippets: { prefix: string; body: string; description: string }[];
      paths: {
        files: string[];
        directories: string[];
        dependencies: string[];
        devDependencies: string[];
        aliases: Record<string, string[]>;
      };
      aiItems: { label: string; insertText: string; detail: string | null }[];
      maxItems: number;
      aiEnabled: boolean;
      snippetsEnabled: boolean;
    }
  /** Host → WebView: run a query (panels, palette) against the engine. */
  | {
      type: "intel:query";
      id: number;
      op:
        | "hover"
        | "signature"
        | "definition"
        | "declaration"
        | "type-definition"
        | "references"
        | "outline"
        | "symbols"
        | "diagnose"
        | "rename-prepare"
        | "rename-apply"
        | "code-actions"
        | "format"
        | "range-format"
        | "organize"
        | "refactors"
        | "refactor-apply";
      line: number;
      column: number;
      query?: string;
      newName?: string;
      range?: IntelBridgeRange;
      diagnostics?: {
        severity: string;
        message: string;
        code: string | number | null;
        range: IntelBridgeRange;
      }[];
      refactorName?: string;
      actionName?: string;
    }
  /** Host → WebView: apply a workspace edit produced on the RN side. */
  | {
      type: "intel:apply-edit";
      id: number;
      edits: { range: IntelBridgeRange; newText: string }[];
    }
  /** Host → WebView: ghost-text suggestion for inline completion. */
  | { type: "intel:ghost"; id: number; text: string | null }
  /** Host → WebView: show the hover tooltip at the cursor. */
  | { type: "intel:inspect" };

export type EditorIntelOutbound =
  /** WebView → Host: the TS host needs a file snapshot (project-wide op). */
  | { type: "intel:need-file"; id: number; uri: string }
  /** WebView → Host: answer to an `intel:query`. */
  | { type: "intel:result"; id: number; ok: boolean; payload?: unknown; error?: string }
  /** WebView → Host: semantic diagnostics for the open document. */
  | {
      type: "intel:diagnostics";
      version: number;
      diagnostics: {
        severity: string;
        message: string;
        code: string | number | null;
        range: IntelBridgeRange;
      }[];
    }
  /** WebView → Host: open another file (definition in another file). */
  | { type: "intel:open-file"; uri: string; line: number; column: number }
  /**
   * WebView → Host: completion produced edits outside the open document
   * (rare cross-file auto-imports). The host applies them to its store.
   */
  | {
      type: "intel:apply-local-edits";
      edits: { uri: string; range: IntelBridgeRange; newText: string }[];
    };

export type EditorWebViewInbound =
  | { type: "set-doc"; text: string }
  | { type: "goto-line"; line: number; column?: number }
  | { type: "grammar"; key: string | null }
  | { type: "theme"; theme: EditorTheme }
  | { type: "autocomplete"; enabled: boolean }
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
  | { type: "count"; query: string }
  | { type: "fold-all" }
  | { type: "unfold-all" }
  /**
   * Canonical chord ids a plugin command currently owns (§45). The document
   * claims only these chords, so plugin bindings can never swallow ordinary
   * typing, and the RN side decides what a chord *does*.
   */
  | { type: "keybindings"; chords: string[] }
  /** Coding-intelligence ops (additive; old bootstraps ignore them). */
  | EditorIntelInbound;

export type EditorWebViewOutbound =
  | { type: "ready" }
  | { type: "change"; text: string }
  | { type: "cursor"; line: number; column: number }
  | { type: "find-count"; count: number }
  /** A chord claimed by a plugin command was pressed in the editor. */
  | { type: "command-key"; chord: string }
  | { type: "error"; message: string }
  /** Intel ops (WebView → Host). Unknown to old hosts, safely ignored. */
  | EditorIntelOutbound;

/** Intel ops (Host → WebView). Dispatched by the bootstrap intel handler. */
export type EditorWebViewIntelInbound = EditorIntelInbound;
