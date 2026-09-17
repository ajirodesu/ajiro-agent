import { describe, expect, it } from "vitest";

import { applyRefactor, planRefactor, resolveRefactorNames, undoRefactor } from "@/modules/intel/refactor";
import type { RefactorBackend } from "@/modules/intel/refactor";

const BACKEND: RefactorBackend = {
  applicableRefactors: () => [
    {
      name: "Extract Symbol",
      description: "Extract to constant or function",
      actions: [
        { name: "extract to constant in enclosing scope", description: "Extract to constant" },
        { name: "extract to function in enclosing scope", description: "Extract to function" },
      ],
    },
  ],
  refactorEdits: (_uri, range, _refactorName, actionName) => ({
    edits: [
      {
        uri: "a.ts",
        range,
        newText: actionName.includes("constant") ? "extracted" : "extracted()",
      },
    ],
    renameLocation: null,
  }),
  organizeImports: () => Promise.resolve([]),
};

describe("refactor planning", () => {
  const range = { start: { line: 1, column: 15 }, end: { line: 1, column: 21 } };

  it("resolves extract-variable to the constant action", () => {
    const resolved = resolveRefactorNames(BACKEND, "a.ts", range, "extract-variable");
    expect(resolved?.actionName).toContain("constant");
  });

  it("returns null for unknown kinds", () => {
    expect(resolveRefactorNames(BACKEND, "a.ts", range, "organize-imports")).toBeNull();
    expect(
      resolveRefactorNames({ ...BACKEND, applicableRefactors: () => [] }, "a.ts", range, "extract-function"),
    ).toBeNull();
  });

  it("plans, applies, previews, and undoes", () => {
    const files = new Map([["a.ts", "const total = 40 + 2;"]]);
    const plan = planRefactor(BACKEND, files, "a.ts", range, "extract-constant");
    expect(plan).not.toBeNull();
    expect(plan?.preview).toHaveLength(1);
    const result = applyRefactor(files, plan!);
    expect(files.get("a.ts")).toContain("extracted");
    expect(result.applied).toHaveLength(1);
    undoRefactor(files, result.applied);
    expect(files.get("a.ts")).toBe("const total = 40 + 2;");
  });
});
