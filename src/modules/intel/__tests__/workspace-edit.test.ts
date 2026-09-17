import { describe, expect, it } from "vitest";

import {
  applyTextEdits,
  applyWorkspaceEdit,
  previewWorkspaceEdit,
  rangeToOffsets,
  revertAppliedEdits,
} from "@/modules/intel/workspace-edit";

describe("workspace edits", () => {
  it("converts ranges to offsets with clamping", () => {
    expect(rangeToOffsets("ab\ncd", { start: { line: 2, column: 1 }, end: { line: 2, column: 3 } })).toEqual({
      start: 3,
      end: 5,
    });
  });

  it("applies non-overlapping edits back-to-front", () => {
    const result = applyTextEdits("aaa bbb", [
      { range: { start: { line: 1, column: 1 }, end: { line: 1, column: 4 } }, newText: "X" },
      { range: { start: { line: 1, column: 5 }, end: { line: 1, column: 8 } }, newText: "Y" },
    ]);
    expect(result).toEqual({ text: "X Y", overlap: false });
  });

  it("rejects overlapping edits instead of corrupting", () => {
    const result = applyTextEdits("abcdef", [
      { range: { start: { line: 1, column: 1 }, end: { line: 1, column: 4 } }, newText: "X" },
      { range: { start: { line: 1, column: 3 }, end: { line: 1, column: 6 } }, newText: "Y" },
    ]);
    expect(result.overlap).toBe(true);
    expect(result.text).toBe("abcdef");
  });

  it("applies workspace edits per file and reverts", () => {
    const files = new Map([
      ["a.ts", "const x = 1;"],
      ["b.ts", "const y = 2;"],
    ]);
    const result = applyWorkspaceEdit(files, {
      edits: [
        { uri: "a.ts", range: { start: { line: 1, column: 7 }, end: { line: 1, column: 8 } }, newText: "renamed" },
        { uri: "missing.ts", range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } }, newText: "?" },
      ],
      summary: "rename",
    });
    expect(files.get("a.ts")).toBe("const renamed = 1;");
    expect(result.skipped).toEqual(["missing.ts"]);
    revertAppliedEdits(files, result.applied);
    expect(files.get("a.ts")).toBe("const x = 1;");
  });

  it("previews hunks with context", () => {
    const files = new Map([["a.ts", "line1\nline2\nline3\nline4\nline5"]]);
    const previews = previewWorkspaceEdit(
      files,
      {
        edits: [{ uri: "a.ts", range: { start: { line: 3, column: 1 }, end: { line: 3, column: 6 } }, newText: "CHANGED" }],
        summary: "edit",
      },
      1,
    );
    expect(previews).toHaveLength(1);
    expect(previews[0]?.changeCount).toBe(1);
    expect(previews[0]?.hunks[0]?.after.join("\n")).toContain("CHANGED");
  });
});
