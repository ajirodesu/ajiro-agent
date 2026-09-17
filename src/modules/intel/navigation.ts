/**
 * Code navigation (§12, §13): definition-jump history and reference
 * grouping. The jump targets themselves come from the language adapter;
 * this module owns back/forward state and result presentation grouping.
 */
import type { IntelDocumentSymbol, IntelLocation } from "@/modules/intel/types";

export interface NavigationEntry {
  uri: string;
  line: number;
  column: number;
}

export interface NavigationHistory {
  /** Record the pre-jump location; clears the forward stack. */
  push(current: NavigationEntry): void;
  /** Go back, stashing `current` for forward. */
  back(current: NavigationEntry): NavigationEntry | null;
  /** Go forward, stashing `current` for back. */
  forward(current: NavigationEntry): NavigationEntry | null;
  canBack(): boolean;
  canForward(): boolean;
  clear(): void;
  readonly depth: number;
}

const MAX_HISTORY = 100;

function sameEntry(a: NavigationEntry, b: NavigationEntry): boolean {
  return a.uri === b.uri && a.line === b.line && a.column === b.column;
}

export function createNavigationHistory(): NavigationHistory {
  const backStack: NavigationEntry[] = [];
  const forwardStack: NavigationEntry[] = [];
  return {
    get depth() {
      return backStack.length;
    },
    push(current) {
      const top = backStack[backStack.length - 1];
      if (top && sameEntry(top, current)) return;
      backStack.push({ ...current });
      if (backStack.length > MAX_HISTORY) backStack.shift();
      forwardStack.length = 0;
    },
    back(current) {
      const entry = backStack.pop();
      if (!entry) return null;
      if (!sameEntry(current, entry)) {
        forwardStack.push({ ...current });
        if (forwardStack.length > MAX_HISTORY) forwardStack.shift();
      }
      return { ...entry };
    },
    forward(current) {
      const entry = forwardStack.pop();
      if (!entry) return null;
      backStack.push({ ...current });
      if (backStack.length > MAX_HISTORY) backStack.shift();
      return { ...entry };
    },
    canBack() {
      return backStack.length > 0;
    },
    canForward() {
      return forwardStack.length > 0;
    },
    clear() {
      backStack.length = 0;
      forwardStack.length = 0;
    },
  };
}

/** Deepest symbol chain containing a line (for breadcrumbs). */
export function containingSymbolPath(
  symbols: IntelDocumentSymbol[],
  line: number,
): IntelDocumentSymbol[] {
  for (const symbol of symbols) {
    if (line >= symbol.range.start.line && line <= symbol.range.end.line) {
      return [symbol, ...containingSymbolPath(symbol.children, line)];
    }
  }
  return [];
}

export interface ReferenceGroup {
  uri: string;
  fileName: string;
  references: { line: number; column: number; preview: string; isWrite: boolean; isDefinition: boolean }[];
}

/**
 * Group reference locations by file with one-line previews. `lineText`
 * resolves a 1-based line from a file; previews are trimmed for mobile.
 */
export function groupReferences(
  locations: IntelLocation[],
  lineText: (uri: string, line: number) => string | null,
  detail?: (uri: string, line: number, column: number) => { isWrite: boolean; isDefinition: boolean },
): ReferenceGroup[] {
  const groups = new Map<string, ReferenceGroup>();
  for (const location of locations) {
    let group = groups.get(location.uri);
    if (!group) {
      group = {
        uri: location.uri,
        fileName: location.uri.split("/").pop() ?? location.uri,
        references: [],
      };
      groups.set(location.uri, group);
    }
    const info = detail?.(location.uri, location.range.start.line, location.range.start.column) ?? {
      isWrite: false,
      isDefinition: false,
    };
    group.references.push({
      line: location.range.start.line,
      column: location.range.start.column,
      preview: (lineText(location.uri, location.range.start.line) ?? "").trim().slice(0, 120),
      isWrite: info.isWrite,
      isDefinition: info.isDefinition,
    });
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      references: group.references.sort((a, b) => a.line - b.line || a.column - b.column),
    }))
    .sort((a, b) => (a.fileName < b.fileName ? -1 : a.fileName > b.fileName ? 1 : 0));
}
