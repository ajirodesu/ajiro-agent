import { describe, expect, it } from "vitest";

import { buildEditorDocument } from "@/editor/editorDocument";
import { adaptAppThemeToEditorTheme } from "@/editor/editorThemeAdapter";
import {
  filterLocalTodos,
  intelLanguageIdForGrammar,
  urisMatch,
} from "@/editor/intel-helpers";
import { containingSymbolPath } from "@/modules/intel/navigation";
import { aquaTheme } from "@/theme/aqua";

const theme = adaptAppThemeToEditorTheme(aquaTheme, null);

describe("intel bridge helpers", () => {
  it("maps grammar keys to intel language ids", () => {
    expect(intelLanguageIdForGrammar("typescript")).toBe("typescript");
    expect(intelLanguageIdForGrammar("sCSS")).toBe("scss");
    expect(intelLanguageIdForGrammar("sqlite")).toBe("sql");
    expect(intelLanguageIdForGrammar(null)).toBe("plaintext");
    expect(intelLanguageIdForGrammar("vue")).toBe("vue");
  });

  it("matches session URIs against open paths", () => {
    expect(urisMatch("file:///project/src/a.ts", "src/a.ts")).toBe(true);
    expect(urisMatch("src/a.ts", "src/a.ts")).toBe(true);
    expect(urisMatch("file:///project/src/a.ts", "src/b.ts")).toBe(false);
    expect(urisMatch("file:///project/src/a.ts", "/other/a.ts")).toBe(false);
  });

  it("keeps only TODO markers from local checks", () => {
    const diagnostics = filterLocalTodos([
      { severity: "error", message: "Unexpected token", line: 1, column: 1 },
      { severity: "warning", message: "TODO", line: 2, column: 1 },
      { severity: "warning", message: "FIXME", line: 3, column: 1 },
    ]);
    expect(diagnostics.map((diagnostic) => diagnostic.message)).toEqual(["TODO", "FIXME"]);
  });
});

describe("breadcrumb chain", () => {
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
  it("finds the deepest containing chain", () => {
    expect(containingSymbolPath(symbols, 7).map((symbol) => symbol.name)).toEqual(["Main", "render"]);
    expect(containingSymbolPath(symbols, 15).map((symbol) => symbol.name)).toEqual(["Main"]);
    expect(containingSymbolPath(symbols, 99)).toEqual([]);
  });
});

describe("intel document wiring", () => {
  it("embeds uri + intel flags and the intel bundle", () => {
    const html = buildEditorDocument({
      theme,
      grammarKey: "typescript",
      doc: "const a = 1;",
      uri: "src/a.ts",
      intelEnabled: true,
    });
    expect(html).toContain('"uri":"src/a.ts"');
    expect(html).toContain('"intel":true');
    expect(html).toContain("window.AjiroIntel");
    expect(html).toContain("intel:query");
    expect(html).toContain("intel:reopen");
  });

  it("stays inert without a uri", () => {
    const html = buildEditorDocument({ theme, grammarKey: "typescript", doc: "x" });
    expect(html).toContain('"intel":false');
  });
});
