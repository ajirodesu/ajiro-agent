/**
 * Remote Skill registry (Dynamic Updates prompt §§4–5, 14–15, 19–20, 44).
 *
 * The Skill Store used to browse a bundled catalog only. This module adds
 * the sync layer behind it: conditional fetch (ETag/Last-Modified) with a
 * TTL, bundled fallback when offline, and extended per-entry metadata
 * (version, channel, revocation, deprecation, runtime floor, capabilities,
 * integrity) that older catalogs simply omit. Publishing a skill means
 * merging it into `catalog/skills.json`; existing installs discover it on
 * the next sync with no APK rebuild.
 */
import catalog from "@/../catalog/skills.json";
import type { StoreSkillEntry } from "./skill-store-catalog";

export const SKILL_REGISTRY_URL =
  "https://raw.githubusercontent.com/ajirodesu/Ajiro-Agent/refs/heads/main/catalog/skills.json";

export const SKILL_REGISTRY_TTL_MS = 30 * 60 * 1000;
const MAX_REGISTRY_SKILLS = 500;

export type SkillRegistryEntry = StoreSkillEntry & {
  /** Publisher-declared version (§12); absent means hash-compared only. */
  version: string | null;
  channel: string | null;
  revoked: boolean;
  deprecated: boolean;
  minAppVersion: string | null;
  /** Newer than this, the skill is incompatible rather than updatable. */
  maxAppVersion: string | null;
  /** Supported platforms, e.g. ["android", "ios"]; empty means all. */
  platforms: string[];
  /** Other skill slugs that should be installed first (§12 dependencies). */
  dependencies: string[];
  /** First publication timestamp (§12); updatedAt stays the revision stamp. */
  publishedAt: string | null;
  requiredCapabilities: string[];
  /** Expected content hash / signature (§§21–22); verified on install. */
  hash: string | null;
  signature: string | null;
  changelog: string | null;
  updatedAt: string | null;
  rolloutPercent: number | null;
};

export type SkillRegistryResult = {
  entries: SkillRegistryEntry[];
  /** "remote" when the network answered (even a 304), else the bundle. */
  source: "bundled" | "remote";
};

type FetchLike = (
  input: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  ok: boolean;
  status: number;
}>;

let cached: {
  entries: SkillRegistryEntry[];
  etag: string | null;
  expiresAt: number;
  lastModified: string | null;
  source: SkillRegistryResult["source"];
} | null = null;

/** Test seam: forget the in-memory registry (validators included). */
export function resetSkillRegistryCache(): void {
  cached = null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(
  record: Record<string, unknown>,
  key: string,
  maxLength: number,
): string {
  const value = record[key];
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    throw new Error(`Skill registry field ${key} must be a non-empty string.`);
  }
  return value.trim();
}

function optionalString(
  record: Record<string, unknown>,
  key: string,
  maxLength: number,
): string | null {
  const value = record[key];
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    throw new Error(`Skill registry field ${key} must be a string.`);
  }
  return value.trim();
}

function optionalVersion(record: Record<string, unknown>, key: string): string | null {
  const value = optionalString(record, key, 32);
  if (value && !/^[0-9A-Za-z.+-]+$/.test(value)) {
    throw new Error(`Skill registry field ${key} is not a version.`);
  }
  return value;
}

function optionalChannel(record: Record<string, unknown>): string | null {
  const value = record.channel;
  if (value === undefined || value === null || value === "") return null;
  if (value !== "stable" && value !== "beta" && value !== "preview") {
    throw new Error("Skill registry channel must be stable, beta, or preview.");
  }
  return value;
}

function optionalStringList(
  record: Record<string, unknown>,
  key: string,
  maxItems: number,
): string[] {
  const value = record[key];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new Error(`Skill registry field ${key} must be an array.`);
  }
  if (value.length > maxItems) {
    throw new Error(`Skill registry field ${key} has too many entries.`);
  }
  return value.map((entry) => {
    if (typeof entry !== "string" || !entry.trim() || entry.length > 64) {
      throw new Error(`Skill registry field ${key} must list names.`);
    }
    return entry.trim();
  });
}

function optionalSlugList(record: Record<string, unknown>): string[] {
  const value = record.dependencies;
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new Error("Skill registry field dependencies must be an array.");
  }
  if (value.length > 24) {
    throw new Error("Skill registry field dependencies has too many entries.");
  }
  return value.map((entry) => {
    if (typeof entry !== "string" || !entry.trim() || entry.length > 80) {
      throw new Error("Skill registry field dependencies must list skill slugs.");
    }
    return entry.trim().toLowerCase();
  });
}

