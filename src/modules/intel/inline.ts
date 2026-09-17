/**
 * Inline ghost-text completion state machine (§9).
 *
 * Pure model: the host feeds document/cursor updates and candidate
 * suggestions; the machine decides what ghost text (if any) renders after
 * the cursor. Accept / accept-word / reject / next / previous are explicit
 * transitions so touch controls and keyboards share one implementation.
 */
export interface GhostSuggestion {
  id: number;
  text: string;
  source: "ai" | "semantic";
}

export interface GhostState {
  /** Text rendered after the cursor (may span lines). */
  ghost: string;
  suggestionId: number | null;
  hasNext: boolean;
  hasPrevious: boolean;
}

export interface InlineCompletionController {
  reset(): void;
  onDocumentChange(version: number, cursorOffset: number): void;
  onCursorMove(cursorOffset: number): void;
  offer(suggestions: GhostSuggestion[]): void;
  accept(): { text: string; suggestionId: number } | null;
  acceptWord(): { text: string; suggestionId: number } | null;
  reject(): void;
  next(): void;
  previous(): void;
  state(): GhostState;
}

const LEADING_WORD = /^[\w$]+/;

export function createInlineCompletionController(): InlineCompletionController {
  let suggestions: GhostSuggestion[] = [];
  let index = -1;
  let cursorOffset = 0;
  let version = 0;

  function current(): GhostSuggestion | null {
    return index >= 0 && index < suggestions.length ? (suggestions[index] as GhostSuggestion) : null;
  }

  return {
    reset() {
      suggestions = [];
      index = -1;
    },

    onDocumentChange(nextVersion, nextCursor) {
      version = nextVersion;
      cursorOffset = nextCursor;
      // Any edit invalidates in-flight suggestions — never ghost stale text.
      suggestions = [];
      index = -1;
    },

    onCursorMove(nextCursor) {
      if (nextCursor !== cursorOffset) {
        cursorOffset = nextCursor;
        suggestions = [];
        index = -1;
      }
    },

    offer(next) {
      // Offers arriving for an older version are the caller's
      // responsibility to filter; last offer wins here by design.
      void version;
      suggestions = [...next];
      index = suggestions.length > 0 ? 0 : -1;
    },

    accept() {
      const active = current();
      if (!active) return null;
      const result = { text: active.text, suggestionId: active.id };
      suggestions = [];
      index = -1;
      return result;
    },

    acceptWord() {
      const active = current();
      if (!active) return null;
      const firstLine = active.text.split("\n")[0] ?? "";
      // Accept the leading word (stopping at punctuation), plus any
      // whitespace that follows it.
      const wordMatch = LEADING_WORD.exec(firstLine);
      const cut = wordMatch ? wordMatch[0].length : firstLine.length;
      let accepted = firstLine.slice(0, cut);
      const restAfter = firstLine.slice(cut);
      const whitespace = /^\s*/.exec(restAfter)?.[0] ?? "";
      accepted += whitespace;
      const remainder = active.text.slice(accepted.length);
      if (!remainder) {
        suggestions = [];
        index = -1;
      } else {
        suggestions = [{ ...active, text: remainder }, ...suggestions.slice(index + 1)];
        index = 0;
      }
      return { text: accepted, suggestionId: active.id };
    },

    reject() {
      suggestions = [];
      index = -1;
    },

    next() {
      if (suggestions.length > 0) index = (index + 1) % suggestions.length;
    },

    previous() {
      if (suggestions.length > 0) {
        index = (index - 1 + suggestions.length) % suggestions.length;
      }
    },

    state() {
      const active = current();
      return {
        ghost: active?.text ?? "",
        suggestionId: active?.id ?? null,
        hasNext: suggestions.length > 1,
        hasPrevious: suggestions.length > 1,
      };
    },
  };
}
