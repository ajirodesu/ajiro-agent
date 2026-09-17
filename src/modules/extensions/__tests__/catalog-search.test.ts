/**
 * Catalog search index, installed-state filters, and the featured shelf
 * (§28/§66). The index must never change *which* extensions match — only how
 * fast they are found — so the load-bearing test compares it against the
 * plain substring scan it replaces.
 */
import { describe, expect, it } from "vitest";

import {
  buildCatalogSearchIndex,
  CATALOG_STATE_FILTERS,
  catalogHaystack,
  filterCatalogEntries,
  listFeaturedExtensions,
  searchCatalogIndex,
} from "../catalog";
import type { ExtensionMetadata, InstalledExtensionRecord } from "../models";

function author(github: string, name: string) {
  return { email: null, github, name, url: null };
}

function metadata(overrides: Partial<ExtensionMetadata>): ExtensionMetadata {
  const base: ExtensionMetadata = {
    author: null,
    category: null,
    channel: null,
    changelog: null,
    dependencies: [],
    deprecated: false,
    description: null,
    download: null,
    icon: null,
    id: "plugin.a",
    keywords: [],
    license: null,
    minVersionCode: null,
    minVersionName: null,
    name: "Plugin A",
    price: 0,
    readme: null,
    repository: null,
    revoked: false,
    rolloutPercent: null,
    source: "registry",
    updatedAt: null,
    version: "1.0.0",
  };
  return Object.assign(base, overrides);
}

function record(
  overrides: Partial<InstalledExtensionRecord>,
): InstalledExtensionRecord {
  return {
    compatibility: { level: "compatible", reasons: [] },
    enabled: true,
    id: "plugin.a",
    installedAt: "2026-01-01T00:00:00Z",
    manifest: { id: "plugin.a", version: "1.0.0" },
    packageSha256: null,
    permissions: [],
    runtimeError: null,
    runtimeState: "enabled",
    signature: null,
    source: "registry",
    sourceUrl: null,
    updatedAt: "2026-01-01T00:00:00Z",
    version: "1.0.0",
    ...overrides,
  };
}

const CATALOG: ExtensionMetadata[] = [
  metadata({
    author: author("ada", "Ada"),
    description: "Refactor React components with a single command.",
    id: "com.ada.refactor",
    keywords: ["react", "refactor"],
    name: "Refactor",
  }),
  metadata({
    category: "Themes",
    description: "A calm dark theme.",
    id: "com.ben.theme",
    keywords: ["theme", "dark"],
    name: "Calm Theme",
  }),
  metadata({
    description: "Markdown preview inside the editor.",
    id: "com.cy.preview",
    keywords: ["markdown"],
    name: "Markdown Preview",
  }),
  metadata({
    author: author("dan", "Dan"),
    description: null,
    id: "com.dan.react-tools",
    keywords: ["react"],
    name: "React Tools",
  }),
];

describe("catalog search index", () => {
  it("indexes the identity fields and nothing else", () => {
    const entry = metadata({
      author: author("ada", "Ada"),
      description: "desc",
      id: "com.ada.plugin",
      keywords: ["one"],
      name: "Name",
      readme: "SECRET_TOKEN",
    });
    const haystack = catalogHaystack(entry);
    expect(haystack).toContain("com.ada.plugin");
    expect(haystack).toContain("ada");
    expect(haystack).toContain("one");
    // Documentation is not identity: it must not make an entry findable.
    expect(haystack).not.toContain("SECRET_TOKEN");
  });

  it("returns exactly the entries a substring scan would", () => {
    const index = buildCatalogSearchIndex(CATALOG);
    for (const needle of [
      "react",
      "REACT",
      "the",
      "theme",
      "ada",
      "com.cy",
      "markdown preview",
      "refactor react",
      "zzz",
      "a",
      "ab",
      "  ",
    ]) {
      const expected = CATALOG.filter((entry) =>
        catalogHaystack(entry).includes(needle.trim().toLowerCase()),
      );
      expect(searchCatalogIndex(index, needle).map((entry) => entry.id)).toEqual(
        expected.map((entry) => entry.id),
      );
    }
  });

  it("preserves catalog order for multi-hit queries", () => {
    const index = buildCatalogSearchIndex(CATALOG);
    expect(searchCatalogIndex(index, "react").map((entry) => entry.id)).toEqual([
      "com.ada.refactor",
      "com.dan.react-tools",
    ]);
  });

  it("returns everything for an empty query and nothing for a miss", () => {
    const index = buildCatalogSearchIndex(CATALOG);
    expect(searchCatalogIndex(index, "")).toHaveLength(CATALOG.length);
    expect(searchCatalogIndex(index, "nonexistent-needle")).toEqual([]);
  });

  it("stays correct when the index is stale, by rebuilding if it must", () => {
    const index = buildCatalogSearchIndex(CATALOG);
    const other = [metadata({ id: "com.only.here", name: "Only Here" })];
    // A mismatched index is ignored rather than trusted.
    expect(
      filterCatalogEntries(other, [], { query: "only", searchIndex: index }),
    ).toHaveLength(1);
  });
});

