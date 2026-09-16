/**
 * Extension store wiring: one place that assembles the platform adapter,
 * catalog persistence, registry provider, package manager, and the Acode
 * compatibility runtime. The store screen, the background sync coordinator,
 * and (later) any other surface share this instance, so there is exactly one
 * catalog cache writer and exactly one `globalThis.acode`.
 */
import { Platform } from "react-native";

import type { CatalogPersistence } from "./catalog";
import { parseCatalogCache, serializeCatalogCache } from "./catalog";
import { createDiagnosticRecorder, type DiagnosticRecorder } from "./diagnostics";
import {
  createPluginRuntimeBridge,
  type PluginRuntimeBridge,
} from "./dom/runtime-bridge";
import {
  createExtensionPreferencesReader,
  type ExtensionPreferences,
} from "./preferences";
import {
  createCatalogSync,
  EMPTY_CATALOG_SNAPSHOT,
  type CatalogSync,
  type CatalogSyncOptions,
  type CatalogSyncSnapshot,
} from "./catalog-sync";
import { createExtensionManager, type ExtensionPackageManager } from "./manager";
import { createExtensionPlatform } from "./platform";
import { AcodeRegistryProvider, SeededRegistryProvider, type FetchLike } from "./registry";
import { installAcodeRuntime, ExtensionRuntime } from "./runtime";
import type { InstallDeps } from "./installer";
import type { ExtensionPathPlan } from "./storage";

export type ExtensionStore = {
  bridge: PluginRuntimeBridge;
  deps: InstallDeps;
  diagnostics: DiagnosticRecorder;
  manager: ExtensionPackageManager;
  paths: ExtensionPathPlan;
  persistence: CatalogPersistence;
  preferences: {
    load(): Promise<ExtensionPreferences>;
    save(patch: Partial<ExtensionPreferences>): Promise<ExtensionPreferences>;
  };
  provider: SeededRegistryProvider;
  runtime: ExtensionRuntime;
};

/** Real network adapter: only ever used for registry metadata and ZIPs. */
const fetchJson: FetchLike = async (url, init) => {
  const response = await fetch(url, {
    headers: init?.headers,
    signal: init?.signal,
  });
  return { json: () => response.json(), ok: response.ok, status: response.status };
};

export function createExtensionStore(): ExtensionStore {
  const { paths, platform } = createExtensionPlatform();
  const deps: InstallDeps = { paths, platform };
  const persistence: CatalogPersistence = {
    load: async () =>
      parseCatalogCache(await platform.readText(paths.catalogCacheFile)),
    save: async (cache) => {
      await platform.writeText(paths.catalogCacheFile, serializeCatalogCache(cache));
    },
  };
  const provider = new SeededRegistryProvider(new AcodeRegistryProvider(fetchJson));
  const runtime = getExtensionRuntime(deps);
  const diagnostics = createDiagnosticRecorder(deps);
  const preferences = createExtensionPreferencesReader(deps);
  return {
    bridge: createPluginRuntimeBridge({
      deps,
      diagnostics,
      // `bindKey` platform maps resolved against the real OS (§45).
      os: Platform.OS,
      runtime,
    }),
    deps,
    diagnostics,
    manager: createExtensionManager({
      // Dependency planning reads the persisted catalog first, so resolving a
      // closure never requires a network round trip (§53).
      catalog: async () => (await persistence.load())?.entries ?? [],
      deps,
      provider,
      runtime,
      // Signature policy comes from the user's preferences, read at install
      // time so a trust change applies to the very next package (§51).
      signaturePolicy: async () => {
        const current = await preferences.load();
        return {
          requireSigned: current.requireSignedPackages,
          trustedKeys: current.trustedSigningKeys,
        };
      },
    }),
    paths,
    persistence,
    preferences,
    provider,
    runtime,
  };
}

/**
 * The `globalThis.acode` runtime is process-wide (a plugin may call
 * `acode.require` from anywhere), so exactly one instance is created and
 * later callers reuse it even if they carry a different path plan.
 */
let runtimeInstance: ExtensionRuntime | null = null;

export function getExtensionRuntime(deps?: InstallDeps): ExtensionRuntime {
  if (!runtimeInstance) {
    runtimeInstance = installAcodeRuntime(new ExtensionRuntime(deps ?? null));
  }
  return runtimeInstance;
}

let storeInstance: ExtensionStore | null = null;

export function getExtensionStore(): ExtensionStore {
  if (!storeInstance) storeInstance = createExtensionStore();
  return storeInstance;
}

/** Test seam: swap the process-wide store (used by unit tests only). */
export function setExtensionStore(store: ExtensionStore | null): void {
  storeInstance = store;
  catalogSync = null;
}

/**
 * The plugin DOM bridge (plugin host document + Acode runtime). Null until a
 * plugin host surface has been mounted somewhere in the app, so plugin code
 * can only run while a document exists.
 */
export function getPluginRuntimeBridge(): PluginRuntimeBridge {
  return getExtensionStore().bridge;
}

/**
 * Process-wide catalog sync coordinator (§19): startup, foreground, and
 * Store-open synchronization all funnel through this one instance, so only
 * one writer ever touches the catalog cache. Built lazily so importing the
 * store never performs I/O.
 */
let catalogSync: CatalogSync | null = null;

export function getCatalogSync(): CatalogSync {
  if (!catalogSync) {
    const store = getExtensionStore();
    catalogSync = createCatalogSync({
      persistence: store.persistence,
      provider: store.provider,
    });
  }
  return catalogSync;
}

export function subscribeCatalog(
  listener: (snapshot: CatalogSyncSnapshot) => void,
): () => void {
  return getCatalogSync().subscribe(listener);
}

export function getCatalogSnapshot(): CatalogSyncSnapshot {
  return catalogSync?.getSnapshot() ?? EMPTY_CATALOG_SNAPSHOT;
}

export function syncCatalogInBackground(
  options?: CatalogSyncOptions,
): Promise<CatalogSyncSnapshot> {
  return getCatalogSync().sync(options);
}

export function acknowledgeNewExtensions(): void {
  getCatalogSync().acknowledgeNewExtensions();
}
