import { describe, expect, it } from "vitest";

import { groupBySource, mergeCompletions } from "@/modules/intel/completion";
import type { IntelCompletionItem } from "@/modules/intel/types";

function item(
  label: string,
  source: IntelCompletionItem["source"],
  sortPriority = 10,
  kind: IntelCompletionItem["kind"] = "property",
): IntelCompletionItem {
  return {
    label,
    kind,
    detail: null,
    documentation: null,
    sortPriority,
    filterText: null,
    insertText: label,
    replaceRange: null,
    commitCharacters: [],
    additionalEdits: [],
    source,
    deprecated: false,
    resolveId: null,
  };
}

describe("completion merge", () => {
  it("semantic outranks text matches deterministically", () => {
    const merged = mergeCompletions([
      [item("length", "local", 1)],
      [item("length", "semantic", 50)],
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.source).toBe("semantic");
  });

  it("dedupes case-insensitively, keeps first on full ties", () => {
    const merged = mergeCompletions([[item("Foo", "local", 5)], [item("foo", "local", 5)]]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.label).toBe("Foo");
  });

  it("drops disabled sources and filters by prefix", () => {
    const merged = mergeCompletions(
      [[item("console", "semantic"), item("snippetbody", "snippet"), item("ghost", "ai")]],
      { disabledSources: new Set(["ai"]), prefix: "con" },
    );
    expect(merged.map((entry) => entry.label)).toEqual(["console"]);
  });

  it("caps the list for mobile", () => {
    const many = Array.from({ length: 200 }, (_, index) => item(`item${index}`, "local", index));
    expect(mergeCompletions([many], { maxItems: 50 })).toHaveLength(50);
  });

  it("groups by source in priority order", () => {
    const groups = groupBySource([item("a", "ai"), item("b", "semantic"), item("c", "keyword")]);
    expect(groups.map((group) => group.source)).toEqual(["semantic", "keyword", "ai"]);
  });
});