describe("installed-state filters", () => {
  const installed: InstalledExtensionRecord[] = [
    record({ id: "com.ada.refactor", runtimeState: "enabled" }),
    record({ enabled: false, id: "com.ben.theme", runtimeState: "disabled" }),
    record({
      id: "com.cy.preview",
      runtimeError: "boom",
      runtimeState: "broken",
    }),
    record({ id: "com.dan.react-tools", version: "0.5.0" }),
  ];

  function idsFor(state: (typeof CATALOG_STATE_FILTERS)[number]): string[] {
    return filterCatalogEntries(CATALOG, installed, {
      installedOnly: true,
      state,
    }).map((entry) => entry.id);
  }

  it("exposes one filter per installed state", () => {
    expect(CATALOG_STATE_FILTERS).toEqual([
      "all",
      "enabled",
      "disabled",
      "broken",
      "revoked",
      "update-available",
    ]);
  });

  it("narrows to enabled, disabled, broken, and update-available", () => {
    expect(idsFor("all")).toHaveLength(4);
    expect(idsFor("enabled")).toEqual([
      "com.ada.refactor",
      "com.dan.react-tools",
    ]);
    expect(idsFor("disabled")).toEqual(["com.ben.theme"]);
    expect(idsFor("broken")).toEqual(["com.cy.preview"]);
    expect(idsFor("update-available")).toEqual(["com.dan.react-tools"]);
  });

  it("composes with a query and a category", () => {
    expect(
      filterCatalogEntries(CATALOG, installed, {
        installedOnly: true,
        query: "theme",
        state: "disabled",
      }).map((entry) => entry.id),
    ).toEqual(["com.ben.theme"]);
    expect(
      filterCatalogEntries(CATALOG, installed, {
        category: "Themes",
        query: "react",
        state: "broken",
      }),
    ).toEqual([]);
  });
});

describe("featured shelf", () => {
  it("prefers richer metadata and honors the limit", () => {
    expect(listFeaturedExtensions(CATALOG, 2)).toHaveLength(2);
    // Scoring is keywords + category (+ readme/icon/download), so the richer
    // entries lead and the bare-description one trails; ties fall back to
    // name order.
    expect(listFeaturedExtensions(CATALOG).map((entry) => entry.id)).toEqual([
      "com.ben.theme",
      "com.ada.refactor",
      // Equal scores (one keyword each, no dates) fall back to name order:
      // "Markdown Preview" before "React Tools".
      "com.cy.preview",
      "com.dan.react-tools",
    ]);
  });

  it("is deterministic for equal metadata", () => {
    const twin = [
      metadata({ id: "com.b", name: "Bravo" }),
      metadata({ id: "com.a", name: "Alpha" }),
    ];
    expect(listFeaturedExtensions(twin).map((entry) => entry.id)).toEqual([
      "com.a",
      "com.b",
    ]);
    expect(listFeaturedExtensions(twin)).toEqual(listFeaturedExtensions(twin));
  });

  it("breaks ties by the newest declared update", () => {
    const dated = [
      metadata({ id: "com.old", name: "Old", updatedAt: "2020-01-01T00:00:00Z" }),
      metadata({ id: "com.new", name: "New", updatedAt: "2026-08-01T00:00:00Z" }),
    ];
    expect(listFeaturedExtensions(dated).map((entry) => entry.id)).toEqual([
      "com.new",
      "com.old",
    ]);
  });

  it("never invents entries beyond the catalog", () => {
    expect(listFeaturedExtensions([], 5)).toEqual([]);
    expect(listFeaturedExtensions(CATALOG, 0)).toEqual([]);
  });
});
