/**
 * Intel settings (§40). Pure defaults + validation + merge; persistence is
 * injected by the host (RN side stores via app settings, tests use memory).
 * Every category from §39/§40 is independently toggleable.
 */
export interface IntelSettings {
  completionEnabled: boolean;
  semanticCompletionEnabled: boolean;
  aiCompletionEnabled: boolean;
  inlineCompletionEnabled: boolean;
  snippetCompletionEnabled: boolean;
  emmetCompletionEnabled: boolean;
  parameterHintsEnabled: boolean;
  hoverEnabled: boolean;
  inlayHintsEnabled: boolean;
  semanticHighlightingEnabled: boolean;
  diagnosticsEnabled: boolean;
  quickFixesEnabled: boolean;
  formatOnSave: boolean;
  formatOnSaveLanguages: string[];
  autoImportEnabled: boolean;
  codeActionsEnabled: boolean;
  tabSize: number;
  indentSize: number;
  insertSpaces: boolean;
  wordWrap: boolean;
  fontSize: number;
  lineHeight: number;
  whitespaceRendering: boolean;
  bracketMatching: boolean;
  codeFolding: boolean;
  maxCompletionItems: number;
  diagnosticsDelayMs: number;
  completionDebounceMs: number;
}

export const DEFAULT_INTEL_SETTINGS: IntelSettings = {
  completionEnabled: true,
  semanticCompletionEnabled: true,
  aiCompletionEnabled: false,
  inlineCompletionEnabled: true,
  snippetCompletionEnabled: true,
  emmetCompletionEnabled: true,
  parameterHintsEnabled: true,
  hoverEnabled: true,
  inlayHintsEnabled: false,
  semanticHighlightingEnabled: true,
  diagnosticsEnabled: true,
  quickFixesEnabled: true,
  formatOnSave: false,
  formatOnSaveLanguages: [],
  autoImportEnabled: true,
  codeActionsEnabled: true,
  tabSize: 2,
  indentSize: 2,
  insertSpaces: true,
  wordWrap: true,
  fontSize: 13,
  lineHeight: 20,
  whitespaceRendering: false,
  bracketMatching: true,
  codeFolding: true,
  maxCompletionItems: 50,
  diagnosticsDelayMs: 300,
  completionDebounceMs: 80,
};

export function normalizeIntelSettings(input: unknown): IntelSettings {
  if (!input || typeof input !== "object") return { ...DEFAULT_INTEL_SETTINGS };
  const raw = input as Record<string, unknown>;
  const pick = <K extends keyof IntelSettings>(key: K, fallback: IntelSettings[K]): IntelSettings[K] => {
    const value = raw[key as string];
    if (typeof fallback === "boolean") return (typeof value === "boolean" ? value : fallback) as IntelSettings[K];
    if (typeof fallback === "number") {
      return (typeof value === "number" && Number.isFinite(value) ? value : fallback) as IntelSettings[K];
    }
    if (Array.isArray(fallback)) {
      return (Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : fallback) as IntelSettings[K];
    }
    return fallback;
  };
  const next = { ...DEFAULT_INTEL_SETTINGS };
  (Object.keys(next) as (keyof IntelSettings)[]).forEach((key) => {
    (next as Record<string, unknown>)[key] = pick(key, next[key]);
  });
  // Clamp numeric ranges to sane mobile values.
  next.tabSize = Math.min(8, Math.max(1, Math.floor(next.tabSize)));
  next.indentSize = Math.min(8, Math.max(1, Math.floor(next.indentSize)));
  next.fontSize = Math.min(24, Math.max(8, Math.floor(next.fontSize)));
  next.lineHeight = Math.min(48, Math.max(12, Math.floor(next.lineHeight)));
  next.maxCompletionItems = Math.min(200, Math.max(5, Math.floor(next.maxCompletionItems)));
  next.diagnosticsDelayMs = Math.min(5000, Math.max(0, Math.floor(next.diagnosticsDelayMs)));
  next.completionDebounceMs = Math.min(1000, Math.max(0, Math.floor(next.completionDebounceMs)));
  return next;
}

export interface IntelSettingsStore {
  load(): Promise<IntelSettings>;
  save(settings: IntelSettings): Promise<void>;
  subscribe(listener: (settings: IntelSettings) => void): () => void;
}

export function createMemoryIntelSettingsStore(
  initial: Partial<IntelSettings> = {},
): IntelSettingsStore {
  let current = normalizeIntelSettings(initial);
  const listeners = new Set<(settings: IntelSettings) => void>();
  return {
    async load() {
      return { ...current };
    },
    async save(settings) {
      current = normalizeIntelSettings(settings);
      for (const listener of listeners) {
        try {
          listener({ ...current });
        } catch {
          // Listener failures must not break persistence.
        }
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
