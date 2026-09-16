/**
 * Extensions platform — normalized models.
 *
 * Acode-compatible extension store models adapted to Ajiro Agent's
 * TypeScript architecture. Registry-specific response shapes never leak
 * past the registry provider; everything above it speaks these types.
 *
 * Source provenance: manifest field set follows the official Acode plugin
 * manifest documentation (docs.acode.app/docs/plugin-essentials/manifest)
 * and the current Acode install/load implementation ([OPEN-SOURCE, MIT]);
 * catalog/sync/runtime state models are [AJIRO ORIGINAL].
 */
import type { SignatureVerdict } from "./signature";

export type ExtensionAuthor = {
  email: string | null;
  github: string | null;
  name: string;
  url: string | null;
};

export type ExtensionDependency = {
  id: string;
  version: string | null;
};

export type ExtensionDownload =
  | { kind: "registry"; pluginId: string }
  | { kind: "url"; url: string };

export type ExtensionMetadata = {
  /** Canonical identity key. Never re-derived from name or slug. */
  id: string;
  name: string;
  version: string;
  author: ExtensionAuthor | null;
  category: string | null;
  changelog: string | null;
  dependencies: ExtensionDependency[];
  description: string | null;
  download: ExtensionDownload | null;
  icon: string | null;
  keywords: string[];
  license: string | null;
  /** Acode version code floor declared by the plugin. */
  minVersionCode: number | null;
  minVersionName: string | null;
  price: number;
  readme: string | null;
  repository: string | null;
  /** Where the metadata came from, for provenance display. */
  source: "registry" | "bundled" | "local";
  updatedAt: string | null;
};

export type ExtensionCatalog = {
  entries: ExtensionMetadata[];
  version: string | null;
};

export type ExtensionCatalogChange =
  | { type: "added"; extension: ExtensionMetadata }
  | { type: "removed"; extensionId: string }
  | { type: "updated"; current: ExtensionMetadata; previous: ExtensionMetadata }
  | {
      type: "version-updated";
      currentVersion: string;
      extensionId: string;
      previousVersion: string;
    };

export type RegistrySyncStatus =
  | "idle"
  | "syncing"
  | "success"
  | "offline"
  | "error";

export type RegistrySyncState = {
  catalogVersion: string | null;
  etag: string | null;
  itemCount: number;
  lastAttemptedSync: number | null;
  lastModified: string | null;
  lastSuccessfulSync: number | null;
  lastSyncError: string | null;
  syncStatus: RegistrySyncStatus;
};

export type RegistryFetchOptions = {
  etag?: string | null;
  lastModified?: string | null;
  limit?: number;
  signal?: AbortSignal;
};

export type SearchOptions = {
  category?: string | null;
  limit?: number;
};

export type ExtensionSummary = Pick<
  ExtensionMetadata,
  | "author"
  | "description"
  | "icon"
  | "id"
  | "keywords"
  | "name"
  | "price"
  | "version"
> & { category: string | null };

/**
 * One version entry for an extension. The Acode registry exposes only the
 * latest published version, so providers may return a single-entry list;
 * the model leaves room for richer registries.
 */
export type ExtensionVersion = {
  download: ExtensionDownload | null;
  notes: string | null;
  version: string;
};

/**
 * Extension package sources. `file` is a user-picked local ZIP
 * (document picker URI); `url` is a remote ZIP; `registry` resolves via
 * the registry provider download endpoint.
 */
export type ExtensionPackageSource =
  | { kind: "file"; uri: string }
  | { kind: "registry"; pluginId: string }
  | { kind: "url"; url: string };

export type PluginRuntimeState =
  | "broken"
  | "disabled"
  | "enabled"
  | "installing"
  | "loaded"
  | "loading"
  | "not-installed"
  | "uninstalling"
  | "updating";

export type CompatibilityLevel = "compatible" | "partial" | "unknown" | "unsupported";

export type ExtensionCompatibilityReport = {
  level: CompatibilityLevel;
  reasons: string[];
};

export type ExtensionPermissionKey =
  | "clipboard"
  | "commands"
  | "editor"
  | "filesystem"
  | "network"
  | "notifications"
  | "project-access"
  | "storage"
  | "terminal"
  | "ui";

export type ExtensionPermissionGrant = {
  grantedAt: string;
  key: ExtensionPermissionKey;
};

export type PluginSourceKind = "bundled" | "local-file" | "registry" | "remote-url";

export type InstalledExtensionRecord = {
  compatibility: ExtensionCompatibilityReport;
  enabled: boolean;
  /** Lowercased sha256 of the installed package bytes, when available. */
  packageSha256: string | null;
  /**
   * Publisher-signature verdict recorded at install time (§51). `null` means
   * the record predates signature support; `unsigned` is the honest verdict
   * for almost every Acode plugin, which publishes no signature at all.
   */
  signature: SignatureVerdict | null;
  permissions: ExtensionPermissionGrant[];
  runtimeState: PluginRuntimeState;
  /** Runtime error captured when the plugin was marked broken. */
  runtimeError: string | null;
  source: PluginSourceKind;
  sourceUrl: string | null;
  installedAt: string;
  updatedAt: string;
  manifest: Record<string, unknown>;
  version: string;
  id: string;
};

export type ExtensionInstallState =
  | "installed"
  | "installed-broken"
  | "installed-disabled"
  | "not-installed"
  | "update-available";

export type ExtensionDiagnostic = {
  at: string;
  level: "error" | "info" | "warning";
  message: string;
  pluginId: string;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
