/**
 * Extension catalog: persisted cache + registry synchronization
 * (prompt §18-§26). Cache-first with stale-while-revalidate: the store
 * always renders from the last good cache, a background sync diffs the
 * fresh registry data against it, and persistence only ever replaces the
 * cache with a validated, deduplicated catalog.
 *
 * Failure handling (§25): a failed sync never erases the cache; it only
 * flips the sync state so the UI can show an offline/stale indicator.
 */
import { compareExtensionVersions } from "./compatibility";
import {
  channelVisible,
  rolloutAllows,
  type UpdateChannel,
} from "@/modules/updates/extension-framework";
import {
  isRecord,
  type ExtensionCatalogChange,
  type ExtensionInstallState,
  type ExtensionMetadata,
  type InstalledExtensionRecord,
  type RegistryFetchOptions,
  type RegistrySyncState,
} from "./models";
import type { RegistryProvider } from "./registry";

export type CatalogCache = {
  entries: ExtensionMetadata[];
  etag: string | null;
  lastModified: string | null;
  syncedAt: number | null;
  version: string | null;
};

export interface CatalogPersistence {
  load(): Promise<CatalogCache | null>;
  save(cache: CatalogCache): Promise<void>;
}

export type CatalogSyncResult = {
  cache: CatalogCache;
  changes: ExtensionCatalogChange[];
  state: RegistrySyncState;
};

export const DEFAULT_STALE_AFTER_MS = 30 * 60 * 1000;

/** Canonical plugin id is the identity key; duplicates collapse (§80). */
export function mergeCatalogEntries(
  incoming: ExtensionMetadata[],
  previous: ExtensionMetadata[] = [],
): ExtensionMetadata[] {
  const byId = new Map<string, ExtensionMetadata>();
  for (const entry of previous) byId.set(entry.id, entry);
  for (const entry of incoming) byId.set(entry.id, entry);
  return [...byId.values()].sort((left, right) => left.name.localeCompare(right.name));
}

/** Diff engine (§22): added / updated / removed / version-updated. */
export function computeCatalogChanges(
  previous: ExtensionMetadata[],
  next: ExtensionMetadata[],
): ExtensionCatalogChange[] {
  const previousById = new Map(previous.map((entry) => [entry.id, entry]));
  const nextById = new Map(next.map((entry) => [entry.id, entry]));
  const changes: ExtensionCatalogChange[] = [];

  for (const entry of next) {
    const before = previousById.get(entry.id);
    if (!before) {
      changes.push({ extension: entry, type: "added" });
      continue;
    }
    if (before.version !== entry.version) {
      changes.push({
        currentVersion: entry.version,
        extensionId: entry.id,
        previousVersion: before.version,
        type: "version-updated",
      });
    }
    if (JSON.stringify(before) !== JSON.stringify(entry)) {
      changes.push({ current: entry, previous: before, type: "updated" });
    }
  }
  for (const entry of previous) {
    if (!nextById.has(entry.id)) {
      changes.push({ extensionId: entry.id, type: "removed" });
    }
  }
  return changes;
}

export function isCacheStale(
  cache: CatalogCache,
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
  now = Date.now(),
): boolean {
  if (cache.syncedAt === null) return true;
  return now - cache.syncedAt > staleAfterMs;
}

function syncStateFromCache(
  cache: CatalogCache | null,
  attemptedAt: number | null,
  status: RegistrySyncState["syncStatus"],
  error: string | null = null,
): RegistrySyncState {
  return {
    catalogVersion: cache?.version ?? null,
    etag: cache?.etag ?? null,
    itemCount: cache?.entries.length ?? 0,
    lastAttemptedSync: attemptedAt,
    lastModified: cache?.lastModified ?? null,
    lastSuccessfulSync: cache?.syncedAt ?? null,
    lastSyncError: error,
    syncStatus: status,
  };
}

export type SyncCatalogOptions = {
  force?: boolean;
  now?: number;
  staleAfterMs?: number;
};

/**
 * Stale-while-revalidate sync. Never throws: registry failures degrade to
 * an offline/error state with the previous cache intact (§25).
 */
