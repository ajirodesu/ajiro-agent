/**
 * React Native ↔ WebView intel bridge (§3 pipeline, RN side).
 *
 * Owns the RN-side intel engine (documents, syntax fallback, settings,
 * snippets, AI manager), merges WebView semantic diagnostics with local
 * checks, serves `intel:need-file` from an injected reader, routes
 * `intel:result` to query futures, and exposes panel operations
 * (outline, references, rename, actions, format, refactors).
 *
 * Everything is additive: with `intelEnabled` false (or no WebView
 * readiness) the hook degrades to local-only behavior and existing screens
 * keep working unchanged.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  EditorWebViewInbound,
  EditorWebViewOutbound,
  IntelBridgeRange,
} from "@/editor/editorTypes";
import {
  checkFormat,
  computeDiagnostics,
  type EditorDiagnostic,
  type FormatCheck,
} from "@/editor/editorDiagnostics";
import { countIntelDiagnostics, mergeDiagnostics, toEditorDiagnostics } from "@/modules/intel/diagnostics";
import { createIntelEngine, type IntelEngine } from "@/modules/intel/index";
import { applyTextEdits } from "@/modules/intel/workspace-edit";
import { createSnippetRegistry } from "@/modules/intel/snippets";
import { createSyntaxFallbackService } from "@/modules/intel/syntax-service";
import {
  createMemoryIntelSettingsStore,
  DEFAULT_INTEL_SETTINGS,
  type IntelSettings,
} from "@/modules/intel/settings";
import { createAiCompletionManager } from "@/modules/intel/ai-completion";
import {
  filterLocalTodos,
  intelLanguageIdForGrammar,
  isTsJsLanguage,
  urisMatch,
} from "@/editor/intel-helpers";
import type {
  IntelCodeAction,
  IntelDiagnostic,
  IntelDocumentSymbol,
  IntelHoverInfo,
  IntelLocation,
  IntelSignatureHelp,
  IntelTextEdit,
} from "@/modules/intel/types";

export type IntelQueryOp =
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

export interface IntelFileContent {
  version: number;
  text: string;
}

export interface IntelAuxPaths {
  files: string[];
  directories: string[];
  dependencies: string[];
  devDependencies: string[];
  aliases: Record<string, string[]>;
}

export interface IntelBridgeOptions {
  path: string;
  value: string;
  grammarKey: string | null;
  intelEnabled: boolean;
  webViewReady: boolean;
  caret: { line: number; column: number };
  postInbound: (message: EditorWebViewInbound) => void;
  applyText: (text: string) => void;
  readFile?: (uri: string) => Promise<IntelFileContent | null>;
  onOpenFile?: (uri: string, line: number, column: number) => void;
  onWorkspaceEdit?: (edits: IntelTextEdit[]) => void;
  initialSettings?: Partial<IntelSettings>;
  auxPaths?: IntelAuxPaths;
  auxSymbols?: { label: string; kind: string; detail: string | null; uri: string }[];
}

function rangesOverlap(
  a: { start: { line: number; column: number }; end: { line: number; column: number } },
  b: { start: { line: number; column: number }; end: { line: number; column: number } },
): boolean {
  const before =
    a.end.line < b.start.line || (a.end.line === b.start.line && a.end.column < b.start.column);
  const after =
    b.end.line < a.start.line || (b.end.line === a.start.line && b.end.column < a.start.column);
  return !before && !after;
}

function localToIntel(diagnostic: EditorDiagnostic): IntelDiagnostic {
  return {
    severity: diagnostic.severity,
    message: diagnostic.message,
    source: "syntax",
    code: null,
    range: {
      start: { line: diagnostic.line, column: diagnostic.column },
      end: { line: diagnostic.line, column: diagnostic.column + 1 },
    },
    related: [],
    fixable: false,
  };
}

export interface IntelBridge {
  languageId: string;
  intelActive: boolean;
  settings: IntelSettings;
  updateSettings(patch: Partial<IntelSettings>): void;
  diagnostics: EditorDiagnostic[];
  format: FormatCheck;
  semanticCounts: { errors: number; warnings: number; infos: number; hints: number };
  handleOutbound(message: EditorWebViewOutbound): boolean;
  query<T>(op: IntelQueryOp, payload?: Record<string, unknown>): Promise<T>;
  getOutline(): Promise<IntelDocumentSymbol[]>;
  getReferences(): Promise<IntelLocation[]>;
  getHover(): Promise<IntelHoverInfo | null>;
  getSignature(): Promise<IntelSignatureHelp | null>;
  getDefinition(): Promise<IntelLocation[]>;
  getCodeActions(range: IntelBridgeRange): Promise<IntelCodeAction[]>;
  prepareRename(): Promise<{ range: IntelBridgeRange; placeholder: string } | null>;
  applyRename(line: number, column: number, newName: string): Promise<string | null>;
  requestFormat(timeoutMs?: number): Promise<boolean>;
  requestOrganize(timeoutMs?: number): Promise<boolean>;
  getRefactors(range: IntelBridgeRange): Promise<
    { name: string; description: string; actions: { name: string; description: string }[] }[]
  >;
  applyRefactor(range: IntelBridgeRange, refactorName: string, actionName: string): Promise<string | null>;
  pushGhost(text: string | null): void;
  /** Apply open-document edits through the WebView (undo-preserving). */
  applyEdits(edits: IntelTextEdit[]): void;
  /** Local dev instrumentation: per-op counts and latencies (§54). */
  getPerfSnapshot(): Record<string, { count: number; avgMs: number; maxMs: number }>;
  aiAvailable: boolean;
}

