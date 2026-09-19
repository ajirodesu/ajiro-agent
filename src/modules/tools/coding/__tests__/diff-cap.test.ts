import { describe, expect, it } from "vitest";

import { computeLineDiff } from "@/modules/tools/coding/diff";

describe("computeLineDiff large-input guard", () => {
  it("diffs small inputs exactly", () => {
    expect(computeLineDiff("a\nb\nc", "a\nx\nc")).toEqual([
      { kind: "context", text: "a" },
      { kind: "remove", text: "b" },
      { kind: "add", text: "x" },
      { kind: "context", text: "c" },
    ]);
  });

  it("degrades to a bounded, marked replace instead of OOMing", () => {
    const left = Array.from({ length: 3000 }, (_, i) => `left-${i}`).join(
      "\n",
    );
    const right = Array.from({ length: 3000 }, (_, i) => `right-${i}`).join(
      "\n",
    );
    const started = Date.now();
    const diff = computeLineDiff(left, right);
    // 3000x3000 cells would previously allocate ~9M entries; the fallback
    // must stay small and fast.
    expect(Date.now() - started).toBeLessThan(5000);
    expect(diff.length).toBeLessThan(500);
    expect(
      diff.some((line) => line.text.includes("too large for line diff")),
    ).toBe(true);
    expect(diff[0]).toEqual({ kind: "remove", text: "left-0" });
  });
});
