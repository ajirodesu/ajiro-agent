import { describe, expect, it } from "vitest";

import {
  computeCatalogChanges,
  deriveExtensionInstallState,
  filterCatalogEntries,
  findUpdateAvailable,
  mergeCatalogEntries,
  parseCatalogCache,
  syncCatalogCache,
  type CatalogCache,
  type CatalogPersistence,
} from "../catalog";
import {
  AJIRO_ACODE_VERSION_CODE,
  compareExtensionVersions,
  evaluateCompatibility,
} from "../compatibility";
import { parsePluginManifest } from "../manifest";
import type { ExtensionMetadata, InstalledExtensionRecord } from "../models";
import { AcodeRegistryProvider, SeededRegistryProvider } from "../registry";

function metadata(overrides: Partial<ExtensionMetadata>): ExtensionMetadata {
  return {
    author: null,
    category: null,
    changelog: null,
    dependencies: [],
    description: "desc",
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
    source: "registry",
    updatedAt: null,
    version: "1.0.0",
    ...overrides,
  };
}

function record(
  overrides: Partial<InstalledExtensionRecord>,
): InstalledExtensionRecord {
  return {
    compatibility: { level: "compatible", reasons: [] },
    enabled: true,
    id: "plugin.a",
    installedAt: "2026-01-01T00:00:00Z",
    manifest: {},
    packageSha256: null,
    permissions: [],
    runtimeError: null,
    runtimeState: "disabled",
    signature: null,
    source: "registry",
    sourceUrl: null,
    updatedAt: "2026-01-01T00:00:00Z",
    version: "1.0.0",
    ...overrides,
  };
}

function memoryPersistence(cache: CatalogCache | null): CatalogPersistence & {
  saveCount: number;
} {
  const state = { stored: cache, saveCount: 0 };
  return {
    get saveCount() {
      return state.saveCount;
    },
    set saveCount(value: number) {
      state.saveCount = value;
    },
    async load() {
      return state.stored;
    },
    async save(next) {
      state.stored = next;
      state.saveCount += 1;
    },
  };
}

function providerReturning(entries: ExtensionMetadata[], status = 200) {
  return new AcodeRegistryProvider(async () => ({
    json: async () => ({ plugins: entries.map((entry) => ({ ...entry })) }),
    ok: status === 200,
    status,
  }));
}

describe("catalog diff engine", () => {
  it("detects added / updated / removed / version-updated", () => {
    const previous = [
      metadata({ id: "a", version: "1.0.0" }),
      metadata({ id: "b", version: "2.0.0" }),
      metadata({ id: "c", version: "1.0.0" }),
    ];
    const next = [
      metadata({ id: "a", version: "1.1.0" }),
      metadata({ id: "b", version: "2.0.0", description: "changed" }),
      metadata({ id: "d", version: "0.1.0" }),
    ];
    const changes = computeCatalogChanges(previous, next);
    const types = changes.map((change) => change.type).sort();
    // A version bump is reported twice on purpose: once as version-updated
    // and once as a metadata "updated" change.
    expect(types).toEqual([
      "added",
      "removed",
      "updated",
      "updated",
      "version-updated",
    ]);
    expect(changes).toContainEqual({
      currentVersion: "1.1.0",
      extensionId: "a",
      previousVersion: "1.0.0",
      type: "version-updated",
    });
  });

  it("collapses duplicates by canonical id on repeated syncs", () => {
    const base = mergeCatalogEntries([metadata({ id: "a" })]);
    const once = mergeCatalogEntries([metadata({ id: "b" })], base);
    const twice = mergeCatalogEntries([metadata({ id: "b" })], once);
    expect(twice.map((entry) => entry.id)).toEqual(["a", "b"]);
  });
});

