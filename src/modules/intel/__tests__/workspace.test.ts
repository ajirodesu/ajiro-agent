import { describe, expect, it } from "vitest";

import {
  createWorkspaceManager,
  fingerprintText,
  parsePackageJson,
  parseTsConfig,
  resolvePathAlias,
  shouldSkipDir,
} from "@/modules/intel/workspace";

function memoryReader(files: Record<string, string>) {
  return {
    async listFiles() {
      return Object.keys(files);
    },
    async readFile(uri: string) {
      const text = files[uri];
      return text === undefined ? null : { text, mtimeMs: 1 };
    },
  };
}

const EXTRACT = (uri: string, languageId: string, text: string) => {
  void languageId;
  const symbols =
    uri.endsWith(".ts") && text.includes("greet")
      ? [
          {
            name: "greet",
            kind: "function" as const,
            range: { start: { line: 1, column: 1 }, end: { line: 1, column: 10 } },
            selectionRange: { start: { line: 1, column: 10 }, end: { line: 1, column: 15 } },
            children: [],
          },
        ]
      : [];
  const imports = [...text.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1] as string);
  return { symbols, imports, exports: [] };
};

describe("fingerprints and skips", () => {
  it("fingerprints change with content", () => {
    expect(fingerprintText("abc")).not.toBe(fingerprintText("abd"));
    expect(fingerprintText("abc")).toBe(fingerprintText("abc"));
  });

  it("skips vendored and hidden dirs", () => {
    expect(shouldSkipDir("node_modules", new Set())).toBe(true);
    expect(shouldSkipDir(".git", new Set())).toBe(true);
    expect(shouldSkipDir("src", new Set())).toBe(false);
    expect(shouldSkipDir("gen", new Set(["gen"]))).toBe(true);
  });
});

describe("config parsing", () => {
  it("parses package.json deps and scripts", () => {
    const parsed = parsePackageJson(
      JSON.stringify({ dependencies: { react: "1.0.0" }, scripts: { test: "vitest" } }),
      "file:///package.json",
    );
    expect(parsed?.dependencies).toEqual(["react"]);
    expect(parsed?.scripts.test).toBe("vitest");
    expect(parsePackageJson("not json", "file:///package.json")).toBeNull();
  });

  it("parses tsconfig with comments, paths, and jsx", () => {
    const parsed = parseTsConfig(
      `{\n// comment\n"compilerOptions": { "baseUrl": ".", "jsx": "react-jsx", "paths": { "@/*": ["src/*"] } }\n}`,
      "file:///tsconfig.json",
    );
    expect(parsed?.paths["@/*"]).toEqual(["src/*"]);
    expect(parsed?.jsx).toBe("react-jsx");
    expect(parseTsConfig("{{{", "file:///tsconfig.json")).toBeNull();
  });

  it("resolves path aliases longest-prefix-first", () => {
    const paths = { "@/*": ["src/*"], "@/deep/*": ["src/deep/*"] };
    expect(resolvePathAlias("@/deep/x", paths)).toEqual(["src/deep/x"]);
    expect(resolvePathAlias("@/x", paths)).toEqual(["src/x"]);
    expect(resolvePathAlias("react", paths)).toEqual([]);
  });
});

describe("workspace manager", () => {
  const files = {
    "file:///project/src/a.ts": `import { b } from "./b";\nexport function greet() { return b; }`,
    "file:///project/src/b.ts": `export const b = 1;`,
    "file:///project/node_modules/dep/index.js": `module.exports = {};`,
    "file:///project/package.json": JSON.stringify({ dependencies: { a: "1" } }),
    "file:///project/tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@/*": ["src/*"] } } }),
  };

  it("indexes, skips node_modules, and searches symbols", async () => {
    const manager = createWorkspaceManager(memoryReader(files), EXTRACT);
    const snapshot = await manager.indexProject("file:///project");
    expect(snapshot.files.some((file) => file.uri.includes("node_modules"))).toBe(false);
    expect(snapshot.totalSymbols).toBeGreaterThan(0);
    expect(manager.searchSymbols("gre")).toEqual([
      expect.objectContaining({ name: "greet", uri: "file:///project/src/a.ts" }),
    ]);
  });

  it("updateFile is fingerprint-stable; dependents resolve imports", async () => {
    const manager = createWorkspaceManager(memoryReader(files), EXTRACT);
    await manager.indexProject("file:///project");
    const first = await manager.updateFile("file:///project/src/a.ts");
    const second = await manager.updateFile("file:///project/src/a.ts");
    expect(first).toBe(second);
    expect(manager.dependentsOf("file:///project/src/b.ts")).toEqual(["file:///project/src/a.ts"]);
    manager.removeFile("file:///project/src/b.ts");
    expect(manager.getFile("file:///project/src/b.ts")).toBeNull();
  });

  it("reads project configs", async () => {
    const manager = createWorkspaceManager(memoryReader(files), EXTRACT);
    const config = await manager.getConfig("file:///project");
    expect(config.packageJson?.dependencies).toEqual(["a"]);
    expect(config.tsconfig?.paths["@/*"]).toEqual(["src/*"]);
  });
});
