import { describe, expect, it } from "vitest";

import { countIntelDiagnostics, mergeDiagnostics, toEditorDiagnostics } from "@/modules/intel/diagnostics";
import type { IntelDiagnostic } from "@/modules/intel/types";

function diagnostic(
  severity: IntelDiagnostic["severity"],
  message: string,
  line: number,
  source = "ts-semantic",
): IntelDiagnostic {
  return {
    severity,
    message,
    source,
    code: 1,
    range: { start: { line, column: 1 }, end: { line, column: 5 } },
    related: [],
    fixable: false,
  };
}

describe("diagnostics merge", () => {
  it("orders by severity then position then source, deduped", () => {
    const merged = mergeDiagnostics([
      [diagnostic("warning", "w", 3), diagnostic("error", "e", 5)],
      [diagnostic("error", "e", 5), diagnostic("error", "a", 1, "b-source")],
    ]);
    expect(merged.map((entry) => entry.message)).toEqual(["a", "e", "w"]);
  });

  it("maps to editor diagnostics and counts", () => {
    const list = [
      diagnostic("error", "e", 1),
      diagnostic("warning", "w", 2),
      diagnostic("info", "i", 3),
      diagnostic("hint", "h", 4),
    ];
    expect(toEditorDiagnostics(list)).toHaveLength(2);
    expect(countIntelDiagnostics(list)).toEqual({ errors: 1, warnings: 1, infos: 1, hints: 1 });
  });
});