describe("catalog sync (cache-first / SWR / offline)", () => {
  // Far enough in the future that syncedAt=0 is stale (30 min window).
  const now = 86_400_000;

  it("keeps the cache and skips the network while fresh", async () => {
    const cache: CatalogCache = {
      entries: [metadata({ id: "a" })],
      etag: null,
      lastModified: null,
      syncedAt: now,
      version: null,
    };
    const persistence = memoryPersistence(cache);
    let fetches = 0;
    const provider = new AcodeRegistryProvider(async () => {
      fetches += 1;
      throw new Error("should not fetch");
    });
    const result = await syncCatalogCache(persistence, provider, {
      now: now + 1000,
    });
    expect(fetches).toBe(0);
    expect(result.changes).toEqual([]);
    expect(result.state.syncStatus).toBe("idle");
    expect(result.cache.entries).toHaveLength(1);
    expect(persistence.saveCount).toBe(0);
  });

  it("refreshes when stale and reports newly discovered extensions", async () => {
    const cache: CatalogCache = {
      entries: [metadata({ id: "a" })],
      etag: null,
      lastModified: null,
      syncedAt: 0,
      version: null,
    };
    const persistence = memoryPersistence(cache);
    const provider = providerReturning([
      metadata({ id: "a", version: "1.1.0" }),
      metadata({ id: "b" }),
    ]);
    const result = await syncCatalogCache(persistence, provider, { now });
    expect(result.state.syncStatus).toBe("success");
    expect(result.state.lastSuccessfulSync).toBe(now);
    expect(result.cache.entries.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(result.changes.some((change) => change.type === "added")).toBe(true);
    expect(persistence.saveCount).toBe(1);
  });

  it("never erases a valid cache when the registry is offline", async () => {
    const cache: CatalogCache = {
      entries: [metadata({ id: "a" }), metadata({ id: "b" })],
      etag: null,
      lastModified: null,
      syncedAt: 0,
      version: null,
    };
    const persistence = memoryPersistence(cache);
    const provider = new AcodeRegistryProvider(async () => {
      throw new Error("network down");
    });
    const result = await syncCatalogCache(persistence, provider, { now });
    expect(result.state.syncStatus).toBe("offline");
    expect(result.cache.entries.map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  it("reports error state with no cache; the seeded provider still works", async () => {
    const persistence = memoryPersistence(null);
    const failing = new AcodeRegistryProvider(async () => {
      throw new Error("dns failure");
    });
    const result = await syncCatalogCache(persistence, failing, { now });
    expect(result.state.syncStatus).toBe("error");

    // Seeded provider: bundled catalog remains browsable with zero network.
    const seeded = new SeededRegistryProvider(null);
    const seededResult = await syncCatalogCache(memoryPersistence(null), seeded, {
      now,
    });
    expect(seededResult.state.syncStatus).toBe("success");
    expect(seededResult.cache.entries.length).toBeGreaterThanOrEqual(3);
  });
});

describe("update + install state derivation", () => {
  it("marks update available only for newer registry versions", () => {
    const catalog = [
      metadata({ id: "a", version: "1.1.0" }),
      metadata({ id: "b", version: "1.0.0" }),
    ];
    const installed = [
      record({ id: "a", version: "1.0.0" }),
      record({ id: "b", version: "2.0.0" }),
    ];
    expect(findUpdateAvailable(catalog, installed)).toEqual(new Set(["a"]));
    expect(deriveExtensionInstallState(catalog[0], installed)).toBe(
      "update-available",
    );
    expect(deriveExtensionInstallState(catalog[1], installed)).toBe("installed");
  });

  it("reports broken and disabled states", () => {
    const catalog = [metadata({ id: "a" })];
    expect(
      deriveExtensionInstallState(catalog[0], [
        record({ id: "a", runtimeState: "broken" }),
      ]),
    ).toBe("installed-broken");
    expect(
      deriveExtensionInstallState(catalog[0], [
        record({ id: "a", enabled: false }),
      ]),
    ).toBe("installed-disabled");
    expect(deriveExtensionInstallState(catalog[0], [])).toBe("not-installed");
  });

  it("filters catalog entries like the store UI", () => {
    const entries = [
      metadata({ id: "a", name: "Alpha", keywords: ["runner"] }),
      metadata({ id: "b", name: "Beta" }),
    ];
    const installed = [record({ id: "b" })];
    expect(filterCatalogEntries(entries, installed, { query: "alp" })).toHaveLength(
      1,
    );
    expect(filterCatalogEntries(entries, installed, { installedOnly: true })).toEqual([
      entries[1],
    ]);
  });
});

describe("compatibility evaluator", () => {
  const manifest = parsePluginManifest(
    JSON.stringify({
      id: "acode.plugin.sample",
      main: "main.js",
      name: "Sample",
      version: "1.0.0",
    }),
    ["main.js", "plugin.json"],
  );

  it("treats DOM-using entry scripts as supported by the plugin host document", () => {
    const report = evaluateCompatibility(manifest, "window.alert('hi'); document;");
    expect(report.level).toBe("compatible");
    expect(report.reasons.join(" ")).toMatch(/plugin host document/);
    expect(report.reasons.join(" ")).toMatch(/window, document/);
  });

  it("reports partial when the entry script needs a missing Acode core module", () => {
    const report = evaluateCompatibility(
      manifest,
      'const project = acode.require("project"); acode.newEditorFile("x");',
    );
    expect(report.level).toBe("partial");
    expect(report.reasons.join(" ")).toMatch(/does not provide: project/);
    expect(report.reasons.join(" ")).toMatch(/acode.newEditorFile/);
  });

  it("treats the scoped editor module as provided, but not the editor instance", () => {
    const scoped = evaluateCompatibility(
      manifest,
      'const editor = acode.require("editor"); editor.getText();',
    );
    expect(scoped.level).toBe("compatible");
    expect(scoped.reasons.join(" ")).not.toMatch(/does not provide/);

    // The full editor instance is still refused, and is named up front.
    const instance = evaluateCompatibility(
      manifest,
      'const manager = acode.require("editorManager");',
    );
    expect(instance.level).toBe("partial");
    expect(instance.reasons.join(" ")).toMatch(/does not provide: editorManager/);
  });

  it("reports data-only extensions as compatible with nothing to execute", () => {
    const report = evaluateCompatibility(manifest, null);
    expect(report.level).toBe("compatible");
    expect(report.reasons.join(" ")).toMatch(/no entry script/);
  });

  it("reports unsupported when the Acode floor exceeds emulation", () => {
    const strict = parsePluginManifest(
      JSON.stringify({
        id: "acode.plugin.future",
        main: "main.js",
        minVersionCode: AJIRO_ACODE_VERSION_CODE + 1,
        name: "Future",
        version: "1.0.0",
      }),
      ["main.js", "plugin.json"],
    );
    const report = evaluateCompatibility(strict, null);
    expect(report.level).toBe("unsupported");
    expect(report.reasons.join(" ")).toMatch(/version code/);
  });

  it("compares versions numerically", () => {
    expect(compareExtensionVersions("1.10.0", "1.9.0")).toBe(1);
    expect(compareExtensionVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareExtensionVersions("0.9", "1.0.0")).toBe(-1);
  });
});

describe("cache persistence parse", () => {
  it("is tolerant of corrupt or partial cache files", () => {
    expect(parseCatalogCache("not json")).toBeNull();
    expect(parseCatalogCache(JSON.stringify({ entries: "nope" }))).toBeNull();
    const parsed = parseCatalogCache(
      JSON.stringify({
        entries: [
          { id: "a", name: "A", version: "1.0.0" },
          { garbage: true },
        ],
        syncedAt: 5,
      }),
    );
    expect(parsed?.entries).toHaveLength(1);
    expect(parsed?.syncedAt).toBe(5);
  });
});


