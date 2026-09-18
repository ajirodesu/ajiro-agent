import { describe, expect, it } from "vitest";

import {
  searchSettingsEntries,
  SETTINGS_SEARCH_ENTRIES,
} from "../search-index";

describe("settings search index", () => {
  it("lists every destination exactly once", () => {
    const ids = SETTINGS_SEARCH_ENTRIES.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of SETTINGS_SEARCH_ENTRIES) {
      expect(entry.label.trim().length).toBeGreaterThan(0);
      expect(entry.keywords.length).toBeGreaterThan(0);
      if (entry.target.kind === "route") {
        expect(entry.target.route.startsWith("/settings")).toBe(true);
      } else {
        expect(entry.target.drawer.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("returns everything on empty query", () => {
    expect(searchSettingsEntries("")).toHaveLength(SETTINGS_SEARCH_ENTRIES.length);
    expect(searchSettingsEntries("   ")).toHaveLength(SETTINGS_SEARCH_ENTRIES.length);
  });

  it("matches labels, descriptions, keywords, and ids", () => {
    expect(searchSettingsEntries("mcp").map((entry) => entry.id)).toEqual(
      expect.arrayContaining(["mcp", "mcp-list", "mcp-add"]),
    );
    expect(searchSettingsEntries("dark mode").map((entry) => entry.id)).toContain(
      "theme",
    );
    expect(searchSettingsEntries("MODEL").map((entry) => entry.id)).toContain(
      "current-model",
    );
  });

  it("requires every word to match and restores on clear", () => {
    expect(searchSettingsEntries("mcp catalog").map((entry) => entry.id)).toEqual([
      "mcp-list",
    ]);
    expect(searchSettingsEntries("zzz-no-match")).toEqual([]);
  });
});
