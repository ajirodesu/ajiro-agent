import { describe, expect, it } from "vitest";

import {
  createCatalogSync,
  type CatalogSyncSnapshot,
} from "../catalog-sync";
import type { CatalogCache, CatalogPersistence } from "../catalog";
import type { ExtensionMetadata } from "../models";
import { AcodeRegistryProvider } from "../registry";

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

function persistence(cache: CatalogCache | null): CatalogPersistence {
  const state = { stored: cache };
  return {
    async load() {
      return state.stored;
    },
    async save(next) {
      state.stored = next;
    },
  };
}

function providerReturning(entries: ExtensionMetadata[]) {
  let fetches = 0;
  const provider = new AcodeRegistryProvider(async () => {
    fetches += 1;
    return {
      json: async () => ({ plugins: entries.map((entry) => ({ ...entry })) }),
      ok: true,
      status: 200,
    };
  });
  return { fetches: () => fetches, provider };
}

const STALE: CatalogCache = {
  entries: [metadata({ id: "a" })],
  etag: null,
  lastModified: null,
  // Long expired, so the cached catalog does not suppress the sync.
  syncedAt: 0,
  version: null,
};

describe("background catalog sync", () => {
  it("counts newly discovered extensions and publishes them", async () => {
    const { provider } = providerReturning([
      metadata({ id: "a" }),
      metadata({ id: "b" }),
      metadata({ id: "c" }),
    ]);
    const sync = createCatalogSync({ persistence: persistence(STALE), provider });
    const seen: CatalogSyncSnapshot[] = [];
    sync.subscribe((snapshot) => seen.push(snapshot));

    const snapshot = await sync.sync();

    expect(snapshot.status).toBe("success");
    expect(snapshot.entries.map((entry) => entry.id)).toEqual(["a", "b", "c"]);
    // "b" and "c" are new; "a" was already cached.
    expect(snapshot.newCount).toBe(2);
    expect(seen.at(-1)?.newCount).toBe(2);
  });

  it("clears the discovery indicator when acknowledged without touching the catalog", async () => {
    const { provider } = providerReturning([
      metadata({ id: "a" }),
      metadata({ id: "b" }),
    ]);
    const sync = createCatalogSync({ persistence: persistence(STALE), provider });
    await sync.sync();

    sync.acknowledgeNewExtensions();
    expect(sync.getSnapshot().newCount).toBe(0);
    expect(sync.getSnapshot().entries).toHaveLength(2);
  });

  it("does not double count when the same catalog is synchronized repeatedly", async () => {
    const { provider } = providerReturning([metadata({ id: "a" })]);
    const sync = createCatalogSync({ persistence: persistence(STALE), provider });
    await sync.sync();
    expect(sync.getSnapshot().newCount).toBe(0);

    await sync.sync({ force: true });
    await sync.sync({ force: true });
    // "a" was already known, so nothing new is ever counted again (§80).
    expect(sync.getSnapshot().newCount).toBe(0);
    expect(sync.getSnapshot().entries.map((entry) => entry.id)).toEqual(["a"]);
  });

  it("skips the network while the cache is fresh", async () => {
    const fresh: CatalogCache = { ...STALE, syncedAt: Date.now() };
    const { fetches, provider } = providerReturning([metadata({ id: "b" })]);
    const sync = createCatalogSync({ persistence: persistence(fresh), provider });

    const snapshot = await sync.sync();

    expect(fetches()).toBe(0);
    expect(snapshot.status).toBe("idle");
    expect(snapshot.entries.map((entry) => entry.id)).toEqual(["a"]);
  });

  it("shares one request between concurrent callers", async () => {
    const { fetches, provider } = providerReturning([metadata({ id: "a" })]);
    const sync = createCatalogSync({ persistence: persistence(STALE), provider });

    await Promise.all([sync.sync(), sync.sync(), sync.sync()]);

    expect(fetches()).toBe(1);
  });

  it("keeps the cached catalog and reports offline when the registry fails", async () => {
    const provider = new AcodeRegistryProvider(async () => {
      throw new Error("network down");
    });
    const sync = createCatalogSync({ persistence: persistence(STALE), provider });

    const snapshot = await sync.sync();

    expect(snapshot.status).toBe("offline");
    expect(snapshot.entries.map((entry) => entry.id)).toEqual(["a"]);
    expect(snapshot.newCount).toBe(0);
  });

  it("ignores a subscriber that throws so other subscribers still run", async () => {
    const { provider } = providerReturning([metadata({ id: "a" })]);
    const sync = createCatalogSync({ persistence: persistence(STALE), provider });
    let reached = 0;
    sync.subscribe(() => {
      throw new Error("unmounted screen");
    });
    sync.subscribe(() => {
      reached += 1;
    });

    await sync.sync();

    expect(reached).toBe(1);
  });
});
