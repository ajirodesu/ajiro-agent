/**
 * Pure text operations for the code editor: find-all offsets, replace-all,
 * and a bounded undo/redo stack. The component owns rendering; all
 * state transitions here are unit-tested.
 */
export type TextMatch = {
  start: number;
  end: number;
};

export function findAllMatches(
  text: string,
  query: string,
  caseSensitive: boolean,
): TextMatch[] {
  if (!query) return [];
  const haystack = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  const matches: TextMatch[] = [];
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const found = haystack.indexOf(needle, from);
    if (found < 0) break;
    matches.push({ start: found, end: found + needle.length });
    from = found + Math.max(1, needle.length);
  }
  return matches;
}

export function replaceAllOccurrences(
  text: string,
  query: string,
  replacement: string,
  caseSensitive: boolean,
): { text: string; count: number } {
  if (!query) return { text, count: 0 };
  const matches = findAllMatches(text, query, caseSensitive);
  if (matches.length === 0) return { text, count: 0 };
  let result = "";
  let cursor = 0;
  for (const match of matches) {
    result += text.slice(cursor, match.start) + replacement;
    cursor = match.end;
  }
  result += text.slice(cursor);
  return { text: result, count: matches.length };
}

export function offsetToLineCol(
  text: string,
  offset: number,
): { line: number; column: number } {
  const clamped = Math.min(Math.max(0, offset), text.length);
  let line = 1;
  let lineStart = 0;
  for (let index = 0; index < clamped; index += 1) {
    if (text.charCodeAt(index) === 10) {
      line += 1;
      lineStart = index + 1;
    }
  }
  return { line, column: clamped - lineStart + 1 };
}

export type UndoState = {
  past: string[];
  future: string[];
};

export function pushUndo(
  state: UndoState,
  text: string,
  limit = 100,
): UndoState {
  const past = [...state.past, text];
  while (past.length > limit) past.shift();
  return { past, future: [] };
}

export function undoEdit(
  state: UndoState,
  current: string,
): { state: UndoState; text: string } {
  const previous = state.past[state.past.length - 1];
  if (previous === undefined || previous === current) {
    return { state, text: current };
  }
  return {
    state: {
      past: state.past.slice(0, -1),
      future: [current, ...state.future].slice(0, 100),
    },
    text: previous,
  };
}

export function redoEdit(
  state: UndoState,
  current: string,
): { state: UndoState; text: string } {
  const next = state.future[0];
  if (next === undefined) return { state, text: current };
  return {
    state: {
      past: [...state.past, current].slice(-100),
      future: state.future.slice(1),
    },
    text: next,
  };
}