export function useIntelBridge(options: IntelBridgeOptions): IntelBridge {
  const {
    path,
    value,
    grammarKey,
    intelEnabled,
    webViewReady,
    caret,
    postInbound,
    applyText,
    readFile,
    onOpenFile,
    onWorkspaceEdit,
    initialSettings,
    auxPaths,
    auxSymbols,
  } = options;

  const languageId = useMemo(() => intelLanguageIdForGrammar(grammarKey), [grammarKey]);
  const valueRef = useRef(value);
  valueRef.current = value;
  const caretRef = useRef(caret);
  caretRef.current = caret;
  const postRef = useRef(postInbound);
  postRef.current = postInbound;
  const readyRef = useRef(webViewReady);
  readyRef.current = webViewReady;

  const settingsStore = useMemo(
    () => createMemoryIntelSettingsStore(initialSettings ?? {}),
    // Initial settings only; live updates flow through updateSettings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [settings, setSettings] = useState<IntelSettings>({ ...DEFAULT_INTEL_SETTINGS, ...(initialSettings ?? {}) });
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const engine: IntelEngine = useMemo(() => {
    const syntax = createSyntaxFallbackService({
      getText: (uri) => (urisMatch(uri, path) ? valueRef.current : null),
    });
    return createIntelEngine({
      adapters: [syntax],
      getText: (uri) => (urisMatch(uri, path) ? valueRef.current : null),
    });
    // Engine identity is stable; document text flows through refs.
  }, [path]);

  const aiManager = useMemo(() => createAiCompletionManager({ enabled: false }), []);
  const [semanticDiagnostics, setSemanticDiagnostics] = useState<IntelDiagnostic[]>([]);
  const [localDiagnostics, setLocalDiagnostics] = useState<EditorDiagnostic[]>([]);
  const docVersionRef = useRef(0);
  const [format, setFormat] = useState<FormatCheck>({ valid: true, unsupported: true, message: null });
  const pending = useRef(new Map<number, { resolve: (value: never) => void; reject: (error: Error) => void }>());
  const queryId = useRef(0);
  const perfRef = useRef(new Map<string, { count: number; totalMs: number; maxMs: number }>());

  const recordPerf = (op: string, elapsedMs: number): void => {
    const entry = perfRef.current.get(op) ?? { count: 0, totalMs: 0, maxMs: 0 };
    entry.count += 1;
    entry.totalMs += elapsedMs;
    entry.maxMs = Math.max(entry.maxMs, elapsedMs);
    perfRef.current.set(op, entry);
  };

  const intelActive = intelEnabled && webViewReady && isTsJsLanguage(languageId);

  const query = useCallback(
    <T,>(op: IntelQueryOp, payload: Record<string, unknown> = {}, timeoutMs = 15000): Promise<T> => {
      if (!readyRef.current) return Promise.reject(new Error("editor not ready"));
      queryId.current += 1;
      const id = queryId.current;
      const startedAt = Date.now();
      const finish = (settled: () => void): void => {
        recordPerf(op, Date.now() - startedAt);
        settled();
      };
      return new Promise<T>((resolve, reject) => {
        pending.current.set(id, {
          resolve: ((value: never) => finish(() => resolve(value))) as (value: never) => void,
          reject: (error: Error) =>
            finish(() => {
              reject(error);
            }),
        });
        postRef.current({
          type: "intel:query",
          id,
          op,
          line: caretRef.current.line,
          column: caretRef.current.column,
          ...payload,
        } as unknown as EditorWebViewInbound);
        setTimeout(() => {
          if (pending.current.delete(id)) {
            reject(new Error(`intel query timed out: ${op}`));
          }
        }, timeoutMs);
      });
    },
    [],
  );

  const applyEditsToOpenDoc = useCallback(
    (edits: IntelTextEdit[]): boolean => {
      const current = valueRef.current;
      const relevant = edits.filter((edit) => urisMatch(edit.uri, path));
      if (relevant.length === 0) return false;
      const result = applyTextEdits(current, relevant);
      if (result.overlap) return false;
      applyText(result.text);
      return true;
    },
    [applyText, path],
  );

  const handleOutbound = useCallback(
    (message: EditorWebViewOutbound): boolean => {
      switch (message.type) {
        case "intel:need-file": {
          if (readFile) {
            void readFile(message.uri).then(
              (content) => {
                postRef.current({
                  type: "intel:file-response",
                  id: message.id,
                  uri: message.uri,
                  version: content?.version ?? 0,
                  text: content?.text ?? null,
                });
              },
              () => {
                postRef.current({
                  type: "intel:file-response",
                  id: message.id,
                  uri: message.uri,
                  version: 0,
                  text: null,
                });
              },
            );
          } else {
            postRef.current({
              type: "intel:file-response",
              id: message.id,
              uri: message.uri,
              version: 0,
              text: null,
            });
          }
          return true;
        }
        case "intel:result": {
          const waiter = pending.current.get(message.id);
          if (!waiter) return true;
          pending.current.delete(message.id);
          if (message.ok) waiter.resolve(message.payload as never);
          else waiter.reject(new Error(message.error ?? "intel query failed"));
          return true;
        }
        case "intel:diagnostics": {
          setSemanticDiagnostics(
            message.diagnostics.map((diagnostic) => ({
              severity: diagnostic.severity as IntelDiagnostic["severity"],
              message: diagnostic.message,
              source: "ts-semantic",
              code: diagnostic.code,
              range: diagnostic.range,
              related: [],
              fixable: false,
            })),
          );
          return true;
        }
        case "intel:open-file": {
          onOpenFile?.(message.uri, message.line, message.column);
          return true;
        }
        case "intel:apply-local-edits": {
          const crossFile = message.edits.filter((edit) => !urisMatch(edit.uri, path));
          applyEditsToOpenDoc(message.edits);
          if (crossFile.length > 0) onWorkspaceEdit?.(crossFile);
          return true;
        }
        default:
          return false;
      }
    },
    [applyEditsToOpenDoc, onOpenFile, onWorkspaceEdit, path, readFile],
  );

  // Push engine configuration + aux data when ready or settings change.
  useEffect(() => {
    if (!webViewReady) return;
    postInbound({
      type: "intel:configure",
      enabled: intelEnabled,
      features: {
        semanticCompletion: settings.semanticCompletionEnabled,
        hover: settings.hoverEnabled,
        signatureHelp: settings.parameterHintsEnabled,
        semanticTokens: settings.semanticHighlightingEnabled,
        inlayHints: settings.inlayHintsEnabled,
        inlineGhost: settings.inlineCompletionEnabled,
      },
    });
    const registry = createSnippetRegistry();
    postInbound({
      type: "intel:aux-data",
      symbols: auxSymbols ?? [],
      snippets: registry.forLanguage(languageId).map((snippet) => ({
        prefix: snippet.prefix,
        body: snippet.body,
        description: snippet.description,
      })),
      paths: auxPaths ?? { files: [], directories: [], dependencies: [], devDependencies: [], aliases: {} },
      aiItems: [],
      maxItems: settings.maxCompletionItems,
      aiEnabled: aiManager.isEnabled(),
      snippetsEnabled: settings.snippetCompletionEnabled,
    });
  }, [webViewReady, intelEnabled, settings, languageId, auxPaths, auxSymbols, aiManager, postInbound]);

  // Local diagnostics through the RN-side engine (syntax fallback +
  // plugins), debounced. For TS/JS with the semantic engine active, local
  // syntax errors are redundant — only TODO markers survive.
  useEffect(() => {
    let cancelled = false;
    docVersionRef.current += 1;
    const timeout = setTimeout(() => {
      void engine
        .diagnostics(path, languageId, docVersionRef.current)
        .then((next) => {
          if (!cancelled) {
            const converted = toEditorDiagnostics(next);
            setLocalDiagnostics(intelActive ? filterLocalTodos(converted) : converted);
          }
        })
        .catch(() => {
          // Engine failure falls back to the legacy checks, never blank.
          void computeDiagnostics(path, value).then((next) => {
            if (!cancelled) {
              setLocalDiagnostics(intelActive ? filterLocalTodos(next) : next);
            }
          });
        });
      void checkFormat(path, value).then((next) => {
        if (!cancelled) setFormat(next);
      });
    }, settings.diagnosticsDelayMs);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
    // `value` drives re-runs via the ref-tracked version below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, value, intelActive, languageId, settings.diagnosticsDelayMs]);

  const diagnostics = useMemo<EditorDiagnostic[]>(() => {
    if (!intelActive) return localDiagnostics;
    const asIntel = localDiagnostics.map(localToIntel);
    return toEditorDiagnostics(mergeDiagnostics([semanticDiagnostics, asIntel]));
  }, [intelActive, localDiagnostics, semanticDiagnostics]);

  const semanticCounts = useMemo(
    () => countIntelDiagnostics(semanticDiagnostics),
    [semanticDiagnostics],
  );

  const updateSettings = (patch: Partial<IntelSettings>): void => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      void settingsStore.save(next);
      return next;
    });
  };

  return {
    languageId,
    intelActive,
    settings,
    updateSettings,
    diagnostics,
    format,
    semanticCounts,
    handleOutbound,
    query,
    getOutline: () => query("outline"),
    getReferences: () => query("references"),
    getHover: () => query("hover"),
    getSignature: () => query("signature"),
    getDefinition: () => query("definition"),
    getCodeActions: (range: IntelBridgeRange) =>
      query("code-actions", {
        range,
        diagnostics: semanticDiagnostics.filter(
          (diagnostic) => diagnostic.fixable && rangesOverlap(diagnostic.range, range),
        ),
      }),
    prepareRename: () => query("rename-prepare"),
    applyRename: async (line: number, column: number, newName: string) => {
      const result = await query<{
        edits: IntelTextEdit[];
        summary: string;
      } | null>("rename-apply", { line, column, newName });
      if (!result) return null;
      const crossFile = result.edits.filter((edit) => !urisMatch(edit.uri, path));
      applyEditsToOpenDoc(result.edits);
      if (crossFile.length > 0) onWorkspaceEdit?.(crossFile);
      return result.summary;
    },
    requestFormat: async (timeoutMs = 15000) => {
      const edits = await query<IntelTextEdit[]>("format", {}, timeoutMs);
      return applyEditsToOpenDoc(edits);
    },
    requestOrganize: async (timeoutMs = 15000) => {
      const edits = await query<IntelTextEdit[]>("organize", {}, timeoutMs);
      return applyEditsToOpenDoc(edits);
    },
    getRefactors: (range: IntelBridgeRange) => query("refactors", { range }),
    applyRefactor: async (range: IntelBridgeRange, refactorName: string, actionName: string) => {
      const result = await query<{ edits: IntelTextEdit[] }>("refactor-apply", {
        range,
        refactorName,
        actionName,
      });
      const crossFile = result.edits.filter((edit) => !urisMatch(edit.uri, path));
      const applied = applyEditsToOpenDoc(result.edits);
      if (crossFile.length > 0) onWorkspaceEdit?.(crossFile);
      return applied ? `${result.edits.length} edits applied` : null;
    },
    getPerfSnapshot: () => {
      const snapshot: Record<string, { count: number; avgMs: number; maxMs: number }> = {};
      for (const [op, entry] of perfRef.current) {
        snapshot[op] = {
          count: entry.count,
          avgMs: entry.count === 0 ? 0 : Math.round((entry.totalMs / entry.count) * 10) / 10,
          maxMs: Math.round(entry.maxMs * 10) / 10,
        };
      }
      return snapshot;
    },
    pushGhost: (text: string | null) => {
      postRef.current({ type: "intel:ghost", id: Date.now(), text });
    },
    applyEdits: (edits: IntelTextEdit[]) => {
      if (edits.length === 0) return;
      postRef.current({ type: "intel:apply-edit", id: Date.now(), edits });
    },
    aiAvailable: aiManager.isEnabled(),
  };
}

export type { IntelSettings };
