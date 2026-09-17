/**
 * WebView intel entry — bundled by `scripts/vendor-intel.mjs` into
 * `src/editor/intelBundle.ts` as `window.AjiroIntel` (offline, no CDN).
 *
 * Lives beside CodeMirror in the editor WebView (a real JS engine), so the
 * TypeScript language service runs OFF the React Native thread (§29). The
 * RN side owns documents, index, snippets, settings, and AI; this session
 * owns the semantic engine over its synced file map plus RN-pushed aux
 * data (symbols, snippets, paths, AI items), merged deterministically.
 *
 * Degradation is explicit: unknown files are absent from the program until
 * pushed (open docs are always present), and every public method validates
 * versions so stale results never render.
 */
import * as ts from "typescript";

import { createRequestManager } from "@/modules/intel/cancellation";
import { mergeCompletions } from "@/modules/intel/completion";
import { aliasPrefixesFor, completePaths } from "@/modules/intel/paths";
import { createSnippetRegistry } from "@/modules/intel/snippets";
import { createTypeScriptService } from "@/modules/intel/typescript-service";
import type {
  IntelCompletionItem,
  IntelDiagnostic,
  IntelDocumentSymbol,
  IntelInlayHint,
  IntelLocation,
  IntelPosition,
  IntelRange,
  IntelSemanticToken,
  IntelSignatureHelp,
} from "@/modules/intel/types";
import { INTEL_LIB_FILES } from "./intel-libs.gen";

export interface IntelAuxSymbol {
  label: string;
  kind: string;
  detail: string | null;
  uri: string;
}

