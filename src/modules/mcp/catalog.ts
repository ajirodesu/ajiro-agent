import bundledCatalog from "../../../catalog/mcp-servers.json";

import { fetchWithTimeout } from "@/core/fetch-with-timeout";
import type { McpServerAuthMode, McpServerTransport } from "@/core/types/app-state";

export const MCP_CATALOG_URL =
  "https://raw.githubusercontent.com/ajirodesu/Ajiro-Agent/refs/heads/main/catalog/mcp-servers.json";

const CATALOG_TTL_MS = 30 * 60 * 1000;
const MAX_CATALOG_SERVERS = 100;

export type McpServerPreset = {
  authMode: McpServerAuthMode;
  /** Optional dynamic-update metadata (§§6, 11–13, 24, 44–45); absent means stable, unversioned, unrevoked. */
  capabilities: string[];
  channel: string | null;
  changelog: string | null;
  /** Other preset ids that must be configured first (§6 dependencies). */
  dependencies: string[];
  deprecated: boolean;
  description: string;
  headerTemplate: string | null;
  id: string;
  label: string;
  maxAppVersion: string | null;
  minAppVersion: string | null;
  oauthAllowedAuthOrigin: string | null;
  oauthAuthorizationUrl: string | null;
  oauthClientId: string | null;
  oauthScopes: string | null;
  oauthTokenUrl: string | null;
  /** Supported platforms, e.g. ["android", "ios"]; empty means all (§6). */
  platforms: string[];
  publishedAt: string | null;
  publisher: string | null;
  requiredCapabilities: string[];
  revoked: boolean;
  rolloutPercent: number | null;
  transport: McpServerTransport;
  updatedAt: string | null;
  url: string;
  version: string | null;
};

export type McpServerCatalogResult = {
  presets: McpServerPreset[];
  source: "bundled" | "github";
};

let cachedCatalog: {
  etag: string | null;
  expiresAt: number;
  lastModified: string | null;
  result: McpServerCatalogResult;
} | null = null;

/** Test seam: forget the in-memory catalog (validators included). */
export function resetMcpServerCatalogCache(): void {
  cachedCatalog = null;
}

function getRecord(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function getRequiredString(
  record: Record<string, unknown>,
  key: string,
  maxLength: number,
) {
  const value = record[key];

  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`MCP catalog field ${key} must be a non-empty string.`);
  }

  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new Error(`MCP catalog field ${key} is too long.`);
  }

  return trimmed;
}

function getOptionalString(
  record: Record<string, unknown>,
  key: string,
  maxLength: number,
) {
  const value = record[key];
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new Error(`MCP catalog field ${key} must be a string.`);
  }

  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new Error(`MCP catalog field ${key} is too long.`);
  }

  return trimmed || null;
}

function getHttpsUrl(value: string, label: string) {
  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid URL.`);
  }

  if (parsed.protocol !== "https:") {
    throw new Error(`${label} must use HTTPS.`);
  }

  return parsed.href;
}

function parsePreset(value: unknown): McpServerPreset {
  const record = getRecord(value, "MCP catalog server");
  const authMode = record.authMode;
  const transport = record.transport;

  if (authMode !== "none" && authMode !== "headers" && authMode !== "oauth") {
    throw new Error("MCP catalog authMode is invalid.");
  }

  if (transport !== "http" && transport !== "sse") {
    throw new Error("MCP catalog transport is invalid.");
  }

  return {
    authMode,
    capabilities: getStringList(record, "capabilities", 24),
    channel: getOptionalChannel(record),
    changelog: getOptionalString(record, "changelog", 4096),
    dependencies: getStringList(record, "dependencies", 24),
    deprecated: record.deprecated === true,
    description: getRequiredString(record, "description", 240),
    headerTemplate: getOptionalString(record, "headerTemplate", 2048),
    id: getRequiredString(record, "id", 64),
    label: getRequiredString(record, "label", 80),
    maxAppVersion: getOptionalVersion(record, "maxAppVersion"),
    minAppVersion: getOptionalVersion(record, "minAppVersion"),
    oauthAllowedAuthOrigin: getOptionalString(
      record,
      "oauthAllowedAuthOrigin",
      2048,
    ),
    oauthAuthorizationUrl: getOptionalString(
      record,
      "oauthAuthorizationUrl",
      2048,
    ),
    oauthClientId: getOptionalString(record, "oauthClientId", 512),
    oauthScopes: getOptionalString(record, "oauthScopes", 1024),
    oauthTokenUrl: getOptionalString(record, "oauthTokenUrl", 2048),
    platforms: getPlatformList(record),
    publishedAt: getOptionalString(record, "publishedAt", 32),
    publisher: getOptionalString(record, "publisher", 120),
    requiredCapabilities: getStringList(record, "requiredCapabilities", 24),
    revoked: record.revoked === true,
    rolloutPercent: getOptionalPercent(record, "rolloutPercent"),
    transport,
    updatedAt: getOptionalString(record, "updatedAt", 32),
    url: getHttpsUrl(getRequiredString(record, "url", 2048), "MCP server URL"),
    version: getOptionalVersion(record, "version"),
  };
}

function getPlatformList(record: Record<string, unknown>): string[] {
  const value = record.platforms;
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new Error("MCP catalog field platforms must be an array.");
  }
  if (value.length > 8) {
    throw new Error("MCP catalog field platforms has too many entries.");
  }
  return value.map((entry) => {
    if (typeof entry !== "string" || !entry.trim() || entry.length > 32) {
      throw new Error("MCP catalog field platforms must list platform names.");
    }
    return entry.trim().toLowerCase();
  });
}

function getOptionalChannel(record: Record<string, unknown>): string | null {
  const value = record.channel;
  if (value === undefined || value === null || value === "") return null;
  if (value !== "stable" && value !== "beta" && value !== "preview") {
    throw new Error("MCP catalog channel must be stable, beta, or preview.");
  }
  return value;
}

function getOptionalVersion(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`MCP catalog field ${key} must be a string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > 32 || !/^[0-9A-Za-z.+-]+$/.test(trimmed)) {
    throw new Error(`MCP catalog field ${key} is not a version.`);
  }
  return trimmed;
}