function optionalPlatformList(record: Record<string, unknown>): string[] {
  const value = record.platforms;
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new Error("Skill registry field platforms must be an array.");
  }
  if (value.length > 8) {
    throw new Error("Skill registry field platforms has too many entries.");
  }
  return value.map((entry) => {
    if (typeof entry !== "string" || !entry.trim() || entry.length > 32) {
      throw new Error("Skill registry field platforms must list platform names.");
    }
    return entry.trim().toLowerCase();
  });
}

function optionalPercent(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`Skill registry field ${key} must be 0–100.`);
  }
  return value;
}

function parseRegistryEntry(value: unknown): SkillRegistryEntry | null {
  if (!isRecord(value)) return null;
  try {
    const slug = requiredString(value, "slug", 80);
    const name = requiredString(value, "name", 120);
    const description = requiredString(value, "description", 2048);
    const author = requiredString(value, "author", 120);
    const category = requiredString(value, "category", 64);
    const sourceUrl = requiredString(value, "sourceUrl", 2048);
    if (!/^https?:\/\//i.test(sourceUrl)) return null;
    return {
      author,
      category,
      channel: optionalChannel(value),
      changelog: optionalString(value, "changelog", 4096),
      dependencies: optionalSlugList(value),
      deprecated: value.deprecated === true,
      description,
      hash: optionalString(value, "hash", 128),
      maxAppVersion: optionalVersion(value, "maxAppVersion"),
      minAppVersion: optionalVersion(value, "minAppVersion"),
      name,
      platforms: optionalPlatformList(value),
      publishedAt: optionalString(value, "publishedAt", 32),
      requiredCapabilities: optionalStringList(value, "requiredCapabilities", 24),
      revoked: value.revoked === true,
      rolloutPercent: optionalPercent(value, "rolloutPercent"),
      signature: optionalString(value, "signature", 4096),
      slug,
      sourceUrl,
      updatedAt: optionalString(value, "updatedAt", 32),
      version: optionalVersion(value, "version"),
    };
  } catch {
    return null;
  }
}

export function parseSkillRegistry(value: unknown): SkillRegistryEntry[] {
  if (!isRecord(value) || !Array.isArray(value.skills)) return [];
  if (value.skills.length > MAX_REGISTRY_SKILLS) {
    throw new Error("Skill registry contains too many entries.");
  }
  const seen = new Set<string>();
  const entries: SkillRegistryEntry[] = [];
  for (const item of value.skills) {
    const entry = parseRegistryEntry(item);
    if (!entry || seen.has(entry.slug)) continue;
    seen.add(entry.slug);
    entries.push(entry);
  }
  return entries.sort((left, right) => left.name.localeCompare(right.name));
}

function bundledEntries(): SkillRegistryEntry[] {
  return parseSkillRegistry(catalog as unknown);
}

/**
 * Fetch the registry with cache freshness first (§14/§19): a fresh
 * in-memory copy is returned untouched, a stale one revalidates
 * conditionally (304 extends it with no download), and any failure falls
 * back to the bundled catalog so the Store stays usable offline (§17).
 */
export async function fetchSkillRegistry(
  input: {
    fetchImpl?: FetchLike;
    now?: () => number;
    signal?: AbortSignal;
    url?: string;
  } = {},
): Promise<SkillRegistryResult> {
  const now = input.now ?? Date.now;
  if (cached && cached.expiresAt > now()) {
    return { entries: cached.entries, source: cached.source };
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (cached?.etag) headers["If-None-Match"] = cached.etag;
  if (cached?.lastModified) headers["If-Modified-Since"] = cached.lastModified;
  try {
    const response = await fetchImpl(input.url ?? SKILL_REGISTRY_URL, {
      headers,
      signal: input.signal,
    });
    if (response.status === 304 && cached) {
      cached.expiresAt = now() + SKILL_REGISTRY_TTL_MS;
      return { entries: cached.entries, source: cached.source };
    }
    if (!response.ok) throw new Error(`Skill registry request failed (${response.status}).`);
    const entries = parseSkillRegistry(await response.json());
    cached = {
      entries,
      etag: response.headers.get("etag"),
      expiresAt: now() + SKILL_REGISTRY_TTL_MS,
      lastModified: response.headers.get("last-modified"),
      source: "remote",
    };
    return { entries, source: "remote" };
  } catch (error) {
    if (input.signal?.aborted) throw error;
    const entries = bundledEntries();
    cached = {
      entries,
      etag: cached?.etag ?? null,
      expiresAt: now() + SKILL_REGISTRY_TTL_MS,
      lastModified: cached?.lastModified ?? null,
      source: "bundled",
    };
    return { entries, source: "bundled" };
  }
}

/** Revoked entries must not be installable (§24). */
export function filterRevokedSkillEntries(
  entries: readonly SkillRegistryEntry[],
): SkillRegistryEntry[] {
  return entries.filter((entry) => !entry.revoked);
}
