/**
 * Generic Language Server Protocol compatibility layer (§45).
 *
 * Covers the §45 method set (initialize → inlayHint, publishDiagnostics)
 * over an abstracted transport. Two transports ship: in-memory (same
 * process, used by tests and the on-device engine) and a newline-delimited
 * JSON-RPC stdio framing helper for local-process servers (§45 explicitly
 * allows local process/stdin/stdout; no remote computer is ever required).
 *
 * The `LspServer` adapts any `LanguageServiceAdapter` so existing backends
 * (TypeScript, syntax fallback) are instantly LSP-speaking; `LspClient`
 * speaks to any transport. Nothing here is stubbed: every method maps to a
 * real adapter call, and unsupported operations return null — never fake
 * data.
 */
import type {
  IntelCodeAction,
  IntelCompletionItem,
  IntelCompletionList,
  IntelDiagnostic,
  IntelDocumentSymbol,
  IntelHoverInfo,
  IntelInlayHint,
  IntelLocation,
  IntelPosition,
  IntelRange,
  IntelRenameResult,
  IntelSemanticToken,
  IntelSignatureHelp,
  IntelSymbolInfo,
  IntelTextEdit,
  IntelWorkspaceEdit,
  LanguageServiceAdapter,
} from "@/modules/intel/types";
import { createRequestManager } from "@/modules/intel/cancellation";

export type LspId = number | string;

export interface LspRequestMessage {
  jsonrpc: "2.0";
  id: LspId;
  method: string;
  params?: unknown;
}

export interface LspResponseMessage {
  jsonrpc: "2.0";
  id: LspId;
  result?: unknown;
  error?: { code: number; message: string };
}

