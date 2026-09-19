/**
 * Registry provider abstraction (prompt §23) + the Acode-compatible
 * provider. The UI never touches registry response shapes — everything is
 * normalized into ExtensionMetadata here.
 *
 * Acode registry endpoints (verified live 2026-09-19): the legacy
 * `plugin/all` listing path 404s, so listing uses `plugin?page=&limit=`
 * (bare array pages); `plugin/<id>` detail and `plugin/download/<id>`
 * keep working. [OPEN-SOURCE, MIT]. The provider is tolerant: it accepts
 * both bare arrays and enveloped `{plugins|data|items: [...]}` responses,
 * and maps snake_case/camelCase metadata spellings.
 *
 * When the registry is unreachable the bundled seed catalog keeps the
 * store usable offline (prompt §25/§58) — never erasing a valid cache.
 */
import bundledSeed from "../../../catalog/extensions.json";
import { authorLabel } from "./manifest";
import {
  isRecord,
  type ExtensionCatalog,
  type ExtensionDownload,
  type ExtensionMetadata,
  type ExtensionSummary,
  type ExtensionVersion,
  type RegistryFetchOptions,
  type SearchOptions,
} from "./models";

export const ACODE_REGISTRY_BASE = "https://acode.app/api";
export const REGISTRY_PAGE_LIMIT = 50;
/** Hard stop so a misbehaving registry can never loop forever. */
const MAX_REGISTRY_PAGES = 20;

export type RegistryProvider = {
  readonly id: string;
  fetchCatalog(options?: RegistryFetchOptions): Promise<ExtensionCatalog>;
  getExtension(id: string): Promise<ExtensionMetadata>;
  getLatestVersion(id: string): Promise<ExtensionVersion | null>;
  getVersions(id: string): Promise<ExtensionVersion[]>;
  resolveDownload(id: string, version?: string): Promise<ExtensionDownload>;
  search(query: string, options?: SearchOptions): Promise<ExtensionSummary[]>;
  /**
   * Acode's per-plugin update check (`plugin/check-update/<id>/<version>`).
   * Optional: providers that cannot reach the endpoint omit it, and callers
   * fall back to comparing catalog versions, which stays offline-safe.
   * Returns null when the endpoint is unavailable or fails.
   */
  checkUpdate?(id: string, version: string): Promise<{ update: boolean; version: string | null } | null>;
};

function firstString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function normalizeAuthor(value: unknown): ExtensionMetadata["author"] {
  if (typeof value === "string" && value.trim()) {
    return { email: null, github: null, name: value.trim(), url: null };
  }
  if (!isRecord(value)) return null;
  const name = firstString(value, ["name", "author", "username"]) ?? "";
  if (!name) return null;
  return {
    email: firstString(value, ["email"]),
    github: firstString(value, ["github"]),
    name,
    url: firstString(value, ["url", "website"]),
  };
}

/**
 * The live registry serializes some arrays as JSON strings (verified
 * firsthand against `plugin/acode.plugin.python`: `keywords` arrives as
 * `"[\"python\"]"`). Accept real arrays, JSON-encoded arrays, and — as a
 * last resort — a single bare value.
 */
export function parseRegistryStringList(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  if (typeof value !== "string") return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed.filter((entry): entry is string => typeof entry === "string");
    }
    if (typeof parsed === "string" && parsed.trim()) return [parsed.trim()];
  } catch {
    // Not JSON — fall through to the bare-value branch below.
  }
  return [trimmed];
}

