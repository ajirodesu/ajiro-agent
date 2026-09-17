/**
 * AI completion separation (§8, §39).
 *
 * AI suggestions are a distinct, optional completion category: they carry
 * `source: "ai"`, render with their own visual tag, can be disabled
 * independently, and are NEVER required for basic coding. The provider
 * interface is host-injected — the engine never calls the network itself,
 * so offline behavior is the default and any cloud use is explicit (§48).
 */
import type { IntelCompletionItem } from "@/modules/intel/types";

export interface AiCompletionContext {
  uri: string;
  languageId: string;
  /** Text before the cursor (bounded by the host). */
  prefix: string;
  /** Text after the cursor (bounded by the host). */
  suffix: string;
  version: number;
}

export interface AiCompletionProvider {
  readonly id: string;
  /** Single-line and multi-line ghost candidates. */
  suggest(context: AiCompletionContext): Promise<{ text: string }[]>;
}

export interface AiCompletionManagerOptions {
  enabled: boolean;
  maxPrefixChars?: number;
  maxSuffixChars?: number;
  /** Minimum idle ms after the last keystroke before suggesting. */
  idleMs?: number;
}

export interface AiCompletionManager {
  setEnabled(enabled: boolean): void;
  isEnabled(): boolean;
  setProvider(provider: AiCompletionProvider | null): void;
  request(
    uri: string,
    languageId: string,
    fullText: string,
    cursorOffset: number,
    version: number,
  ): Promise<{ texts: string[]; version: number }>;
}

export function toAiCompletionItems(texts: string[], sortPriorityStart = 9000): IntelCompletionItem[] {
  return texts.map((text, index) => {
    const firstLine = text.split("\n")[0] ?? text;
    return {
      label: firstLine.length > 60 ? `${firstLine.slice(0, 60)}…` : firstLine,
      kind: "text",
      detail: "AI suggestion",
      documentation: text,
      sortPriority: sortPriorityStart + index,
      filterText: null,
      insertText: text,
      replaceRange: null,
      commitCharacters: [],
      additionalEdits: [],
      source: "ai",
      deprecated: false,
      resolveId: null,
    };
  });
}

export function createAiCompletionManager(
  options: AiCompletionManagerOptions,
): AiCompletionManager {
  let enabled = options.enabled;
  let provider: AiCompletionProvider | null = null;
  const maxPrefixChars = options.maxPrefixChars ?? 2000;
  const maxSuffixChars = options.maxSuffixChars ?? 500;

  return {
    setEnabled(next) {
      enabled = next;
    },
    isEnabled() {
      return enabled && provider !== null;
    },
    setProvider(next) {
      provider = next;
    },
    async request(uri, languageId, fullText, cursorOffset, version) {
      if (!enabled || !provider) return { texts: [], version };
      const prefix = fullText.slice(Math.max(0, cursorOffset - maxPrefixChars), cursorOffset);
      const suffix = fullText.slice(cursorOffset, cursorOffset + maxSuffixChars);
      // The final word fragment is a weak prompt; skip noise.
      if (prefix.length < 8) return { texts: [], version };
      const suggestions = await provider.suggest({ uri, languageId, prefix, suffix, version });
      return { texts: suggestions.map((suggestion) => suggestion.text).filter(Boolean).slice(0, 3), version };
    },
  };
}
