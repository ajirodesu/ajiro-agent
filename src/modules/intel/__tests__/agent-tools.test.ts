import { describe, expect, it } from "vitest";

import { createIntelAgentTools } from "@/modules/intel/agent-tools";
import { createIntelEngine } from "@/modules/intel/index";
import { createSyntaxFallbackService } from "@/modules/intel/syntax-service";

describe("intel agent tools", () => {
  const text = "export function greet(name: string) {\n  return name;\n}\n";
  const engine = createIntelEngine({
    adapters: [createSyntaxFallbackService({ getText: () => text })],
    getText: () => text,
  });
  const tools = createIntelAgentTools({
    engine,
    languageIdFor: () => "typescript",
    readFile: () => Promise.resolve(text),
  });

  it("exposes the intel tool surface", () => {
    expect(Object.keys(tools).sort()).toEqual([
      "format_file",
      "get_code_actions",
      "get_definition",
      "get_diagnostics",
      "get_hover",
      "get_line",
      "get_outline",
      "get_references",
      "get_signature",
      "inspect_project",
      "organize_imports",
      "rename_symbol",
      "search_symbols",
    ]);
  });

  it("returns outline and diagnostics for real content", async () => {
    const outline = (await (
      tools.get_outline as unknown as { execute: (input: unknown) => Promise<{ name: string }[]> }
    ).execute({ uri: "f.ts" })) as { name: string }[];
    expect(outline.map((symbol) => symbol.name)).toContain("greet");
    const diagnostics = (await (
      tools.get_diagnostics as unknown as { execute: (input: unknown) => Promise<unknown[]> }
    ).execute({ uri: "f.ts" })) as unknown[];
    expect(diagnostics).toEqual([]);
  });

  it("reads single lines for previews", async () => {
    const line = (await (
      tools.get_line as unknown as { execute: (input: unknown) => Promise<string | null> }
    ).execute({ uri: "f.ts", line: 1 })) as string | null;
    expect(line).toContain("export function greet");
  });
});
