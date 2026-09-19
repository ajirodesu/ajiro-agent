import { describe, expect, it } from "vitest";

import type { ExtensionMetadata } from "../models";
import {
  entryInStoreScope,
  isFreeEntry,
  pluginScopes,
  scopesForStore,
} from "../scopes";

function entry(overrides: Partial<ExtensionMetadata>): ExtensionMetadata {
  return {
    author: null,
    category: null,
    channel: null,
    changelog: null,
    dependencies: [],
    deprecated: false,
    description: null,
    download: null,
    icon: null,
    id: "com.example.test",
    keywords: [],
    license: null,
    minVersionCode: null,
    minVersionName: null,
    name: "Test",
    price: 0,
    readme: null,
    repository: null,
    revoked: false,
    rolloutPercent: null,
    source: "registry",
    updatedAt: null,
    version: "1.0.0",
    ...overrides,
  };
}

describe("pluginScopes", () => {
  it("detects themes by Acode id rule or keyword", () => {
    expect(
      pluginScopes(entry({ id: "acode.plugin.dracula-theme" })),
    ).toContain("theme");
    expect(
      pluginScopes(entry({ id: "com.example.x", keywords: ["theme"] })),
    ).toContain("theme");
  });

  it("detects terminal plugins", () => {
    expect(
      pluginScopes(
        entry({
          id: "acode.plugin.terminal-snippets",
          name: "Terminal Snippets",
        }),
      ),
    ).toContain("terminal");
  });

  it("detects languages by category or language names", () => {
    expect(
      pluginScopes(entry({ id: "acode.plugin.python", keywords: ["python"] })),
    ).toContain("language");
    expect(
      pluginScopes(
        entry({ id: "com.example.x", category: "Languages", name: "X" }),
      ),
    ).toContain("language");
  });

  it("detects editor and file-manager signals", () => {
    expect(
      pluginScopes(
        entry({ id: "com.example.csspeek", name: "CSS Peek for Acode" }),
      ),
    ).toContain("editor");
    expect(
      pluginScopes(
        entry({ id: "acode.plugin.ftp", keywords: ["ftp", "sftp"] }),
      ),
    ).toContain("filemanager");
  });

  it("detects webview and snippet scopes", () => {
    expect(
      pluginScopes(
        entry({ id: "com.example.preview", keywords: ["preview"] }),
      ),
    ).toContain("webview");
    expect(
      pluginScopes(
        entry({ id: "acode.plugin.snippets", name: "Snippets" }),
      ),
    ).toContain("snippets");
  });

  it("falls back to other and never returns empty", () => {
    expect(pluginScopes(entry({}))).toEqual(["other"]);
  });
});

describe("store scoping", () => {
  const theme = entry({ id: "acode.plugin.monokai" });
  const terminal = entry({
    id: "com.example.term",
    keywords: ["terminal"],
  });
  const language = entry({ id: "acode.plugin.python", keywords: ["python"] });
  const editor = entry({ id: "com.example.csspeek", name: "CSS Peek" });
  const other = entry({ id: "com.example.misc", name: "Misc Utils" });

  it("splits studio (themes/terminal) from workshop (editor/language/filemanager)", () => {
    expect(entryInStoreScope(theme, "studio")).toBe(true);
    expect(entryInStoreScope(terminal, "studio")).toBe(true);
    expect(entryInStoreScope(language, "studio")).toBe(false);
    expect(entryInStoreScope(editor, "studio")).toBe(false);
    expect(entryInStoreScope(theme, "workshop")).toBe(false);
    expect(entryInStoreScope(language, "workshop")).toBe(true);
    expect(entryInStoreScope(editor, "workshop")).toBe(true);
    expect(entryInStoreScope(other, "studio")).toBe(false);
    expect(entryInStoreScope(other, "workshop")).toBe(false);
  });

  it("shows everything under the all escape hatch", () => {
    for (const item of [theme, terminal, language, editor, other]) {
      expect(entryInStoreScope(item, "all")).toBe(true);
    }
    expect(scopesForStore("all")).toBeNull();
  });
});

describe("isFreeEntry", () => {
  it("excludes paid plugins", () => {
    expect(isFreeEntry(entry({ price: 0 }))).toBe(true);
    expect(isFreeEntry(entry({}))).toBe(true);
    expect(isFreeEntry(entry({ price: 1.99 }))).toBe(false);
  });
});
