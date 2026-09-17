import { describe, expect, it } from "vitest";

import { createRequestManager } from "@/modules/intel/cancellation";
import { createSyntaxFallbackService, documentWords, extractJsScope, regexOutline } from "@/modules/intel/syntax-service";

function request() {
  return createRequestManager(() => 1).createRequest(1);
}

describe("syntax fallback", () => {
  it("completes document words and keywords", async () => {
    const service = createSyntaxFallbackService({ getText: () => "const elephant = 1;\nelephant" });
    const list = await service.completion(
      "f.ts",
      { line: 2, column: 8 },
      { inString: false, stringPrefix: "", wordPrefix: "eleph", invoked: true, triggerCharacter: null },
      request(),
    );
    expect(list.items.map((item) => item.label)).toContain("elephant");
  });

  it("offers member hints after a dot via babel scope analysis", async () => {
    const text = `const user = getUser();\nconsole.log(user.displayName);\nuser.`;
    const service = createSyntaxFallbackService({ getText: () => text });
    const list = await service.completion(
      "f.ts",
      { line: 3, column: 6 },
      { inString: false, stringPrefix: "", wordPrefix: "", invoked: true, triggerCharacter: "." },
      request(),
    );
    expect(list.items.map((item) => item.label)).toContain("displayName");
  });

  it("extracts imports/exports/locals from JS", async () => {
    const scope = await extractJsScope(
      `import React, { useState } from "react";\nimport * as path from "path";\nconst x = 1;\nfunction hello() {}\nexport default hello;`,
    );
    expect(scope.imports.map((entry) => entry.name).sort()).toEqual(["React", "path", "useState"]);
    expect(scope.locals).toContain("x");
    expect(scope.locals).toContain("hello");
  });

  it("builds regex outlines for python and java", () => {
    const python = regexOutline("python", "class Foo:\n    def bar(self):\n        pass\n");
    expect(python.map((symbol) => symbol.name)).toEqual(["Foo", "bar"]);
    const java = regexOutline("java", "public class Main {\n public static void main(String[] args) {}\n}");
    expect(java.map((symbol) => symbol.name)).toContain("Main");
  });

  it("reports TODO warnings as diagnostics", async () => {
    const service = createSyntaxFallbackService({ getText: () => "// TODO fix this" });
    const diagnostics = await service.diagnostics("f.ts", request());
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.severity).toBe("warning");
  });

  it("honestly reports no semantic capabilities", () => {
    const service = createSyntaxFallbackService({ getText: () => "" });
    expect(service.capabilities().semantic).toBe(false);
    expect(service.status().state).toBe("ready");
  });

  it("indexes document words helper", () => {
    expect(documentWords("foo bar foo", "bar")).toEqual(["foo"]);
  });
});
