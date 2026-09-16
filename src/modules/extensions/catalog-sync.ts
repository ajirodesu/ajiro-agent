/**
 * Catalog synchronization coordinator (prompt §18-§21, §63).
 *
 * Catalog sync is not a screen concern: it runs at application startup, when
 * the app returns to the foreground, when the Store opens, and on manual
 * refresh. This module owns that policy so every caller shares one
 * single-flight sync — two concurrent syncs would otherwise race on the same
 * catalog cache file — and so the "new extensions discovered" indicator can
 * be observed by chrome that is not the Store (the sidebar badge).
 *
 * Requests are stale-checked by `syncCatalogCache`, so foregrounding a warm
 * app performs no network call. A failed sync never clears the cache (§25);
 * it only reports an offline/error status.
 */
import { syncCatalogCache, type CatalogPersistence } from "./catalog";
import type { ExtensionMetadata, RegistrySyncState } from "./models";
import type { RegistryProvider } from "./registry";

export type CatalogSyncSnapshot = {
  entries: ExtensionMetadata[];
  /** Extensions discovered since the indicator was last acknowledged. */
  newCount: number;
  lastSuccessfulSync: number | null;
  status: RegistrySyncState["syncStatus"];
};

export type CatalogSyncOptions = {
  force?: boolean;
};

export type CatalogSync = {
  acknowledgeNewExtensions(): void;
  getSnapshot(): CatalogSyncSnapshot;
  subscribe(listener: (snapshot: CatalogSyncSnapshot) => void): () => void;
  sync(options?: CatalogSyncOptions): Promise<CatalogSyncSnapshot>;
};

export type CatalogSyncSource = {
  persistence: CatalogPersistence;
  provider: RegistryProvider;
};

export const EMPTY_CATALOG_SNAPSHOT: CatalogSyncSnapshot = {
  entries: [],
  newCount: 0,
  lastSuccessfulSync: null,
  status: "idle",
};

export function createCatalogSync({ persistence, provider }: CatalogSyncSource): CatalogSync {
  let snapshot: CatalogSyncSnapshot = EMPTY_CATALOG_SNAPSHOT;
  let inFlight: Promise<CatalogSyncSnapshot> | null = null;
  const listeners = new Set<(snapshot: CatalogSyncSnapshot) => void>();

  function publish(next: CatalogSyncSnapshot): void {
    snapshot = next;
    for (const listener of listeners) {
      try {
        listener(snapshot);
      } catch {
        // A broken subscriber (e.g. an unmounted screen) must not stop the
        // other subscribers or the sync itself.
      }
    }
  }

  const sync: CatalogSync["sync"] = async (options = {}) => {
    // Single-flight: a startup sync and a Store-open sync must not race.
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        const result = await syncCatalogCache(persistence, provider, {
          force: options.force ?? false,
        });
        const added = result.changes.filter((change) => change.type === "added").length;
        publish({
          entries: result.cache.entries,
          newCount: snapshot.newCount + added,
          lastSuccessfulSync: result.state.lastSuccessfulSync,
          status: result.state.syncStatus,
        });
        return snapshot;
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  };

  return {
    acknowledgeNewExtensions() {
      if (snapshot.newCount === 0) return;
      publish({ ...snapshot, newCount: 0 });
    },

    getSnapshot: () => snapshot,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    sync,
  };
}

// The process-wide coordinator that binds this to the app's real filesystem
// and registry lives in `store.ts`, so this module stays free of React Native
// imports and unit-testable on plain node.
