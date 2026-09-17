import { describe, expect, it } from "vitest";

import { aliasPrefixesFor, completePaths } from "@/modules/intel/paths";

const INDEX = {
  files: [
    "src/a.ts",
    "src/b.ts",
    "src/components/button.tsx",
    "src/utils/help.ts",
  ],
  directories: ["src", "src/components", "src/utils"],
  dependencies: ["react", "react-native"],
  devDependencies: ["vitest"],
  aliasPrefixes: ["@/", "~/"],
};

describe("path completion", () => {
  it("suggests packages and aliases for bare specifiers", () => {
    const items = completePaths(INDEX, "src/a.ts", "re");
    expect(items.map((item) => item.label)).toContain("react");
    expect(items.every((item) => item.source === "package")).toBe(true);
    const aliases = completePaths(INDEX, "src/a.ts", "@");
    expect(aliases.map((item) => item.label)).toContain("@/");
  });

  it("lists relative siblings with extension stripping", () => {
    const items = completePaths(INDEX, "src/a.ts", "./");
    expect(items.map((item) => item.label)).toContain("b");
    expect(items.find((item) => item.label === "b")?.insertText).toBe("./b");
  });

  it("lists subdirectories with trailing slash", () => {
    const items = completePaths(INDEX, "src/a.ts", "./c");
    expect(items.map((item) => item.label)).toContain("components/");
  });

  it("derives alias prefixes from tsconfig paths", () => {
    expect(aliasPrefixesFor({ "@/*": ["src/*"], "@": ["src"] })).toEqual(["@", "@/"]);
  });
});
