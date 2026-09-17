/**
 * Coding-intelligence data contracts (§52) + the `LanguageServiceAdapter`
 * interface (§4).
 *
 * Everything crossing the RN ↔ WebView bridge or the intel engine boundary
 * uses these JSON-serializable types. No `any` anywhere in the protocol.
 */

export type IntelPosition = { line: number; column: number };
/** 1-based, end-exclusive range. */
export type IntelRange = { start: IntelPosition; end: IntelPosition };
export type IntelLocation = { uri: string; range: IntelRange };

export type IntelSeverity = "error" | "warning" | "info" | "hint";

export interface IntelDiagnosticRelated {
  location: IntelLocation;
  message: string;
}

export interface IntelDiagnostic {
  severity: IntelSeverity;
  message: string;
  /** Stable source id, e.g. "ts-semantic", "syntax", "git-conflict". */
  source: string;
  code: string | number | null;
  range: IntelRange;
  related: IntelDiagnosticRelated[];
  /** True when at least one quick fix is available for this diagnostic. */
  fixable: boolean;
}

export type IntelCompletionKind =
  | "text"
  | "method"
  | "function"
  | "constructor"
  | "field"
  | "variable"
  | "class"
  | "interface"
  | "module"
  | "property"
  | "unit"
  | "value"
  | "enum"
  | "enum-member"
  | "keyword"
  | "snippet"
  | "color"
  | "file"
  | "reference"
  | "folder"
  | "type-parameter"
  | "constant"
  | "struct"
  | "event"
  | "operator"
  | "type-alias";

export type IntelCompletionSource =
  | "semantic"
  | "project-symbol"
  | "imported-symbol"
  | "local"
  | "workspace-symbol"
  | "snippet"
  | "path"
  | "package"
  | "keyword"
  | "emmet"
  | "ai";

export interface IntelCompletionItem {
  label: string;
  kind: IntelCompletionKind;
  detail: string | null;
  documentation: string | null;
  /** Lower sorts first. Deterministic across runs for equal labels. */
  sortPriority: number;
  filterText: string | null;
  insertText: string;
  /** Replacement range in the requesting document, when precise. */
  replaceRange: IntelRange | null;
  commitCharacters: string[];
  /** Extra edits applied alongside the completion (e.g. auto-import). */
  additionalEdits: IntelTextEdit[];
  source: IntelCompletionSource;
  deprecated: boolean;
  /** Stable id for resolve-on-demand flows. */
  resolveId: string | null;
}

export interface IntelCompletionList {
  items: IntelCompletionItem[];
  incomplete: boolean;
}

export interface IntelHoverInfo {
  /** Markdown-ish plain text; the renderer decides presentation. */
  contents: string[];
  range: IntelRange | null;
}

export interface IntelParameterInfo {
  label: string;
  documentation: string | null;
}

export interface IntelSignatureInfo {
  label: string;
  documentation: string | null;
  parameters: IntelParameterInfo[];
}

export interface IntelSignatureHelp {
  signatures: IntelSignatureInfo[];
  activeSignature: number;
  activeParameter: number;
}

export interface IntelTextEdit {
  uri: string;
  range: IntelRange;
  newText: string;
}

export interface IntelWorkspaceEdit {
  edits: IntelTextEdit[];
  /** Human summary for preview UI ("3 files, 5 edits"). */
  summary: string;
}

export type IntelSymbolKind =
  | "file"
  | "module"
  | "namespace"
  | "package"
  | "class"
  | "method"
  | "property"
  | "field"
  | "constructor"
  | "enum"
  | "interface"
  | "function"
  | "variable"
  | "constant"
  | "string"
  | "number"
  | "boolean"
  | "array"
  | "object"
  | "key"
  | "null"
  | "enum-member"
  | "struct"
  | "event"
  | "operator"
  | "type-parameter"
  | "type-alias";

export interface IntelDocumentSymbol {
  name: string;
  kind: IntelSymbolKind;
  range: IntelRange;
  selectionRange: IntelRange;
  children: IntelDocumentSymbol[];
}

export interface IntelSymbolInfo {
  name: string;
  kind: IntelSymbolKind;
  location: IntelLocation;
  containerName: string | null;
}

export interface IntelCodeAction {
  title: string;
  kind: string;
  diagnostics: IntelDiagnostic[];
  edit: IntelWorkspaceEdit | null;
  /** When true the action needs a second resolve round-trip. */
  needsResolve: boolean;
  actionId: string | null;
}

export interface IntelInlayHint {
  position: IntelPosition;
  label: string;
  kind: "type" | "parameter" | "generic";
}

export interface IntelSemanticToken {
  line: number;
  startColumn: number;
  length: number;
  tokenType: string;
  tokenModifiers: string[];
}

