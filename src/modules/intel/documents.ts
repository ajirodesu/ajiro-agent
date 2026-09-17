/**
 * In-memory document model (§28).
 *
 * Every open file has URI, language, monotonic version, text, dirty state,
 * diagnostics slot, semantic state, and indexing state. Updates apply
 * incrementally (change ranges) or as full syncs; versions only move
 * forward so stale async results can never overwrite newer state (§46).
 */
import type { IntelDiagnostic } from "@/modules/intel/types";

export type IntelDocumentSyncKind = "full" | "incremental";

export interface IntelDocumentChange {
  /** End-exclusive offset range in the *previous* text. */
  from: number;
  to: number;
  insert: string;
}

export interface IntelDocumentState {
  uri: string;
  languageId: string;
  version: number;
  text: string;
  dirty: boolean;
  diagnostics: IntelDiagnostic[];
  semanticReady: boolean;
  indexed: boolean;
}

export interface DocumentManagerEvents {
  onOpen?(uri: string): void;
  onChange?(uri: string, version: number): void;
  onClose?(uri: string): void;
}

export interface DocumentManager {
  open(uri: string, languageId: string, text: string): IntelDocumentState;
  update(
    uri: string,
    changes: IntelDocumentChange[] | null,
    fullText: string | null,
  ): IntelDocumentState | null;
  setClean(uri: string, version: number): void;
  setDiagnostics(uri: string, diagnostics: IntelDiagnostic[]): void;
  setSemanticReady(uri: string, ready: boolean): void;
  setIndexed(uri: string, indexed: boolean): void;
  get(uri: string): IntelDocumentState | null;
  getText(uri: string): string | null;
  getVersion(uri: string): number;
  has(uri: string): boolean;
  close(uri: string): void;
  uris(): string[];
}

function applyChanges(text: string, changes: IntelDocumentChange[]): string {
  // Apply back-to-front so earlier offsets stay valid.
  const ordered = [...changes].sort((a, b) => b.from - a.from);
  let next = text;
  for (const change of ordered) {
    const from = Math.max(0, Math.min(change.from, next.length));
    const to = Math.max(from, Math.min(change.to, next.length));
    next = next.slice(0, from) + change.insert + next.slice(to);
  }
  return next;
}

export function createDocumentManager(
  events: DocumentManagerEvents = {},
): DocumentManager {
  const documents = new Map<string, IntelDocumentState>();

  return {
    open(uri, languageId, text) {
      const existing = documents.get(uri);
      if (existing && existing.text === text) return existing;
      const version = (existing?.version ?? 0) + 1;
      const state: IntelDocumentState = {
        uri,
        languageId,
        version,
        text,
        dirty: true,
        diagnostics: existing?.diagnostics ?? [],
        semanticReady: false,
        indexed: false,
      };
      documents.set(uri, state);
      if (!existing) events.onOpen?.(uri);
      else events.onChange?.(uri, version);
      return state;
    },

    update(uri, changes, fullText) {
      const existing = documents.get(uri);
      if (!existing) return null;
      let text = existing.text;
      if (changes && changes.length > 0) {
        text = applyChanges(text, changes);
      } else if (fullText !== null) {
        text = fullText;
      }
      if (text === existing.text) return existing;
      const state: IntelDocumentState = {
        ...existing,
        version: existing.version + 1,
        text,
        dirty: true,
        semanticReady: false,
      };
      documents.set(uri, state);
      events.onChange?.(uri, state.version);
      return state;
    },

    setClean(uri, version) {
      const existing = documents.get(uri);
      // Only the exact saved version clears dirty — a newer edit keeps it.
      if (existing && existing.version === version) {
        documents.set(uri, { ...existing, dirty: false });
      }
    },

    setDiagnostics(uri, diagnostics) {
      const existing = documents.get(uri);
      if (existing) documents.set(uri, { ...existing, diagnostics });
    },

    setSemanticReady(uri, ready) {
      const existing = documents.get(uri);
      if (existing) documents.set(uri, { ...existing, semanticReady: ready });
    },

    setIndexed(uri, indexed) {
      const existing = documents.get(uri);
      if (existing) documents.set(uri, { ...existing, indexed });
    },

    get(uri) {
      return documents.get(uri) ?? null;
    },

    getText(uri) {
      return documents.get(uri)?.text ?? null;
    },

    getVersion(uri) {
      return documents.get(uri)?.version ?? 0;
    },

    has(uri) {
      return documents.has(uri);
    },

    close(uri) {
      if (documents.delete(uri)) events.onClose?.(uri);
    },

    uris() {
      return [...documents.keys()];
    },
  };
}