function getOptionalPercent(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`MCP catalog field ${key} must be 0–100.`);
  }
  return value;
}

function getStringList(
  record: Record<string, unknown>,
  key: string,
  maxItems: number,
): string[] {
  const value = record[key];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new Error(`MCP catalog field ${key} must be an array.`);
  }
  if (value.length > maxItems) {
    throw new Error(`MCP catalog field ${key} has too many entries.`);
  }
  return value.map((entry) => {
    if (typeof entry !== "string" || !entry.trim() || entry.length > 64) {
      throw new Error(`MCP catalog field ${key} must list capability names.`);
    }
    return entry.trim();
  });
}

export function parseMcpServerCatalog(value: unknown) {
  const catalog = getRecord(value, "MCP catalog");

  if (catalog.version !== 1) {
    throw new Error("Unsupported MCP catalog version.");
  }

  if (!Array.isArray(catalog.servers)) {
    throw new Error("MCP catalog servers must be an array.");
  }

  if (catalog.servers.length > MAX_CATALOG_SERVERS) {
    throw new Error("MCP catalog contains too many servers.");
  }

  const presets = catalog.servers.map(parsePreset);
  const ids = new Set<string>();

  for (const preset of presets) {
    if (ids.has(preset.id)) {
      throw new Error(`Duplicate MCP catalog id: ${preset.id}.`);
    }
    ids.add(preset.id);
  }

  return presets;
}

export async function fetchMcpServerCatalog(
  signal?: AbortSignal,
): Promise<McpServerCatalogResult> {
  // Conditional refresh (§20): validators from the last fetch ride along,
  // so an unchanged catalog costs a 304 with no body instead of a download.
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Cache-Control": "no-cache",
  };
  if (cachedCatalog?.etag) headers["If-None-Match"] = cachedCatalog.etag;
  if (cachedCatalog?.lastModified) {
    headers["If-Modified-Since"] = cachedCatalog.lastModified;
  }
  try {
    const response = await fetchWithTimeout(MCP_CATALOG_URL, {
      cache: "no-store",
      headers,
      signal,
    });

    if (response.status === 304 && cachedCatalog) {
      cachedCatalog.expiresAt = Date.now() + CATALOG_TTL_MS;
      return { ...cachedCatalog.result, source: "github" };
    }

    if (!response.ok) {
      throw new Error(`GitHub catalog request failed (${response.status}).`);
    }

    const result: McpServerCatalogResult = {
      presets: parseMcpServerCatalog(await response.json()),
      source: "github",
    };
    cachedCatalog = {
      etag: response.headers.get("etag"),
      expiresAt: Date.now() + CATALOG_TTL_MS,
      lastModified: response.headers.get("last-modified"),
      result,
    };
    return result;
  } catch (error) {
    if (signal?.aborted) throw error;

    return {
      presets: parseMcpServerCatalog(bundledCatalog),
      source: "bundled",
    };
  }
}

export async function fetchMcpServerCatalogCached(signal?: AbortSignal) {
  if (cachedCatalog && cachedCatalog.expiresAt > Date.now()) {
    return cachedCatalog.result;
  }

  const result = await fetchMcpServerCatalog(signal);
  if (result.source === "bundled") {
    cachedCatalog = {
      etag: cachedCatalog?.etag ?? null,
      expiresAt: Date.now() + CATALOG_TTL_MS,
      lastModified: cachedCatalog?.lastModified ?? null,
      result,
    };
  }
  return result;
}
