/**
 * Formatter registry + selection tests (verified against Acode's current
 * `src/lib/acode.js` and `registerPrettierFormatter.js`).
 */
import { describe, expect, it } from "vitest";

import { EXTENSION_TO_MODE_KEY } from "../../../editor/editorLanguages";
import {
  createMemoryFormatterSelections,
  createFormatterRegistry,
  extensionsForLanguageId,
  formatterOptionsFor,
  formatterSupportsLanguage,
  languageIdsForExtensions,
  normalizeFormatterExtensions,
  pruneFormatterSelections,
} from "../formatters";

describe("formatter extension normalization (Acode semantics)", () => {
  it("filters arrays, wraps single strings, defaults to match-all", () => {
    expect(normalizeFormatterExtensions(["js", "", "TS", ".jsx"])).toEqual([
      "js",
      "ts",
      "jsx",
    ]);
    expect(normalizeFormatterExtensions([])).toEqual(["*"]);
    expect(normalizeFormatterExtensions(["", "  "])).toEqual(["*"]);
    expect(normalizeFormatterExtensions("py")).toEqual(["py"]);
    expect(normalizeFormatterExtensions("  ")).toEqual(["*"]);
    expect(normalizeFormatterExtensions(null)).toEqual(["*"]);
    expect(normalizeFormatterExtensions(42)).toEqual(["*"]);
  });
});

describe("formatter registry", () => {
  it("registers newest-first and replaces the same pair", () => {
    const registry = createFormatterRegistry();
    registry.register({ pluginId: "a", formatterId: "pretty", extensions: ["js"], displayName: "Pretty" });
    registry.register({ pluginId: "b", formatterId: "tidy", extensions: ["*"], displayName: "" });
    expect(registry.list().map((entry) => entry.formatterId)).toEqual(["tidy", "pretty"]);
    registry.register({ pluginId: "a", formatterId: "pretty", extensions: ["js", "ts"], displayName: "Pretty 2" });
    expect(registry.list()).toHaveLength(2);
    expect(registry.get("pretty")?.extensions).toEqual(["js", "ts"]);
  });

  it("unregisters by owner and drops a plugin wholesale", () => {
    const registry = createFormatterRegistry();
    registry.register({ pluginId: "a", formatterId: "pretty", extensions: ["js"], displayName: "P" });
    registry.register({ pluginId: "b", formatterId: "pretty", extensions: ["js"], displayName: "Q" });
    // Same formatter id, different owner: both coexist (Acode parity).
    expect(registry.list()).toHaveLength(2);
    expect(registry.unregister("a", "pretty")).toBe(true);
    expect(registry.unregister("a", "pretty")).toBe(false);
    registry.unregisterPlugin("b");
    expect(registry.list()).toEqual([]);
  });
});

describe("getFormatterFor options", () => {
  it("leads with None and matches overlaps or match-all", () => {
    const options = formatterOptionsFor(
      [
        { displayName: "Pretty", extensions: ["js", "ts"], formatterId: "pretty" },
        { displayName: "", extensions: ["*"], formatterId: "all" },
        { displayName: "Py", extensions: ["py"], formatterId: "py" },
      ],
      ["ts"],
    );
    expect(options).toEqual([
      [null, "None"],
      ["pretty", "Pretty"],
      ["all", "all"],
    ]);
  });
});

describe("formatter selections", () => {
  it("prunes selections pointing at gone formatters", () => {
    expect(
      pruneFormatterSelections({ typescript: "pretty", python: "gone" }, new Set(["pretty"])),
    ).toEqual({ typescript: "pretty" });
  });

  it("memory store round-trips", async () => {
    const store = createMemoryFormatterSelections({ typescript: "pretty" });
    expect(await store.loadSelections()).toEqual({ typescript: "pretty" });
    await store.saveSelections({ python: "py" });
    expect(await store.loadSelections()).toEqual({ python: "py" });
    expect(store.selections).toEqual({ python: "py" });
  });
});

describe("language extensions (inverted editor table)", () => {
  it("derives formatter-declared extensions from the grammar table", () => {
    const extensions = extensionsForLanguageId("typescript", EXTENSION_TO_MODE_KEY);
    expect(extensions).toContain("ts");
    expect(extensions).toContain("tsx");
    expect(extensionsForLanguageId("python", EXTENSION_TO_MODE_KEY)).toContain("py");
    expect(extensionsForLanguageId("", EXTENSION_TO_MODE_KEY)).toEqual([]);
    expect(extensionsForLanguageId("klingon", EXTENSION_TO_MODE_KEY)).toEqual([]);
  });

  it("matches registrations against languages", () => {
    expect(
      formatterSupportsLanguage({ extensions: ["js", "ts"] }, ["ts", "tsx"]),
    ).toBe(true);
    expect(formatterSupportsLanguage({ extensions: ["*"] }, ["py"])).toBe(true);
    expect(formatterSupportsLanguage({ extensions: ["py"] }, ["ts"])).toBe(false);
  });

  it("maps formatter extensions onto language ids", () => {
    const table = { ".js": "javascript", ".ts": "typescript", ".json": "json" };
    expect(languageIdsForExtensions(["ts", ".js", "js"], table)).toEqual([
      "javascript",
      "typescript",
    ]);
    expect(languageIdsForExtensions(["zzz", " ", ".TS "], table)).toEqual([
      "typescript",
    ]);
    expect(languageIdsForExtensions(["*"], table)).toEqual([
      "javascript",
      "json",
      "typescript",
    ]);
  });
});