export interface IntelRenameResult {
  edit: IntelWorkspaceEdit;
  /** Per-file change counts for preview UI. */
  fileChangeCounts: { uri: string; changes: number }[];
}

export interface IntelCapabilities {
  semantic: boolean;
  syntax: boolean;
  formatting: boolean;
  diagnostics: boolean;
  navigation: boolean;
}

export type IntelServiceStatus =
  | { state: "ready" }
  | { state: "degraded"; reason: string }
  | { state: "unavailable"; reason: string };

/** Cancellation + versioning envelope carried by every async request (§53). */
export interface IntelRequest {
  /** Monotonic id per session; newer ids supersede older ones. */
  requestId: number;
  /** Document version the request was issued against. */
  documentVersion: number;
  cancelled: boolean;
  cancel(): void;
  throwIfCancelled(): void;
  isStale(currentDocumentVersion: number): boolean;
}

export interface IntelCompletionContext {
  /** True when the cursor sits inside a string literal (path completion). */
  inString: boolean;
  stringPrefix: string;
  /** Word immediately before the cursor. */
  wordPrefix: string;
  /** True when the trigger was an explicit user invocation. */
  invoked: boolean;
  triggerCharacter: string | null;
}

export interface IntelServiceFactory {
  createRequest(): IntelRequest;
}

/**
 * Language-service abstraction (§4). One implementation per language
 * backend; the engine fans out by document language id and merges results.
 * All offsets are 1-based line/column positions in the *request-time*
 * document snapshot; implementations must validate the request version.
 */
export interface LanguageServiceAdapter {
  readonly languageIds: readonly string[];
  initialize(): Promise<void>;
  dispose(): Promise<void>;
  openDocument(uri: string, languageId: string, version: number, text: string): void;
  updateDocument(uri: string, version: number, text: string): void;
  closeDocument(uri: string): void;

  diagnostics(uri: string, request: IntelRequest): Promise<IntelDiagnostic[]>;
  completion(
    uri: string,
    position: IntelPosition,
    context: IntelCompletionContext,
    request: IntelRequest,
  ): Promise<IntelCompletionList>;
  resolveCompletion(
    uri: string,
    item: IntelCompletionItem,
    request: IntelRequest,
  ): Promise<IntelCompletionItem>;
  hover(uri: string, position: IntelPosition, request: IntelRequest): Promise<IntelHoverInfo | null>;
  signatureHelp(
    uri: string,
    position: IntelPosition,
    request: IntelRequest,
  ): Promise<IntelSignatureHelp | null>;
  definition(uri: string, position: IntelPosition, request: IntelRequest): Promise<IntelLocation[]>;
  declaration(uri: string, position: IntelPosition, request: IntelRequest): Promise<IntelLocation[]>;
  typeDefinition(uri: string, position: IntelPosition, request: IntelRequest): Promise<IntelLocation[]>;
  references(uri: string, position: IntelPosition, request: IntelRequest): Promise<IntelLocation[]>;
  documentSymbols(uri: string, request: IntelRequest): Promise<IntelDocumentSymbol[]>;
  workspaceSymbols(query: string, request: IntelRequest): Promise<IntelSymbolInfo[]>;
  prepareRename(
    uri: string,
    position: IntelPosition,
    request: IntelRequest,
  ): Promise<{ range: IntelRange; placeholder: string } | null>;
  rename(
    uri: string,
    position: IntelPosition,
    newName: string,
    request: IntelRequest,
  ): Promise<IntelRenameResult | null>;
  codeActions(
    uri: string,
    range: IntelRange,
    diagnostics: IntelDiagnostic[],
    request: IntelRequest,
  ): Promise<IntelCodeAction[]>;
  formatting(uri: string, request: IntelRequest): Promise<IntelTextEdit[]>;
  rangeFormatting(uri: string, range: IntelRange, request: IntelRequest): Promise<IntelTextEdit[]>;
  organizeImports(uri: string, request: IntelRequest): Promise<IntelTextEdit[]>;
  semanticTokens(uri: string, request: IntelRequest): Promise<IntelSemanticToken[]>;
  inlayHints(uri: string, range: IntelRange, request: IntelRequest): Promise<IntelInlayHint[]>;
  capabilities(): IntelCapabilities;
  status(): IntelServiceStatus;
}

export function emptyCompletionList(): IntelCompletionList {
  return { items: [], incomplete: false };
}

/** Structural guard for completion items crossing the bridge. */
export function isIntelCompletionItem(value: unknown): value is IntelCompletionItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.label === "string" &&
    typeof item.insertText === "string" &&
    typeof item.sortPriority === "number" &&
    typeof item.source === "string"
  );
}