function normalizeDownload(
  record: Record<string, unknown>,
  id: string,
): ExtensionDownload {
  const nested = record.download;
  if (isRecord(nested)) {
    const url = firstString(nested, ["url", "downloadUrl"]);
    if (url && /^https:\/\//i.test(url)) return { kind: "url", url };
    const pluginId = firstString(nested, ["pluginId", "id"]);
    if (pluginId) return { kind: "registry", pluginId };
  }
  const url = firstString(record, [
    "downloadUrl",
    "download_url",
    "zipUrl",
    "zip_url",
    "packageUrl",
  ]);
  if (url && /^https:\/\//i.test(url)) return { kind: "url", url };
  return { kind: "registry", pluginId: id };
}


/** Registry entry (or plugin.json-shaped record) → ExtensionMetadata. */
export function normalizeRegistryEntry(value: unknown): ExtensionMetadata | null {
  if (!isRecord(value)) return null;
  const id = firstString(value, ["id", "pluginId", "plugin_id"]);
  const name = firstString(value, ["name", "title"]);
  const version = firstString(value, ["version", "latestVersion", "latest_version"]);
  if (!id || !name || !version) return null;
  const keywords = parseRegistryStringList(value.keywords).slice(0, 32);
  let author = normalizeAuthor(value.author);
  // The live registry also carries flat author fields alongside (or instead
  // of parts of) the author value — merge them rather than dropping data.
  if (!author) {
    const flatName = firstString(value, ["username", "user", "developer"]);
    if (flatName) {
      author = { email: null, github: null, name: flatName, url: null };
    }
  }
  if (author) {
    author.email ??= firstString(value, ["author_email", "authorEmail"]);
    author.github ??= firstString(value, ["author_github", "authorGithub"]);
    author.url ??= firstString(value, ["author_url", "authorUrl", "website"]);
  }
  const dependencies = Array.isArray(value.dependencies)
    ? value.dependencies
        .map((entry) =>
          typeof entry === "string"
            ? { id: entry, version: null }
            : isRecord(entry) && typeof entry.id === "string"
              ? {
                  id: entry.id,
                  version: typeof entry.version === "string" ? entry.version : null,
                }
              : null,
        )
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    : [];
  const channel = firstString(value, ["channel"]);
  const rolloutPercent =
    typeof value.rolloutPercent === "number" &&
    Number.isFinite(value.rolloutPercent) &&
    value.rolloutPercent >= 0 &&
    value.rolloutPercent <= 100
      ? value.rolloutPercent
      : null;
  return {
    author,
    category: firstString(value, ["category", "type"]),
    changelog: firstString(value, ["changelog", "changelogs"]),
    channel:
      channel === "stable" || channel === "beta" || channel === "preview"
        ? channel
        : null,
    dependencies,
    deprecated: value.deprecated === true,
    description:
      firstString(value, ["description", "summary", "shortDescription", "short_description"]),
    download: normalizeDownload(value, id),
    icon: firstString(value, ["icon", "iconUrl", "icon_url"]),
    id,
    keywords,
    license: firstString(value, ["license"]),
    minVersionCode:
      typeof value.minVersionCode === "number"
        ? value.minVersionCode
        : typeof value.min_version_code === "number"
          ? (value.min_version_code as number)
          : null,
    minVersionName: firstString(value, ["minVersionName", "min_version_name"]),
    name,
    // The registry sends paid prices as numeric strings ("1.00"): accept
    // those too, or paid plugins normalize to free and leak into stores.
    price:
      typeof value.price === "number"
        ? value.price
        : typeof value.price === "string" && value.price.trim() !== "" &&
            Number.isFinite(Number(value.price))
          ? Number(value.price)
          : 0,
    readme: firstString(value, ["readme", "readmeUrl", "readme_url"]),
    repository: firstString(value, ["repository", "repo", "sourceUrl", "source_url"]),
    revoked: value.revoked === true,
    rolloutPercent,
    source: "registry",
    updatedAt: firstString(value, ["updatedAt", "updated_at", "lastUpdated"]),
    version,
  };
}

function extractEntryList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (isRecord(value)) {
    for (const key of ["plugins", "data", "items", "results", "extensions"]) {
      if (Array.isArray(value[key])) return value[key] as unknown[];
    }
  }
  return [];
}

/** Best-effort catalog search over normalized metadata (prompt §29). */
export function searchCatalogMetadata(
  entries: ExtensionMetadata[],
  query: string,
): ExtensionMetadata[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return entries;
  return entries.filter((entry) =>
    [
      authorLabel(entry.author),
      entry.description ?? "",
      entry.id,
      entry.keywords.join(" "),
      entry.name,
    ]
      .join(" ")
      .toLowerCase()
      .includes(needle),
  );
}

export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{
  json: () => Promise<unknown>;
  ok: boolean;
  status: number;
}>;

/**
 * Acode-compatible registry provider. All requests go through `fetchJson`
 * (injectable for tests); failures surface as thrown errors so the sync
 * engine can mark the registry offline without touching the cache.
 */
export class AcodeRegistryProvider implements RegistryProvider {
  readonly id = "acode";

  constructor(
    private readonly fetchJson: FetchLike,
    private readonly baseUrl: string = ACODE_REGISTRY_BASE,
  ) {}

  private url(path: string): string {
    return `${this.baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
  }

  async fetchCatalog(options?: RegistryFetchOptions): Promise<ExtensionCatalog> {
    const limit = options?.limit ?? REGISTRY_PAGE_LIMIT;
    const entries: ExtensionMetadata[] = [];
    const seen = new Set<string>();
    for (let page = 1; page <= MAX_REGISTRY_PAGES; page += 1) {
      const response = await this.fetchJson(
        this.url(`plugin?page=${page}&limit=${limit}`),
        {
          headers: {
            Accept: "application/json",
            ...(options?.etag ? { "If-None-Match": options.etag } : {}),
            ...(options?.lastModified
              ? { "If-Modified-Since": options.lastModified }
              : {}),
          },
          signal: options?.signal,
        },
      );
      if (response.status === 304) break;
      if (!response.ok) {
        throw new Error(`Registry request failed (${response.status}).`);
      }
      const batch = extractEntryList(await response.json())
        .map(normalizeRegistryEntry)
        .filter((entry): entry is ExtensionMetadata => entry !== null);
      for (const entry of batch) {
        if (seen.has(entry.id)) continue;
        seen.add(entry.id);
        entries.push(entry);
      }
      if (batch.length < limit) break;
    }
    return { entries, version: null };
  }

  async getExtension(id: string): Promise<ExtensionMetadata> {
    const response = await this.fetchJson(this.url(`plugin/${encodeURIComponent(id)}`), {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`Registry request failed (${response.status}).`);
    }
    const parsed = normalizeRegistryEntry(await response.json());
    if (!parsed) throw new Error(`Registry entry "${id}" is malformed.`);
    return parsed;
  }

  async getLatestVersion(id: string): Promise<ExtensionVersion | null> {
    const versions = await this.getVersions(id);
    return versions[0] ?? null;
  }

  /**
   * The Acode registry publishes only the latest version per plugin, so
   * this returns a single-entry list (documented limitation, prompt §23).
   */
  async getVersions(id: string): Promise<ExtensionVersion[]> {
    const metadata = await this.getExtension(id);
    return [
      {
        download: metadata.download,
        notes: metadata.changelog,
        version: metadata.version,
      },
    ];
  }

  async resolveDownload(id: string): Promise<ExtensionDownload> {
    return { kind: "registry", pluginId: id };
  }

  /**
   * Mirrors Acode's own update check (`checkPluginsUpdate.js`): ask the
   * registry whether `<version>` is stale. Any failure yields null so the
   * caller falls back to the catalog version comparison.
   */
  async checkUpdate(
    id: string,
    version: string,
  ): Promise<{ update: boolean; version: string | null } | null> {
    try {
      const response = await this.fetchJson(
        this.url(`plugin/check-update/${encodeURIComponent(id)}/${encodeURIComponent(version)}`),
        { headers: { Accept: "application/json" } },
      );
      if (!response.ok) return null;
      const parsed: unknown = await response.json();
      if (!isRecord(parsed)) return null;
      if (parsed.update !== true) return { update: false, version: null };
      const remoteVersion = typeof parsed.version === "string" && parsed.version.trim()
        ? parsed.version.trim()
        : null;
      return { update: true, version: remoteVersion };
    } catch {
      return null;
    }
  }

  async search(query: string, options?: SearchOptions): Promise<ExtensionSummary[]> {
    const { entries } = await this.fetchCatalog({ limit: options?.limit });
    return searchCatalogMetadata(entries, query)
      .slice(0, options?.limit ?? entries.length)
      .map((entry) => ({
        author: entry.author,
        category: entry.category,
        description: entry.description,
        icon: entry.icon,
        id: entry.id,
        keywords: entry.keywords,
        name: entry.name,
        price: entry.price,
        version: entry.version,
      }));
  }
}

/**
 * Bundled seed catalog (offline-first, prompt §58): a small set of REAL
 * Acode-compatible plugins with real, current GitHub archive download
 * URLs, so the store is populated and installable before the first
 * successful registry sync — and fully usable offline forever.
 */
export const BUNDLED_SEED_CATALOG: ExtensionMetadata[] = extractEntryList(
  bundledSeed,
).map((entry) => {
  const normalized = normalizeRegistryEntry(entry);
  if (!normalized) {
    throw new Error("Bundled extension seed catalog contains an invalid entry.");
  }
  return { ...normalized, source: "bundled" as const };
});

/** Registry-backed catalog with the bundled seed as the offline floor. */
export class SeededRegistryProvider implements RegistryProvider {
  readonly id: string;

  constructor(
    private readonly remote: RegistryProvider | null,
    seed: ExtensionMetadata[] = BUNDLED_SEED_CATALOG,
  ) {
    this.id = remote?.id ?? "bundled";
    this.seed = seed;
  }

  private seed: ExtensionMetadata[];

  private merge(remoteEntries: ExtensionMetadata[]): ExtensionMetadata[] {
    const byId = new Map<string, ExtensionMetadata>();
    // Seeds first, so registry data always wins on conflicts.
    for (const entry of this.seed) byId.set(entry.id, entry);
    for (const entry of remoteEntries) byId.set(entry.id, entry);
    return [...byId.values()];
  }

  async fetchCatalog(options?: RegistryFetchOptions): Promise<ExtensionCatalog> {
    if (!this.remote) return { entries: this.seed, version: null };
    const remote = await this.remote.fetchCatalog(options);
    return { entries: this.merge(remote.entries), version: remote.version };
  }

  async getExtension(id: string): Promise<ExtensionMetadata> {
    if (this.remote) {
      try {
        return await this.remote.getExtension(id);
      } catch {
        // Fall through to the seed below.
      }
    }
    const seed = this.seed.find((entry) => entry.id === id);
    if (!seed) throw new Error(`Extension "${id}" is not in the catalog.`);
    return seed;
  }

  async getLatestVersion(id: string): Promise<ExtensionVersion | null> {
    const versions = await this.getVersions(id);
    return versions[0] ?? null;
  }

  async getVersions(id: string): Promise<ExtensionVersion[]> {
    const metadata = await this.getExtension(id);
    return [
      {
        download: metadata.download,
        notes: metadata.changelog,
        version: metadata.version,
      },
    ];
  }

  async resolveDownload(id: string): Promise<ExtensionDownload> {
    const metadata = await this.getExtension(id);
    return metadata.download ?? { kind: "registry", pluginId: id };
  }

  async checkUpdate(
    id: string,
    version: string,
  ): Promise<{ update: boolean; version: string | null } | null> {
    if (!this.remote || typeof this.remote.checkUpdate !== "function") return null;
    try {
      return await this.remote.checkUpdate(id, version);
    } catch {
      return null;
    }
  }

  async search(query: string, options?: SearchOptions): Promise<ExtensionSummary[]> {
    const { entries } = await this.fetchCatalog({ limit: options?.limit });
    return searchCatalogMetadata(entries, query)
      .slice(0, options?.limit ?? entries.length)
      .map((entry) => ({
        author: entry.author,
        category: entry.category,
        description: entry.description,
        icon: entry.icon,
        id: entry.id,
        keywords: entry.keywords,
        name: entry.name,
        price: entry.price,
        version: entry.version,
      }));
  }
}