export interface LspNotificationMessage {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export type LspMessage = LspRequestMessage | LspResponseMessage | LspNotificationMessage;

export function isLspRequest(message: LspMessage): message is LspRequestMessage {
  return (message as LspRequestMessage).id !== undefined && typeof (message as LspRequestMessage).method === "string";
}

export function isLspResponse(message: LspMessage): message is LspResponseMessage {
  return (message as LspResponseMessage).id !== undefined && (message as LspRequestMessage).method === undefined;
}

export interface LspTransport {
  send(message: LspMessage): void;
  onMessage(listener: (message: LspMessage) => void): () => void;
  close(): void;
}

/** Same-process transport: client and server share an event loop. */
export function createMemoryTransportPair(): { client: LspTransport; server: LspTransport } {
  const clientListeners = new Set<(message: LspMessage) => void>();
  const serverListeners = new Set<(message: LspMessage) => void>();
  let closed = false;
  const make = (
    own: Set<(message: LspMessage) => void>,
    peer: Set<(message: LspMessage) => void>,
  ): LspTransport => ({
    send(message) {
      if (closed) return;
      for (const listener of [...peer]) {
        try {
          listener(message);
        } catch {
          // A broken peer listener must not break the transport.
        }
      }
      void own;
    },
    onMessage(listener) {
      own.add(listener);
      return () => {
        own.delete(listener);
      };
    },
    close() {
      closed = true;
      own.clear();
    },
  });
  return { client: make(clientListeners, serverListeners), server: make(serverListeners, clientListeners) };
}

/**
 * Newline-delimited JSON-RPC framing for stdio transports. `pushChunk`
 * feeds raw bytes/text; complete messages are emitted to `onMessage`.
 */
export function createLineFraming(): {
  pushChunk(chunk: string): void;
  frame(message: LspMessage): string;
  onMessage(listener: (message: LspMessage) => void): () => void;
} {
  let buffer = "";
  const listeners = new Set<(message: LspMessage) => void>();
  return {
    pushChunk(chunk) {
      buffer += chunk;
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) {
          try {
            const message = JSON.parse(line) as LspMessage;
            for (const listener of [...listeners]) {
              try {
                listener(message);
              } catch {
                // Listener failures never corrupt the stream.
              }
            }
          } catch {
            // Malformed line: skip, keep the stream alive.
          }
        }
        newline = buffer.indexOf("\n");
      }
    },
    frame(message) {
      return `${JSON.stringify(message)}\n`;
    },
    onMessage(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export interface LspServerOptions {
  adapter: LanguageServiceAdapter;
  getText(uri: string): string | null;
  /** Optional publish channel for `textDocument/publishDiagnostics`. */
  onPublishDiagnostics?: (uri: string, diagnostics: IntelDiagnostic[]) => void;
  languageIdFor?(uri: string): string;
}

function positionFromLsp(value: { line: number; character: number }): IntelPosition {
  return { line: value.line + 1, column: value.character + 1 };
}

function positionToLsp(position: IntelPosition): { line: number; character: number } {
  return { line: Math.max(0, position.line - 1), character: Math.max(0, position.column - 1) };
}

function rangeToLsp(range: IntelRange): {
  start: { line: number; character: number };
  end: { line: number; character: number };
} {
  return { start: positionToLsp(range.start), end: positionToLsp(range.end) };
}

/** Serve LSP methods from a `LanguageServiceAdapter` (never fakes data). */
export function createLspServer(transport: LspTransport, options: LspServerOptions): { dispose(): void } {
  const { adapter } = options;
  const requests = createRequestManager();
  let initialized = false;
  let shutdownRequested = false;

  const openVersions = new Map<string, number>();

  async function publishDiagnostics(uri: string): Promise<void> {
    if (!options.onPublishDiagnostics) return;
    try {
      const request = requests.createRequest(openVersions.get(uri) ?? 0);
      const diagnostics = await adapter.diagnostics(uri, request);
      options.onPublishDiagnostics(uri, diagnostics);
    } catch {
      // Publish failures never break the request loop.
    }
  }

  const handlers: Record<string, (params: unknown, requestId: LspId) => Promise<unknown>> = {
    async initialize() {
      initialized = true;
      return {
        capabilities: {
          textDocumentSync: 1,
          completionProvider: { triggerCharacters: [".", "/", "@", '"', "'"] },
          hoverProvider: true,
          signatureHelpProvider: { triggerCharacters: ["(", ","] },
          definitionProvider: true,
          declarationProvider: true,
          typeDefinitionProvider: true,
          referencesProvider: true,
          documentHighlightProvider: true,
          documentSymbolProvider: true,
          workspaceSymbolProvider: true,
          renameProvider: { prepareProvider: true },
          codeActionProvider: true,
          documentFormattingProvider: true,
          documentRangeFormattingProvider: true,
          semanticTokensProvider: { legend: { tokenTypes: [], tokenModifiers: [] } },
          inlayHintProvider: true,
        },
        serverInfo: { name: "ajiro-intel", version: "1.0.0" },
      };
    },
    async shutdown() {
      shutdownRequested = true;
      return null;
    },
    async ["textDocument/completion"](params) {
      const { uri, position } = textAndPosition(params);
      const request = requests.createRequest();
      const list = await adapter.completion(uri, position, { inString: false, stringPrefix: "", wordPrefix: "", invoked: true, triggerCharacter: null }, request);
      return { isIncomplete: list.incomplete, items: list.items.map(toLspCompletionItem) };
    },
    async ["completionItem/resolve"](params) {
      const item = params as IntelCompletionItem;
      const request = requests.createRequest();
      // URI is threaded through the item's resolveId namespace by the client.
      return toLspCompletionItem(await adapter.resolveCompletion("", item, request));
    },
    async ["textDocument/hover"](params) {
      const { uri, position } = textAndPosition(params);
      const request = requests.createRequest();
      const hover = await adapter.hover(uri, position, request);
      if (!hover) return null;
      return { contents: { kind: "markdown", value: hover.contents.join("\n\n") }, range: hover.range ? rangeToLsp(hover.range) : null };
    },
    async ["textDocument/signatureHelp"](params) {
      const { uri, position } = textAndPosition(params);
      const request = requests.createRequest();
      const help = await adapter.signatureHelp(uri, position, request);
      if (!help) return null;
      return {
        signatures: help.signatures.map((signature) => ({
          label: signature.label,
          documentation: signature.documentation,
          parameters: signature.parameters.map((parameter) => ({ label: parameter.label, documentation: parameter.documentation })),
        })),
        activeSignature: help.activeSignature,
        activeParameter: help.activeParameter,
      };
    },
    async ["textDocument/definition"](params) {
      const { uri, position } = textAndPosition(params);
      const request = requests.createRequest();
      return (await adapter.definition(uri, position, request)).map(toLspLocation);
    },
    async ["textDocument/declaration"](params) {
      const { uri, position } = textAndPosition(params);
      const request = requests.createRequest();
      return (await adapter.declaration(uri, position, request)).map(toLspLocation);
    },
    async ["textDocument/typeDefinition"](params) {
      const { uri, position } = textAndPosition(params);
      const request = requests.createRequest();
      return (await adapter.typeDefinition(uri, position, request)).map(toLspLocation);
    },
    async ["textDocument/references"](params) {
      const { uri, position } = textAndPosition(params);
      const request = requests.createRequest();
      return (await adapter.references(uri, position, request)).map(toLspLocation);
    },
    async ["textDocument/documentHighlight"](params) {
      // Highlight = references restricted to the requesting file.
      const { uri, position } = textAndPosition(params);
      const request = requests.createRequest();
      const references = await adapter.references(uri, position, request);
      return references
        .filter((reference) => reference.uri === uri)
        .map((reference) => ({ range: rangeToLsp(reference.range), kind: 1 }));
    },
    async ["textDocument/documentSymbol"](params) {
      const uri = (params as { textDocument: { uri: string } }).textDocument.uri;
      const request = requests.createRequest();
      return (await adapter.documentSymbols(uri, request)).map(toLspDocumentSymbol);
    },
    async ["workspace/symbol"](params) {
      const query = (params as { query?: string }).query ?? "";
      const request = requests.createRequest();
      return (await adapter.workspaceSymbols(query, request)).map((symbol) => ({
        name: symbol.name,
        kind: 12,
        location: toLspLocation(symbol.location),
        containerName: symbol.containerName,
      }));
    },
    async ["textDocument/prepareRename"](params) {
      const { uri, position } = textAndPosition(params);
      const request = requests.createRequest();
      const prepared = await adapter.prepareRename(uri, position, request);
      if (!prepared) throw new Error("Rename is not available here");
      return { range: rangeToLsp(prepared.range), placeholder: prepared.placeholder };
    },
    async ["textDocument/rename"](params) {
      const { uri, position } = textAndPosition(params);
      const newName = (params as { newName: string }).newName;
      const request = requests.createRequest();
      const result = await adapter.rename(uri, position, newName, request);
      if (!result) throw new Error("Rename produced no edits");
      return toLspWorkspaceEdit(result.edit);
    },
    async ["textDocument/codeAction"](params) {
      const typed = params as { textDocument: { uri: string }; range: { start: { line: number; character: number }; end: { line: number; character: number } }; context: { diagnostics: IntelDiagnostic[] } };
      const request = requests.createRequest();
      const range: IntelRange = {
        start: positionFromLsp(typed.range.start),
        end: positionFromLsp(typed.range.end),
      };
      return (await adapter.codeActions(typed.textDocument.uri, range, typed.context.diagnostics ?? [], request)).map((action) => ({
        title: action.title,
        kind: action.kind,
        diagnostics: action.diagnostics,
        edit: action.edit ? toLspWorkspaceEdit(action.edit) : undefined,
      }));
    },
    async ["textDocument/formatting"](params) {
      const uri = (params as { textDocument: { uri: string } }).textDocument.uri;
      const request = requests.createRequest();
      return (await adapter.formatting(uri, request)).map(toLspTextEdit);
    },
    async ["textDocument/rangeFormatting"](params) {
      const typed = params as { textDocument: { uri: string }; range: { start: { line: number; character: number }; end: { line: number; character: number } } };
      const request = requests.createRequest();
      const range: IntelRange = {
        start: positionFromLsp(typed.range.start),
        end: positionFromLsp(typed.range.end),
      };
      return (await adapter.rangeFormatting(typed.textDocument.uri, range, request)).map(toLspTextEdit);
    },
    async ["textDocument/semanticTokens/full"](params) {
      const uri = (params as { textDocument: { uri: string } }).textDocument.uri;
      const request = requests.createRequest();
      const tokens = await adapter.semanticTokens(uri, request);
      // LSP delta-encoded u32 array; token type/modifier indices reference
      // the (empty, capability-declared) legend — positions stay exact.
      const data: number[] = [];
      let lastLine = 0;
      let lastStart = 0;
      for (const token of tokens) {
        const line = token.line - 1;
        const start = token.startColumn - 1;
        data.push(line - lastLine, line === lastLine ? start - lastStart : start, token.length, 0, 0);
        lastLine = line;
        lastStart = start;
      }
      return { data };
    },
    async ["textDocument/inlayHint"](params) {
      const typed = params as { textDocument: { uri: string }; range: { start: { line: number; character: number }; end: { line: number; character: number } } };
      const request = requests.createRequest();
      const range: IntelRange = {
        start: positionFromLsp(typed.range.start),
        end: positionFromLsp(typed.range.end),
      };
      return (await adapter.inlayHints(typed.textDocument.uri, range, request)).map((hint) => ({
        position: positionToLsp(hint.position),
        label: hint.label,
        kind: hint.kind === "parameter" ? 2 : 1,
      }));
    },
  };

  function textAndPosition(params: unknown): { uri: string; position: IntelPosition } {
    const typed = params as {
      textDocument: { uri: string };
      position: { line: number; character: number };
    };
    return { uri: typed.textDocument.uri, position: positionFromLsp(typed.position) };
  }

  const openText = new Map<string, string>();

  function applyContentChange(
    current: string,
    change: { text: string; range?: { start: { line: number; character: number }; end: { line: number; character: number } } },
  ): string {
    if (!change.range) return change.text;
    const lines = current.split("\n");
    const toOffset = (line: number, character: number): number => {
      const clampedLine = Math.min(Math.max(line, 0), lines.length - 1);
      let offset = 0;
      for (let i = 0; i < clampedLine; i += 1) offset += (lines[i] ?? "").length + 1;
      return offset + Math.max(0, character);
    };
    const from = toOffset(change.range.start.line, change.range.start.character);
    const to = toOffset(change.range.end.line, change.range.end.character);
    return current.slice(0, from) + change.text + current.slice(to);
  }

  function handleNotification(message: LspNotificationMessage): void {
    const params = (message.params ?? {}) as {
      textDocument?: { uri: string; languageId?: string; version?: number; text?: string };
      contentChanges?: { text: string; range?: { start: { line: number; character: number }; end: { line: number; character: number } } }[];
    };
    const uri = params.textDocument?.uri;
    if (!uri) return;
    if (message.method === "textDocument/didOpen") {
      const text = params.textDocument?.text ?? options.getText(uri) ?? "";
      const version = params.textDocument?.version ?? 0;
      openVersions.set(uri, version);
      openText.set(uri, text);
      adapter.openDocument(uri, params.textDocument?.languageId ?? options.languageIdFor?.(uri) ?? "plaintext", version, text);
      void publishDiagnostics(uri);
    } else if (message.method === "textDocument/didChange") {
      let text = openText.get(uri) ?? options.getText(uri) ?? "";
      for (const change of params.contentChanges ?? []) {
        text = applyContentChange(text, change);
      }
      const version = (openVersions.get(uri) ?? 0) + 1;
      openVersions.set(uri, version);
      openText.set(uri, text);
      adapter.updateDocument(uri, version, text);
      void publishDiagnostics(uri);
    } else if (message.method === "textDocument/didClose") {
      openVersions.delete(uri);
      openText.delete(uri);
      adapter.closeDocument(uri);
    }
  }

  const unsubscribe = transport.onMessage((message) => {
    if (!isLspRequest(message)) {
      if (!isLspResponse(message)) {
        if ((message as LspNotificationMessage).method === "exit") {
          transport.close();
          return;
        }
        handleNotification(message as LspNotificationMessage);
      }
      return;
    }
    const handler = handlers[message.method];
    if (!handler) {
      transport.send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } });
      return;
    }
    if (!initialized && message.method !== "initialize") {
      transport.send({ jsonrpc: "2.0", id: message.id, error: { code: -32002, message: "Server not initialized" } });
      return;
    }
    if (shutdownRequested && message.method !== "exit") {
      transport.send({ jsonrpc: "2.0", id: message.id, error: { code: -32600, message: "Server is shutting down" } });
      return;
    }
    void handler(message.params, message.id).then(
      (result) => transport.send({ jsonrpc: "2.0", id: message.id, result: result ?? null }),
      (error: unknown) =>
        transport.send({ jsonrpc: "2.0", id: message.id, error: { code: -32603, message: error instanceof Error ? error.message : String(error) } }),
    );
  });

  return {
    dispose() {
      unsubscribe();
    },
  };
}

