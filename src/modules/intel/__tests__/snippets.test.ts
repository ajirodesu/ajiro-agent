import { describe, expect, it } from "vitest";

import { createSnippetRegistry, parseSnippetPlaceholders } from "@/modules/intel/snippets";

describe("snippet placeholders", () => {
  it("parses tab stops, defaults, choices, and mirrors", () => {
    const { expanded, placeholders } = parseSnippetPlaceholders(
      "function ${1:name}(${2:args}) {\n\t$0\n} $$ ${1} ${2|a,b|}",
    );
    expect(expanded).toBe("function name(args) {\n\t\n} $ name a");
    // Definition stops only: ${1:name}, ${2:args}, $0, ${2|a,b|}.
    // The bare ${1} is a mirror (expands, not a stop).
    expect(placeholders.map((placeholder) => placeholder.index)).toEqual([0, 1, 2, 2]);
    const choice = placeholders.find((placeholder) => placeholder.choices !== null);
    expect(choice?.choices).toEqual(["a", "b"]);
    expect(placeholders.some((placeholder) => placeholder.index === 0)).toBe(true);
  });

  it("treats unterminated placeholders as literal text", () => {
    const { expanded } = parseSnippetPlaceholders("cost is ${1");
    expect(expanded).toBe("cost is ${1");
  });
});

describe("snippet registry", () => {
  it("matches by language and prefix", () => {
    const registry = createSnippetRegistry();
    expect(registry.matching("typescript", "fun").map((snippet) => snippet.prefix)).toContain("function");
    expect(registry.matching("python", "fun")).toEqual([]);
    expect(registry.matching("python", "de")).not.toEqual([]);
  });

  it("registers user snippets and converts to completion items", () => {
    const registry = createSnippetRegistry();
    const unregister = registry.register({
      id: "user:test",
      languageIds: "all",
      prefix: "hello",
      body: "hello ${1:world}",
      description: "greeting",
      origin: "user",
    });
    expect(registry.matching("go", "hel")).toHaveLength(1);
    const item = registry.toCompletionItem(registry.matching("go", "hel")[0]!, 5);
    expect(item.kind).toBe("snippet");
    expect(item.insertText).toBe("hello world");
    expect(item.source).toBe("snippet");
    unregister();
    expect(registry.matching("go", "hel")).toEqual([]);
  });
});
