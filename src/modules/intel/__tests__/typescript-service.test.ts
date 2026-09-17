/**
 * Semantic engine verification against the REAL TypeScript compiler.
 * Every test here exercises genuine language-service behavior — member
 * types, signatures, definitions, references, rename, fixes — not mocks.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import * as ts from "typescript";

import { createRequestManager } from "@/modules/intel/cancellation";
import { LIB_ENTRY, resolveLibClosure } from "@/modules/intel/ts-libs";
import { createTypeScriptService, type TypeScriptIntelService } from "@/modules/intel/typescript-service";

const here = dirname(fileURLToPath(import.meta.url));
const tsLibDir = join(here, "..", "..", "..", "..", "node_modules", "typescript", "lib");

function readPackageLib(fileName: string): string | null {
  try {
    return readFileSync(join(tsLibDir, fileName), "utf8");
  } catch {
    return null;
  }
}

const USER_CODE = `export interface User {
  id: number;
  displayName: string;
}

export function hello(name: string, greeting?: string): string {
  return \`\${greeting ?? "hi"} \${name}\`;
}

export let user: User = { id: 1, displayName: "ada" };
`;

const MAIN_CODE = `import { hello, user } from "./user";

const value: string = hello(user.displayName);
const missing = doesNotExist + 1;
user = { id: 2, displayName: "grace" };
console.log(value, missing);
`;

// Trailing-dot member completion lives in its own file so user.ts stays
// syntactically clean for the diagnostics test.
const MEMBER_CODE = `import { user } from "./user";
user.
`;

let service: TypeScriptIntelService;

beforeAll(async () => {
  const libFiles = resolveLibClosure(readPackageLib, LIB_ENTRY);
  expect(libFiles.size).toBeGreaterThan(3);
  service = createTypeScriptService({ ts, libFiles });
  await service.initialize();
  service.openDocument("file:///project/user.ts", "typescript", 1, USER_CODE);
  service.openDocument("file:///project/main.ts", "typescript", 1, MAIN_CODE);
  service.openDocument("file:///project/member.ts", "typescript", 1, MEMBER_CODE);
});

function request(version = 1) {
  return createRequestManager(() => version).createRequest(version);
}

describe("lib closure", () => {
  it("resolves the transitive lib set", () => {
    const closure = resolveLibClosure(readPackageLib);
    // Entry files are what the `lib` compiler option resolves
    // (lib.es2022.d.ts aggregates the es2022 chain via references).
    expect(closure.has("lib.es2022.d.ts")).toBe(true);
    expect(closure.has("lib.dom.d.ts")).toBe(true);
    expect(closure.has("lib.dom.iterable.d.ts")).toBe(true);
    expect(closure.has("lib.es5.d.ts")).toBe(true);
    for (const content of closure.values()) {
      expect(content.length).toBeGreaterThan(0);
    }
  });
});

describe("semantic completion", () => {
  it("returns User members after `user.` (not just words)", async () => {
    const list = await service.completion(
      "file:///project/member.ts",
      { line: 2, column: 6 },
      { inString: false, stringPrefix: "", wordPrefix: "", invoked: true, triggerCharacter: "." },
      request(),
    );
    const labels = list.items.map((item) => item.label);
    expect(labels).toContain("displayName");
    expect(labels).toContain("id");
    const display = list.items.find((item) => item.label === "displayName");
    expect(display?.source).toBe("semantic");
    // TS reports interface members as memberVariableElement ("field").
    expect(display?.kind).toBe("field");
  });

  it("resolves completion detail on demand", async () => {
    const list = await service.completion(
      "file:///project/member.ts",
      { line: 2, column: 6 },
      { inString: false, stringPrefix: "", wordPrefix: "", invoked: true, triggerCharacter: "." },
      request(),
    );
    const item = list.items.find((entry) => entry.label === "displayName");
    expect(item).toBeDefined();
    expect(item?.resolveId).not.toBeNull();
    const resolved = await service.resolveCompletion("file:///project/member.ts", item!, request());
    expect(resolved.detail).toContain("string");
  });
});

describe("signature help", () => {
  it("identifies the active parameter of hello(", async () => {
    // `hello(user.displayName)` — cursor after the first argument + comma.
    const text = MAIN_CODE;
    const callLine = text.split("\n").findIndex((line) => line.includes("hello(")) + 1;
    const help = await service.signatureHelp(
      "file:///project/main.ts",
      { line: callLine, column: text.split("\n")[callLine - 1]!.indexOf("hello(") + "hello(user.displayName".length + 1 },
      request(),
    );
    expect(help).not.toBeNull();
    expect(help?.signatures[0]?.parameters.map((parameter) => parameter.label)).toEqual([
      "name: string",
      "greeting?: string",
    ]);
  });
});

describe("hover", () => {
  it("shows the declared type of `user`", async () => {
    const hover = await service.hover("file:///project/user.ts", { line: 10, column: 14 }, request());
    expect(hover?.contents.join("\n")).toContain("User");
  });
});

describe("navigation", () => {
  it("goes to the definition of `hello` in user.ts", async () => {
    const callLine = MAIN_CODE.split("\n").findIndex((line) => line.includes("hello(")) + 1;
    const definitions = await service.definition(
      "file:///project/main.ts",
      { line: callLine, column: MAIN_CODE.split("\n")[callLine - 1]!.indexOf("hello") + 1 },
      request(),
    );
    expect(definitions.length).toBeGreaterThan(0);
    expect(definitions[0]?.uri).toBe("file:///project/user.ts");
  });

  it("finds references with read/write detail", async () => {
    const definitions = await service.definition("file:///project/user.ts", { line: 10, column: 14 }, request());
    expect(definitions.length).toBeGreaterThan(0);
    const detail = service.referenceDetail("file:///project/user.ts", { line: 10, column: 14 });
    expect(detail.length).toBeGreaterThanOrEqual(2);
    expect(detail.some((reference) => reference.isWrite)).toBe(true);
    expect(detail.some((reference) => !reference.isWrite)).toBe(true);
  });

  it("resolves the type definition of `user` to the User interface", async () => {
    const types = await service.typeDefinition("file:///project/user.ts", { line: 10, column: 14 }, request());
    expect(types.length).toBeGreaterThan(0);
    expect(types[0]?.uri).toBe("file:///project/user.ts");
  });
});

describe("diagnostics", () => {
  it("reports the undefined name in main.ts with a fixable code", async () => {
    const diagnostics = await service.diagnostics("file:///project/main.ts", request());
    const missing = diagnostics.find((diagnostic) => String(diagnostic.message).includes("doesNotExist"));
    expect(missing).toBeDefined();
    expect(missing?.severity).toBe("error");
    expect(missing?.code).toBe(2304);
  });

  it("is clean for user.ts", async () => {
    const diagnostics = await service.diagnostics("file:///project/user.ts", request());
    expect(diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  });
});

describe("rename", () => {
  it("prepares and renames `displayName` across files", async () => {
    const prepared = await service.prepareRename("file:///project/user.ts", { line: 3, column: 3 }, request());
    expect(prepared?.placeholder).toBe("displayName");
    const result = await service.rename("file:///project/user.ts", { line: 3, column: 3 }, "fullName", request());
    expect(result).not.toBeNull();
    expect(result?.edit.edits.length).toBeGreaterThanOrEqual(3);
    expect(result?.fileChangeCounts.map((entry) => entry.uri).sort()).toEqual([
      "file:///project/main.ts",
      "file:///project/user.ts",
    ]);
  });

  it("rejects invalid identifiers", async () => {
    await expect(
      service.rename("file:///project/user.ts", { line: 3, column: 3 }, "not a name", request()),
    ).rejects.toThrow(/valid identifier/);
  });
});

describe("code actions and imports", () => {
  it("organizes imports (drops nothing used, sorts)", async () => {
    service.openDocument("file:///project/messy.ts", "typescript", 1, `import { b } from "./b";\nimport { a } from "./a";\nconsole.log(a, b);\n`);
    const edits = await service.organizeImports("file:///project/messy.ts", request());
    expect(edits.length).toBeGreaterThan(0);
    service.closeDocument("file:///project/messy.ts");
  });

  it("formats a document", async () => {
    service.openDocument("file:///project/ugly.ts", "typescript", 1, "const    x=1\n");
    const edits = await service.formatting("file:///project/ugly.ts", request());
    expect(edits.length).toBeGreaterThan(0);
    service.closeDocument("file:///project/ugly.ts");
  });

  it("offers a spelling fix for a near-miss identifier", async () => {
    service.openDocument("file:///project/typo.ts", "typescript", 1, `import { hello } from "./user";\nconst shout = helloo("bob");\nconsole.log(shout);\n`);
    const diagnostics = await service.diagnostics("file:///project/typo.ts", request());
    const typo = diagnostics.find((diagnostic) => diagnostic.code === 2552);
    expect(typo).toBeDefined();
    const actions = await service.codeActions("file:///project/typo.ts", typo!.range, [typo!], request());
    expect(actions.some((action) => /spelling/i.test(action.title))).toBe(true);
    service.closeDocument("file:///project/typo.ts");
  });

  it("offers an auto-import fix for an unimported export", async () => {
    service.openDocument("file:///project/noimport.ts", "typescript", 1, `const shout = hello("bob");\nconsole.log(shout);\n`);
    const diagnostics = await service.diagnostics("file:///project/noimport.ts", request());
    const missing = diagnostics.find((diagnostic) => diagnostic.code === 2304);
    expect(missing).toBeDefined();
    const actions = await service.codeActions("file:///project/noimport.ts", missing!.range, [missing!], request());
    const addImport = actions.find((action) => /import/i.test(action.title));
    expect(addImport).toBeDefined();
    expect(addImport?.edit?.edits.some((edit) => edit.newText.includes("./user"))).toBe(true);
    service.closeDocument("file:///project/noimport.ts");
  });
});

describe("symbols and tokens", () => {
  it("builds a document outline from the navigation tree", async () => {
    const symbols = await service.documentSymbols("file:///project/user.ts", request());
    const names = symbols.map((symbol) => symbol.name);
    expect(names).toContain("User");
    expect(names).toContain("hello");
    expect(names).toContain("user");
  });

  it("lists import specifiers in the outline", async () => {
    const symbols = await service.documentSymbols("file:///project/main.ts", request());
    const modules = symbols.filter((symbol) => symbol.kind === "module").map((symbol) => symbol.name);
    expect(modules).toContain("./user");
  });

  it("emits semantic tokens with real classifications", async () => {
    const tokens = await service.semanticTokens("file:///project/user.ts", request());
    const types = new Set(tokens.map((token) => token.tokenType));
    expect(types.has("interface")).toBe(true);
    expect(types.has("function")).toBe(true);
    expect(types.has("variable")).toBe(true);
    expect(types.has("property")).toBe(true);
    expect(tokens.length).toBeGreaterThan(5);
    const declaration = tokens.find((token) => token.tokenType === "interface");
    expect(declaration?.tokenModifiers).toContain("declaration");
  });

  it("finds workspace symbols across the project", async () => {
    const symbols = await service.workspaceSymbols("hello", request());
    expect(symbols.some((symbol) => symbol.name === "hello")).toBe(true);
  });

  it("derives inlay type hints for unannotated variables", async () => {
    service.openDocument("file:///project/hints.ts", "typescript", 1, `let inferred = 42;\nconsole.log(inferred);\n`);
    const hints = await service.inlayHints(
      "file:///project/hints.ts",
      { start: { line: 1, column: 1 }, end: { line: 2, column: 20 } },
      request(),
    );
    expect(hints.some((hint) => hint.label.includes("number"))).toBe(true);
    service.closeDocument("file:///project/hints.ts");
  });
});

describe("refactor edits", () => {
  it("extracts a constant via getEditsForRefactor", () => {
    service.openDocument("file:///project/ref.ts", "typescript", 1, `const total = 40 + 2;\nconsole.log(total);\n`);
    // "40 + 2" occupies offsets 14..20: end-exclusive column 21.
    const range = { start: { line: 1, column: 15 }, end: { line: 1, column: 21 } };
    const refactors = service.applicableRefactors("file:///project/ref.ts", range);
    expect(refactors.length).toBeGreaterThan(0);
    const extract = refactors.find((refactor) => /extract/i.test(refactor.name));
    expect(extract).toBeDefined();
    const { edits } = service.refactorEdits("file:///project/ref.ts", range, extract!.name, extract!.actions[0]!.name);
    expect(edits.length).toBeGreaterThan(0);
    service.closeDocument("file:///project/ref.ts");
  });
});