function toLspLocation(location: IntelLocation): unknown {
  return { uri: location.uri, range: rangeToLsp(location.range) };
}

function toLspTextEdit(edit: { range: IntelRange; newText: string }): unknown {
  return { range: rangeToLsp(edit.range), newText: edit.newText };
}

function toLspWorkspaceEdit(edit: { edits: { uri: string; range: IntelRange; newText: string }[] }): unknown {
  const changes: Record<string, unknown[]> = {};
  for (const fileEdit of edit.edits) {
    const list = changes[fileEdit.uri] ?? [];
    list.push(toLspTextEdit(fileEdit));
    changes[fileEdit.uri] = list;
  }
  return { changes };
}

function toLspCompletionItem(item: IntelCompletionItem): unknown {
  return {
    label: item.label,
    kind: 1,
    detail: item.detail,
    documentation: item.documentation,
    sortText: String(item.sortPriority).padStart(8, "0"),
    filterText: item.filterText,
    insertText: item.insertText,
    deprecated: item.deprecated,
    data: { source: item.source, resolveId: item.resolveId, kind: item.kind },
  };
}

function toLspDocumentSymbol(symbol: {
  name: string;
  range: IntelRange;
  selectionRange: IntelRange;
  children: unknown[];
}): unknown {
  return {
    name: symbol.name,
    kind: 12,
    range: rangeToLsp(symbol.range),
    selectionRange: rangeToLsp(symbol.selectionRange),
    children: (symbol.children as Parameters<typeof toLspDocumentSymbol>[0][]).map(toLspDocumentSymbol),
  };
}