export async function syncCatalogCache(
  persistence: CatalogPersistence,
  provider: RegistryProvider,
  options: SyncCatalogOptions & Pick<RegistryFetchOptions, "signal"> = {},
): Promise<CatalogSyncResult> {
  const now = options.now ?? Date.now();
  const cache = await persistence.load();
  const attemptedAt = now;

  if (!options.force && cache && !isCacheStale(cache, options.staleAfterMs, now)) {
    return {
      cache,
      changes: [],
      state: syncStateFromCache(cache, cache.syncedAt, "idle"),
    };
  }

  try {
    const fresh = await provider.fetchCatalog({
      etag: cache?.etag ?? null,
      lastModified: cache?.lastModified ?? null,
      signal: options.signal,
    });
    const entries = mergeCatalogEntries(fresh.entries, cache?.entries ?? []);
    const changes = computeCatalogChanges(cache?.entries ?? [], entries);
    const nextCache: CatalogCache = {
      entries,
      etag: cache?.etag ?? null,
      lastModified: cache?.lastModified ?? null,
      syncedAt: now,
      version: fresh.version,
    };
    await persistence.save(nextCache);
    return {
      cache: nextCache,
      changes,
      state: syncStateFromCache(nextCache, now, "success"),
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Registry synchronization failed.";
    const offlineCache: CatalogCache =
      cache ?? { entries: [], etag: null, lastModified: null, syncedAt: null, version: null };
    return {
      cache: offlineCache,
      changes: [],
      state: syncStateFromCache(
        offlineCache,
        attemptedAt,
        cache ? "offline" : "error",
        message,
      ),
    };
  }
}

/** Store-level install state for one catalog entry (§28 Installed view). */
export function deriveExtensionInstallState(
  metadata: ExtensionMetadata,
  installed: InstalledExtensionRecord[],
): ExtensionInstallState {
  // Revocation wins over everything (§24): a revoked extension is never
  // offered, updated, or shown as healthy, installed or not.
  if (metadata.revoked) return "revoked";
  const record = installed.find((entry) => entry.id === metadata.id);
  if (!record) return "not-installed";
  if (record.runtimeState === "broken") return "installed-broken";
  if (!record.enabled) return "installed-disabled";
  if (compareExtensionVersions(metadata.version, record.version) > 0) {
    return "update-available";
  }
  return "installed";
}

/**
 * All extensions with an update available, keyed by id (§26). Revoked
 * entries never surface, and channel/rollout gating applies: an update on
 * a channel the user did not opt into is not offered.
 */
export function findUpdateAvailable(
  catalog: ExtensionMetadata[],
  installed: InstalledExtensionRecord[],
  channel: UpdateChannel = "stable",
): Set<string> {
  const updates = new Set<string>();
  for (const metadata of catalog) {
    if (metadata.revoked) continue;
    if (!channelVisible(metadata.channel, channel)) continue;
    if (!rolloutAllows(metadata.rolloutPercent, `plugin:${metadata.id}`)) continue;
    const record = installed.find((entry) => entry.id === metadata.id);
    if (!record) continue;
    if (compareExtensionVersions(metadata.version, record.version) > 0) {
      updates.add(metadata.id);
    }
  }
  return updates;
}

/** Installed extensions whose catalog entry was revoked (§24): disable these. */
export function findRevokedInstalled(
  catalog: ExtensionMetadata[],
  installed: InstalledExtensionRecord[],
): string[] {
  const revoked = new Set(
    catalog.filter((entry) => entry.revoked).map((entry) => entry.id),
  );
  return installed.filter((record) => revoked.has(record.id)).map((record) => record.id);
}

/**
 * Per-plugin update probe behind catalog comparison, using Acode's
 * `plugin/check-update/<id>/<version>` endpoint (§19). When the synced
 * catalog has no newer entry — stale page, plugin missing from the listing —
 * the server can still report a newer version, and that hint is actionable:
 * updating re-downloads the latest package from the registry directly.
 * Providers without `checkUpdate` (offline seed) yield no hints, and a
 * per-plugin failure resolves to "no hint" rather than failing the batch.
 */
export async function checkServerUpdates(
  provider: Pick<RegistryProvider, "checkUpdate">,
  installed: InstalledExtensionRecord[],
): Promise<Map<string, string>> {
  const hints = new Map<string, string>();
  if (typeof provider.checkUpdate !== "function") return hints;
  const checkUpdate = provider.checkUpdate.bind(provider);
  await Promise.all(
    installed.map(async (record) => {
      try {
        const answer = await checkUpdate(record.id, record.version);
        if (
          answer?.update &&
          typeof answer.version === "string" &&
          compareExtensionVersions(answer.version, record.version) > 0
        ) {
          hints.set(record.id, answer.version);
        }
      } catch {
        // Offline or unknown plugin: catalog comparison stays the source.
      }
    }),
  );
  return hints;
}

/** Categories derive from explicit categories, falling back to keywords. */
export function listCategories(entries: ExtensionMetadata[]): string[] {
  const categories = new Set<string>();
  for (const entry of entries) {
    if (entry.category) categories.add(entry.category);
  }
  return [...categories].sort();
}

/**
 * Everything one catalog entry can be found by, normalized once (§66).
 * Icon/readme/download text is deliberately excluded: it is documentation, not
 * identity, and indexing it buries real matches under prose.
 */
export function catalogHaystack(entry: ExtensionMetadata): string {
  return [
    entry.description ?? "",
    entry.id,
    entry.keywords.join(" "),
    entry.name,
    entry.author?.name ?? "",
    entry.author?.github ?? "",
    entry.category ?? "",
  ]
    .join(" ")
    .toLowerCase();
}

/**
 * Inverted trigram index over the catalog (§66). Substring semantics are kept
 * exactly (`includes`), but a query first narrows to entries sharing its
 * trigrams, so typing in the search box no longer scans every description of
 * every extension. Built once per catalog revision, not per keystroke.
 */
export type CatalogSearchIndex = {
  entries: ExtensionMetadata[];
  /** trigram → positions in `entries`. */
  grams: Map<string, number[]>;
  haystacks: string[];
};

export const SEARCH_GRAM_SIZE = 3;

function gramKeys(text: string): string[] {
  const keys: string[] = [];
  for (let index = 0; index + SEARCH_GRAM_SIZE <= text.length; index += 1) {
    keys.push(text.slice(index, index + SEARCH_GRAM_SIZE));
  }
  return keys;
}

export function buildCatalogSearchIndex(
  entries: ExtensionMetadata[],
): CatalogSearchIndex {
  const grams = new Map<string, number[]>();
  const haystacks: string[] = [];
  entries.forEach((entry, position) => {
    const haystack = catalogHaystack(entry);
    haystacks.push(haystack);
    for (const key of new Set(gramKeys(haystack))) {
      const bucket = grams.get(key);
      if (bucket) bucket.push(position);
      else grams.set(key, [position]);
    }
  });
  return { entries, grams, haystacks };
}

/** Entries whose indexed text contains `query`, in index order. */
export function searchCatalogIndex(
  index: CatalogSearchIndex,
  query: string,
): ExtensionMetadata[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return index.entries;
  // Short needles have no usable trigram: verifying a handful of candidates
  // is still cheaper than filtering, and never wrong.
  const candidates =
    needle.length < SEARCH_GRAM_SIZE
      ? index.haystacks.map((_, position) => position)
      : intersectGramCandidates(index, needle);
  const matched: ExtensionMetadata[] = [];
  for (const position of candidates) {
    if (index.haystacks[position].includes(needle)) {
      matched.push(index.entries[position]);
    }
  }
  return matched;
}

function intersectGramCandidates(
  index: CatalogSearchIndex,
  needle: string,
): number[] {
  let shortest: number[] | null = null;
  for (const key of new Set(gramKeys(needle))) {
    const bucket = index.grams.get(key);
    if (!bucket) return [];
    if (!shortest || bucket.length < shortest.length) shortest = bucket;
  }
  if (!shortest) return [];
  const sets = new Set(shortest);
  for (const key of new Set(gramKeys(needle))) {
    const bucket = index.grams.get(key) ?? [];
    const present = new Set(bucket);
    for (const position of [...sets]) {
      if (!present.has(position)) sets.delete(position);
    }
    if (sets.size === 0) break;
  }
  // `shortest` is ascending by construction, so candidates stay in catalog
  // order and the ranking downstream is stable.
  return shortest.filter((position) => sets.has(position));
}

export type CatalogFilter = {
  category?: string | null;
  /** Update channel (§44): entries above the user's channel are hidden. */
  channel?: UpdateChannel;
  installedOnly?: boolean;
  query?: string | null;
  /** Prebuilt index; pass it to avoid re-indexing on every keystroke. */
  searchIndex?: CatalogSearchIndex | null;
  /** Per-installed-state narrowing (§28). */
  state?: CatalogStateFilter | null;
  updateOnly?: boolean;
};

/** Explore/search filtering over the cached catalog (§28/§29/§66). */
export function filterCatalogEntries(
  entries: ExtensionMetadata[],
  installed: InstalledExtensionRecord[],
  filter: CatalogFilter,
): ExtensionMetadata[] {
  const needle = filter.query?.trim().toLowerCase() ?? "";
  const searched =
    needle === ""
      ? entries
      : filter.searchIndex && filter.searchIndex.entries === entries
        ? searchCatalogIndex(filter.searchIndex, needle)
        : searchCatalogIndex(buildCatalogSearchIndex(entries), needle);
  return searched.filter((entry) => {
    if (filter.category && entry.category !== filter.category) return false;
    if (filter.channel && !channelVisible(entry.channel, filter.channel)) {
      return false;
    }
    // Rollout gates discovery, never management: an installed extension
    // stays visible (and updatable only through findUpdateAvailable, which
    // applies the same gate) so the user can always remove what they have.
    if (
      !installed.some((item) => item.id === entry.id) &&
      !rolloutAllows(entry.rolloutPercent, `plugin:${entry.id}`)
    ) {
      return false;
    }
    if (filter.updateOnly || filter.installedOnly || filter.state) {
      const record = installed.find((item) => item.id === entry.id);
      if (filter.updateOnly || filter.installedOnly) {
        if (!record) return false;
      }
      if (
        filter.updateOnly &&
        (!record || compareExtensionVersions(entry.version, record.version) <= 0)
      ) {
        return false;
      }
      if (filter.state && filter.state !== "all") {
        const state = deriveExtensionInstallState(entry, installed);
        if (!stateMatchesFilter(state, filter.state)) return false;
      }
    }
    return true;
  });
}

/** Installed-state filters for the Store's Installed view (§28). */
export type CatalogStateFilter =
  | "all"
  | "enabled"
  | "disabled"
  | "broken"
  | "revoked"
  | "update-available";

export const CATALOG_STATE_FILTERS: readonly CatalogStateFilter[] = [
  "all",
  "enabled",
  "disabled",
  "broken",
  "revoked",
  "update-available",
];

function stateMatchesFilter(
  state: ExtensionInstallState,
  filter: CatalogStateFilter,
): boolean {
  switch (filter) {
    case "all":
      return true;
    case "enabled":
      return state === "installed" || state === "update-available";
    case "disabled":
      return state === "installed-disabled";
    case "broken":
      return state === "installed-broken";
    case "revoked":
      return state === "revoked";
    case "update-available":
      return state === "update-available";
    default:
      return true;
  }
}

/**
 * Featured shelf (§28). The Acode registry publishes no `featured` flag, so
 * the shelf is derived deterministically: rich metadata (keywords + category +
 * readme) first, then newest declared update. It is a *presentation* order
 * only — no extension is hidden or promoted in search results.
 */
export function listFeaturedExtensions(
  entries: ExtensionMetadata[],
  limit = 6,
): ExtensionMetadata[] {
  const score = (entry: ExtensionMetadata): number => {
    let value = entry.keywords.length + (entry.category ? 2 : 0);
    if (entry.readme) value += 1;
    if (entry.icon) value += 1;
    if (entry.download) value += 1;
    return value;
  };
  const timestamp = (entry: ExtensionMetadata): number => {
    const parsed = entry.updatedAt ? Date.parse(entry.updatedAt) : Number.NaN;
    return Number.isNaN(parsed) ? 0 : parsed;
  };
  return [...entries]
    .sort((left, right) => {
      const byScore = score(right) - score(left);
      if (byScore !== 0) return byScore;
      const byTime = timestamp(right) - timestamp(left);
      if (byTime !== 0) return byTime;
      return left.name.localeCompare(right.name);
    })
    .slice(0, Math.max(0, limit));
}

/** Read/write the catalog cache from a raw JSON file store. */
export function parseCatalogCache(raw: string | null): CatalogCache | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !Array.isArray(parsed.entries)) return null;
    const entries = parsed.entries
      .map((entry) => entry)
      .filter(
        (entry): entry is ExtensionMetadata =>
          isRecord(entry) &&
          typeof entry.id === "string" &&
          typeof entry.name === "string" &&
          typeof entry.version === "string",
      );
    return {
      entries,
      etag: typeof parsed.etag === "string" ? parsed.etag : null,
      lastModified: typeof parsed.lastModified === "string" ? parsed.lastModified : null,
      syncedAt: typeof parsed.syncedAt === "number" ? parsed.syncedAt : null,
      version: typeof parsed.version === "string" ? parsed.version : null,
    };
  } catch {
    return null;
  }
}

export function serializeCatalogCache(cache: CatalogCache): string {
  return JSON.stringify(cache);
}

