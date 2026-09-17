import { describe, expect, it } from "vitest";

import {
  containingSymbolPath,
  createNavigationHistory,
  groupReferences,
} from "@/modules/intel/navigation";

describe("navigation history", () => {
  it("push/back/forward round-trips with dedupe", () => {
    const history = createNavigationHistory();
    const home = { uri: "a.ts", line: 1, column: 1 };
    const away = { uri: "b.ts", line: 5, column: 3 };
    expect(history.canBack()).toBe(false);
    history.push(home);
    history.push(home);
    expect(history.depth).toBe(1);
    const back = history.back(away);
    expect(back).toEqual(home);
    expect(history.canForward()).toBe(true);
    expect(history.forward(home)).toEqual(away);
    expect(history.canForward()).toBe(false);
  });

  it("new push clears forward", () => {
    const history = createNavigationHistory();
    history.push({ uri: "a.ts", line: 1, column: 1 });
    history.back({ uri: "b.ts", line: 2, column: 1 });
    history.push({ uri: "c.ts", line: 3, column: 1 });
    expect(history.canForward()).toBe(false);
  });
});

describe("containing symbol path", () => {
  const symbols = [
    {
      name: "Main",
      kind: "class" as const,
      range: { start: { line: 1, column: 1 }, end: { line: 20, column: 2 } },
      selectionRange: { start: { line: 1, column: 14 }, end: { line: 1, column: 18 } },
      children: [
        {
          name: "render",
          kind: "method" as const,
          range: { start: { line: 5, column: 3 }, end: { line: 10, column: 4 } },
          selectionRange: { start: { line: 5, column: 3 }, end: { line: 5, column: 9 } },
          children: [],
        },
      ],
    },
  ];
  it("finds the deepest chain containing a line", () => {
    expect(containingSymbolPath(symbols, 7).map((symbol) => symbol.name)).toEqual(["Main", "render"]);
    expect(containingSymbolPath(symbols, 15).map((symbol) => symbol.name)).toEqual(["Main"]);
    expect(containingSymbolPath(symbols, 99)).toEqual([]);
  });
});

describe("reference grouping", () => {
  it("groups by file with previews, sorted", () => {
    const groups = groupReferences(
      [
        { uri: "b.ts", range: { start: { line: 9, column: 1 }, end: { line: 9, column: 4 } } },
        { uri: "a.ts", range: { start: { line: 2, column: 5 }, end: { line: 2, column: 8 } } },
        { uri: "a.ts", range: { start: { line: 1, column: 1 }, end: { line: 1, column: 4 } } },
      ],
      (uri, line) => `${uri}:${line} code here`,
      () => ({ isWrite: true, isDefinition: false }),
    );
    expect(groups.map((group) => group.uri)).toEqual(["a.ts", "b.ts"]);
    expect(groups[0]?.references.map((reference) => reference.line)).toEqual([1, 2]);
    expect(groups[0]?.references[0]?.preview).toContain("a.ts:1");
    expect(groups[0]?.references[0]?.isWrite).toBe(true);
  });
});