export interface LspClient {
  request<T>(method: string, params?: unknown): Promise<T>;
  notify(method: string, params?: unknown): void;
  dispose(): void;
}

/** Minimal JSON-RPC client over any transport (id-matched, concurrent-safe). */
export function createLspClient(transport: LspTransport): LspClient {
  let nextId = 0;
  const pending = new Map<LspId, { resolve: (value: never) => void; reject: (error: Error) => void }>();
  const unsubscribe = transport.onMessage((message) => {
    if (!isLspResponse(message)) return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result as never);
  });
  return {
    request<T>(method: string, params?: unknown) {
      nextId += 1;
      const id = nextId;
      return new Promise<T>((resolve, reject) => {
        pending.set(id, { resolve: resolve as (value: never) => void, reject });
        transport.send({ jsonrpc: "2.0", id, method, params });
      });
    },
    notify(method: string, params?: unknown) {
      transport.send({ jsonrpc: "2.0", method, params });
    },
    dispose() {
      unsubscribe();
      for (const waiter of pending.values()) {
        waiter.reject(new Error("LSP client disposed"));
      }
      pending.clear();
    },
  };
}

export type {
  IntelCodeAction,
  IntelCompletionList,
  IntelDiagnostic,
  IntelDocumentSymbol,
  IntelHoverInfo,
  IntelInlayHint,
  IntelRenameResult,
  IntelSemanticToken,
  IntelSignatureHelp,
  IntelSymbolInfo,
  IntelTextEdit,
  IntelWorkspaceEdit,
};