export interface IntelAuxData {
  symbols: IntelAuxSymbol[];
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

export interface IntelCmCompletion {
  label: string;
  kind: IntelCompletionItem["kind"];
  detail: string | null;
  documentation: string | null;
  insertText: string;
  source: string;
  deprecated: boolean;
  commitCharacters: string[];
  additionalEdits: { uri: string; range: IntelRange; newText: string }[];
  resolveKey: string | null;
}

export interface IntelSessionFeatures {
  semanticCompletion: boolean;
  hover: boolean;
  signatureHelp: boolean;
  semanticTokens: boolean;
  inlayHints: boolean;
  inlineGhost: boolean;
}

export interface IntelSessionEvents {
  /** Post a bridge message to React Native. */
  post(message: Record<string, unknown>): void;
}

export interface IntelWebSession {
  configure(enabled: boolean, features: Partial<IntelSessionFeatures>): void;
  setOpenDocument(uri: string, version: number, text: string): void;
  setProjectFile(uri: string, version: number, text: string | null): void;
  setProjectFileList(uris: string[]): void;
  setAuxData(aux: IntelAuxData): void;
  complete(
    uri: string,
    version: number,
    line: number,
    column: number,
    wordPrefix: string,
    inString: boolean,
    stringPrefix: string,
    invoked: boolean,
    triggerCharacter: string | null,
  ): Promise<IntelCmCompletion[]>;
  resolveCompletion(uri: string, key: string): Promise<Pick<IntelCmCompletion, "detail" | "documentation" | "additionalEdits"> | null>;
  hover(uri: string, version: number, line: number, column: number): Promise<{ contents: string[] } | null>;
  signature(uri: string, version: number, line: number, column: number): Promise<IntelSignatureHelp | null>;
  definition(uri: string, version: number, line: number, column: number): Promise<IntelLocation[]>;
  declaration(uri: string, version: number, line: number, column: number): Promise<IntelLocation[]>;
  typeDefinition(uri: string, version: number, line: number, column: number): Promise<IntelLocation[]>;
  references(uri: string, version: number, line: number, column: number): Promise<IntelLocation[]>;
  workspaceSymbols(query: string): Promise<{ name: string; kind: string; uri: string; range: IntelRange }[]>;
  prepareRename(
    uri: string,
    version: number,
    line: number,
    column: number,
  ): Promise<{ range: IntelRange; placeholder: string } | null>;
  renameApply(
    uri: string,
    version: number,
    line: number,
    column: number,
    newName: string,
  ): Promise<{ edits: { uri: string; range: IntelRange; newText: string }[]; summary: string } | null>;
  codeActions(
    uri: string,
    version: number,
    range: IntelRange,
    diagnostics: IntelDiagnostic[],
  ): Promise<{ title: string; kind: string; actionId: string | null; edit: { edits: { uri: string; range: IntelRange; newText: string }[]; summary: string } | null }[]>;
  formatDocument(uri: string, version: number): Promise<{ range: IntelRange; newText: string }[]>;
  formatRange(uri: string, version: number, range: IntelRange): Promise<{ range: IntelRange; newText: string }[]>;
  organizeDocument(uri: string, version: number): Promise<{ range: IntelRange; newText: string }[]>;
  applicableRefactors(
    uri: string,
    version: number,
    range: IntelRange,
  ): { name: string; description: string; actions: { name: string; description: string }[] }[];
  refactorApply(
    uri: string,
    version: number,
    range: IntelRange,
    refactorName: string,
    actionName: string,
  ): { edits: { uri: string; range: IntelRange; newText: string }[] };
  outline(uri: string, version: number): Promise<IntelDocumentSymbol[]>;
  diagnose(uri: string, version: number): Promise<IntelDiagnostic[]>;
  tokens(uri: string, version: number): Promise<IntelSemanticToken[]>;
  inlay(uri: string, version: number, range: IntelRange): Promise<IntelInlayHint[]>;
  dispose(): void;
}

const MAX_PROJECT_PUSH = 150;

function positionOf(line: number, column: number): IntelPosition {
  return { line, column };
}

export function createIntelWebSession(events: IntelSessionEvents): IntelWebSession {
  const libFiles = new Map<string, string>(Object.entries(INTEL_LIB_FILES));
  const service = createTypeScriptService({ ts, libFiles });
  void service.initialize();
  const snippets = createSnippetRegistry();

  let enabled = true;
  let features: IntelSessionFeatures = {
    semanticCompletion: true,
    hover: true,
    signatureHelp: true,
    semanticTokens: true,
    inlayHints: true,
    inlineGhost: true,
  };
  let aux: IntelAuxData = {
    symbols: [],
    snippets: [],
    paths: { files: [], directories: [], dependencies: [], devDependencies: [], aliases: {} },
    aiItems: [],
    maxItems: 50,
    aiEnabled: false,
    snippetsEnabled: true,
  };
  const openDocs = new Map<string, { version: number; text: string }>();
  const pendingFiles = new Map<string, boolean>();
  let disposed = false;

  function isJsTs(uri: string): boolean {
    return /\.(m|c)?(ts|tsx|js|jsx)$/i.test(uri);
  }

  function checkFresh(uri: string, version: number): boolean {
    if (disposed || !enabled) return false;
    const open = openDocs.get(uri);
    return !open || open.version === version;
  }

  function syncOpenDoc(uri: string): void {
    const open = openDocs.get(uri);
    if (!open) return;
    service.openDocument(uri, "typescript", open.version, open.text);
  }

  return {
    configure(nextEnabled, nextFeatures) {
      enabled = nextEnabled;
      features = { ...features, ...nextFeatures };
    },

    setOpenDocument(uri, version, text) {
      const previous = openDocs.get(uri);
      if (previous && previous.version === version && previous.text === text) return;
      openDocs.set(uri, { version, text });
      service.openDocument(uri, "typescript", version, text);
    },

    setProjectFile(uri, version, text) {
      pendingFiles.delete(uri);
      service.setProjectFile(uri, version, text);
    },

    setProjectFileList(uris) {
      // Lazy project sync: request unknown TS/JS files (bounded); RN
      // answers with `intel:file` pushes. Open docs are never re-fetched.
      let requested = 0;
      for (const uri of uris) {
        if (requested >= MAX_PROJECT_PUSH) break;
        if (!isJsTs(uri) || openDocs.has(uri) || pendingFiles.has(uri)) continue;
        pendingFiles.set(uri, true);
        requested += 1;
        events.post({ type: "intel:need-file", id: Date.now() + requested, uri });
      }
    },

    setAuxData(next) {
      aux = next;
    },

    async complete(uri, version, line, column, wordPrefix, inString, stringPrefix, invoked, triggerCharacter) {
      if (!checkFresh(uri, version)) return [];
      syncOpenDoc(uri);
      const position = positionOf(line, column);
      const lists: IntelCompletionItem[][] = [];
      if (enabled && features.semanticCompletion && isJsTs(uri)) {
        try {
                    const request = createRequestManager(() => version).createRequest(version);
          const semantic = await service.completion(
            uri,
            position,
            { inString, stringPrefix, wordPrefix, invoked, triggerCharacter },
            request,
          );
          lists.push(semantic.items);
        } catch {
          // Semantic failure degrades to aux sources.
        }
      }
      // Aux: workspace/project symbols.
      lists.push(
        aux.symbols
          .filter((symbol) => !wordPrefix || symbol.label.toLowerCase().startsWith(wordPrefix.toLowerCase()))
          .slice(0, 30)
          .map((symbol, index) => ({
            label: symbol.label,
            kind: "variable" as const,
            detail: symbol.detail,
            documentation: null,
            sortPriority: 100 + index,
            filterText: symbol.label,
            insertText: symbol.label,
            replaceRange: null,
            commitCharacters: [],
            additionalEdits: [],
            source: "workspace-symbol" as const,
            deprecated: false,
            resolveId: null,
          })),
      );
      // Aux: snippets.
      if (aux.snippetsEnabled) {
        for (const snippet of aux.snippets) {
          if (wordPrefix && !snippet.prefix.toLowerCase().startsWith(wordPrefix.toLowerCase())) continue;
          lists.push([snippets.toCompletionItem({ id: `aux:${snippet.prefix}`, languageIds: "all", prefix: snippet.prefix, body: snippet.body, description: snippet.description, origin: "user" }, 300)]);
        }
      }
      // Aux: paths inside strings.
      if (inString) {
        lists.push(
          completePaths(
            {
              files: aux.paths.files,
              directories: aux.paths.directories,
              dependencies: aux.paths.dependencies,
              devDependencies: aux.paths.devDependencies,
              aliasPrefixes: [...aliasPrefixesFor(aux.paths.aliases), ...Object.keys(aux.paths.aliases)],
            },
            uri,
            stringPrefix,
          ),
        );
      }
      // Aux: AI items (pushed, never fetched).
      if (aux.aiEnabled) {
        lists.push(
          aux.aiItems.slice(0, 3).map((item, index) => ({
            label: item.label,
            kind: "text" as const,
            detail: item.detail ?? "AI suggestion",
            documentation: null,
            sortPriority: 9000 + index,
            filterText: null,
            insertText: item.insertText,
            replaceRange: null,
            commitCharacters: [],
            additionalEdits: [],
            source: "ai" as const,
            deprecated: false,
            resolveId: null,
          })),
        );
      }
      const merged = mergeCompletions(lists, { maxItems: aux.maxItems, prefix: wordPrefix });
      // Eagerly resolve the top items so the info panel has content.
      const top = merged.slice(0, 5);
      await Promise.all(
        top.map(async (item) => {
          if (!item.resolveId) return;
          try {
                        const request = createRequestManager(() => version).createRequest(version);
            const resolved = await service.resolveCompletion(uri, item, request);
            item.detail = resolved.detail ?? item.detail;
            item.documentation = resolved.documentation ?? item.documentation;
            item.additionalEdits = resolved.additionalEdits;
          } catch {
            // Unresolved items keep their terse form.
          }
        }),
      );
      return merged.map((item) => ({
        label: item.label,
        kind: item.kind,
        detail: item.detail,
        documentation: item.documentation,
        insertText: item.insertText,
        source: item.source,
        deprecated: item.deprecated,
        commitCharacters: item.commitCharacters,
        additionalEdits: item.additionalEdits,
        resolveKey: item.resolveId,
      }));
    },

    async resolveCompletion(uri, key) {
      const [label] = key.split("@@");
            const open = openDocs.get(uri);
      const request = createRequestManager(() => open?.version ?? 0).createRequest(open?.version ?? 0);
      try {
        const resolved = await service.resolveCompletion(
          uri,
          {
            label: label ?? key,
            kind: "property",
            detail: null,
            documentation: null,
            sortPriority: 0,
            filterText: null,
            insertText: label ?? key,
            replaceRange: null,
            commitCharacters: [],
            additionalEdits: [],
            source: "semantic",
            deprecated: false,
            resolveId: key,
          },
          request,
        );
        return { detail: resolved.detail, documentation: resolved.documentation, additionalEdits: resolved.additionalEdits };
      } catch {
        return null;
      }
    },

    async hover(uri, version, line, column) {
      if (!checkFresh(uri, version) || !features.hover) return null;
      syncOpenDoc(uri);
            const request = createRequestManager(() => version).createRequest(version);
      try {
        return await service.hover(uri, positionOf(line, column), request);
      } catch {
        return null;
      }
    },

    async signature(uri, version, line, column) {
      if (!checkFresh(uri, version) || !features.signatureHelp) return null;
      syncOpenDoc(uri);
            const request = createRequestManager(() => version).createRequest(version);
      try {
        return await service.signatureHelp(uri, positionOf(line, column), request);
      } catch {
        return null;
      }
    },

    async definition(uri, version, line, column) {
      if (!checkFresh(uri, version)) return [];
      syncOpenDoc(uri);
            const request = createRequestManager(() => version).createRequest(version);
      try {
        return await service.definition(uri, positionOf(line, column), request);
      } catch {
        return [];
      }
    },

    async references(uri, version, line, column) {
      if (!checkFresh(uri, version)) return [];
      syncOpenDoc(uri);
      const request = createRequestManager(() => version).createRequest(version);
      try {
        return await service.references(uri, positionOf(line, column), request);
      } catch {
        return [];
      }
    },

    async declaration(uri, version, line, column) {
      if (!checkFresh(uri, version)) return [];
      syncOpenDoc(uri);
      const request = createRequestManager(() => version).createRequest(version);
      try {
        return await service.declaration(uri, positionOf(line, column), request);
      } catch {
        return [];
      }
    },

    async typeDefinition(uri, version, line, column) {
      if (!checkFresh(uri, version)) return [];
      syncOpenDoc(uri);
      const request = createRequestManager(() => version).createRequest(version);
      try {
        return await service.typeDefinition(uri, positionOf(line, column), request);
      } catch {
        return [];
      }
    },

    async workspaceSymbols(query) {
      if (disposed || !enabled || !query.trim()) return [];
      const request = createRequestManager(() => 0).createRequest(0);
      try {
        const symbols = await service.workspaceSymbols(query, request);
        return symbols.map((symbol) => ({
          name: symbol.name,
          kind: symbol.kind,
          uri: symbol.location.uri,
          range: symbol.location.range,
        }));
      } catch {
        return [];
      }
    },

    async prepareRename(uri, version, line, column) {
      if (!checkFresh(uri, version)) return null;
      syncOpenDoc(uri);
      const request = createRequestManager(() => version).createRequest(version);
      try {
        return await service.prepareRename(uri, positionOf(line, column), request);
      } catch {
        return null;
      }
    },

    async renameApply(uri, version, line, column, newName) {
      if (!checkFresh(uri, version)) return null;
      syncOpenDoc(uri);
      const request = createRequestManager(() => version).createRequest(version);
      try {
        const result = await service.rename(uri, positionOf(line, column), newName, request);
        return result ? { edits: result.edit.edits, summary: result.edit.summary } : null;
      } catch {
        return null;
      }
    },

    async codeActions(uri, version, range, diagnostics) {
      if (!checkFresh(uri, version)) return [];
      syncOpenDoc(uri);
      const request = createRequestManager(() => version).createRequest(version);
      try {
        const actions = await service.codeActions(uri, range, diagnostics, request);
        return actions.map((action) => ({
          title: action.title,
          kind: action.kind,
          actionId: action.actionId,
          edit: action.edit ? { edits: action.edit.edits, summary: action.edit.summary } : null,
        }));
      } catch {
        return [];
      }
    },

    async formatDocument(uri, version) {
      if (!checkFresh(uri, version)) return [];
      syncOpenDoc(uri);
      const request = createRequestManager(() => version).createRequest(version);
      try {
        return await service.formatting(uri, request);
      } catch {
        return [];
      }
    },

    async formatRange(uri, version, range) {
      if (!checkFresh(uri, version)) return [];
      syncOpenDoc(uri);
      const request = createRequestManager(() => version).createRequest(version);
      try {
        return await service.rangeFormatting(uri, range, request);
      } catch {
        return [];
      }
    },

    async organizeDocument(uri, version) {
      if (!checkFresh(uri, version)) return [];
      syncOpenDoc(uri);
      const request = createRequestManager(() => version).createRequest(version);
      try {
        return await service.organizeImports(uri, request);
      } catch {
        return [];
      }
    },

    applicableRefactors(uri, version, range) {
      if (!checkFresh(uri, version)) return [];
      syncOpenDoc(uri);
      try {
        return service.applicableRefactors(uri, range);
      } catch {
        return [];
      }
    },

    refactorApply(uri, version, range, refactorName, actionName) {
      if (!checkFresh(uri, version)) return { edits: [] };
      syncOpenDoc(uri);
      try {
        const { edits } = service.refactorEdits(uri, range, refactorName, actionName);
        return { edits };
      } catch {
        return { edits: [] };
      }
    },

    async outline(uri, version) {
      if (!checkFresh(uri, version)) return [];
      syncOpenDoc(uri);
            const request = createRequestManager(() => version).createRequest(version);
      try {
        return await service.documentSymbols(uri, request);
      } catch {
        return [];
      }
    },

    async diagnose(uri, version) {
      if (!checkFresh(uri, version)) return [];
      syncOpenDoc(uri);
            const request = createRequestManager(() => version).createRequest(version);
      try {
        return await service.diagnostics(uri, request);
      } catch {
        return [];
      }
    },

    async tokens(uri, version) {
      if (!checkFresh(uri, version) || !features.semanticTokens) return [];
      syncOpenDoc(uri);
            const request = createRequestManager(() => version).createRequest(version);
      try {
        return await service.semanticTokens(uri, request);
      } catch {
        return [];
      }
    },

    async inlay(uri, version, range) {
      if (!checkFresh(uri, version) || !features.inlayHints) return [];
      syncOpenDoc(uri);
            const request = createRequestManager(() => version).createRequest(version);
      try {
        return await service.inlayHints(uri, range, request);
      } catch {
        return [];
      }
    },

    dispose() {
      disposed = true;
      pendingFiles.clear();
      void service.dispose();
    },
  };
}

export interface AjiroIntelGlobal {
  version: number;
  createSession(events: IntelSessionEvents): IntelWebSession;
}

/** Mounted by the vendor bundle as `window.AjiroIntel`. */
export function createAjiroIntelGlobal(): AjiroIntelGlobal {
  return {
    version: INTEL_API_VERSION,
    createSession: (events) => createIntelWebSession(events),
  };
}

export const INTEL_API_VERSION = 1;

/** Bundle-global entry points (`window.AjiroIntel.createSession`). */
export function createSession(events: IntelSessionEvents): IntelWebSession {
  return createIntelWebSession(events);
}

export { mountIntelUI } from "@/modules/intel/web/intel-cm";
export type { IntelUiHandle, IntelUiOptions } from "@/modules/intel/web/intel-cm";
