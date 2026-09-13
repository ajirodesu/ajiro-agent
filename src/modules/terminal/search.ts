/** Search over scrollback + viewport text. */
export type TerminalSearchMatch = {
  lineIndex: number;
  lineText: string;
  start: number;
  end: number;
};

export function searchTerminalLines(
  lines: string[],
  query: string,
  caseSensitive: boolean,
): TerminalSearchMatch[] {
  if (!query) return [];
  const needle = caseSensitive ? query : query.toLowerCase();
  const matches: TerminalSearchMatch[] = [];
  lines.forEach((line, lineIndex) => {
    const haystack = caseSensitive ? line : line.toLowerCase();
    let from = 0;
    while (from <= haystack.length - needle.length) {
      const found = haystack.indexOf(needle, from);
      if (found < 0) break;
      matches.push({
        lineIndex,
        lineText: line,
        start: found,
        end: found + needle.length,
      });
      from = found + Math.max(1, needle.length);
    }
  });
  return matches;
}

export function nextMatchIndex(
  matches: TerminalSearchMatch[],
  current: number,
  direction: "next" | "prev",
): number {
  if (matches.length === 0) return -1;
  if (current < 0) return direction === "next" ? 0 : matches.length - 1;
  const step = direction === "next" ? 1 : -1;
  return (current + step + matches.length) % matches.length;
}
