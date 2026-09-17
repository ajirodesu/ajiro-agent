/**
 * Extension package manager (prompt §31/§32): download → stage → validate
 * → atomic install with backup/rollback. The platform adapter is injected
 * so the whole flow stays pure and unit-testable; `platform.ts` supplies
 * the React Native implementation (expo-file-system + expo-crypto).
 *
 * Validation pipeline (§12): ZIP structure → entry-name safety → CRC
 * integrity → plugin.json manifest (Acode semantics) → publisher signature
 * (§51) → entry point → dependency + permission analysis → atomic replace.
 * The currently working install is never destroyed before the new package
 * validates.
 *
 * Discovery vs. execution (§17): installing registers and stages files
 * only. Activation is a separate, explicit step through the runtime.
 */
import { checkNativeRequirements } from "@/modules/updates/extension-framework";
import { evaluateCompatibility } from "./compatibility";
import {
  buildDependencyGraph,
  planDependencyInstall,
  type DependencyIssue,
} from "./dependencies";
import {
  parsePluginManifest,
  validatePluginId,
  type AcodePluginManifest,
} from "./manifest";
import {
  isRecord,
  type ExtensionDownload,
  type ExtensionMetadata,
  type ExtensionPackageSource,
  type ExtensionPermissionKey,
  type InstalledExtensionRecord,
  type PluginSourceKind,
  type PluginRuntimeState,
} from "./models";
import { grantAll, pendingPermissions } from "./permissions";
import {
  buildSigningPayload,
  DEFAULT_SIGNATURE_POLICY,
  evaluatePackageSignature,
  type SignaturePolicy,
  type SignatureVerdict,
  signatureBlocksInstall,
} from "./signature";
import {
  backupDir,
  pluginDataDir,
  pluginDir,
  rollbackPointDir,
  sanitizePluginId,
  stagingDir,
  type ExtensionPathPlan,
} from "./storage";
import { packageText, readPluginPackage } from "./zip";
import { ACODE_REGISTRY_BASE, type RegistryProvider } from "./registry";

/** Platform adapter contract (implemented in platform.ts for RN). */
export interface ExtensionPlatform {
  copyEntry(from: string, to: string, kind: "directory" | "file"): Promise<void>;
  deleteEntry(path: string, kind: "directory" | "file"): Promise<void>;
  exists(path: string, kind: "directory" | "file"): Promise<boolean>;
  fetchBytes(
    url: string,
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<Uint8Array>;
  hashSha256(bytes: Uint8Array): Promise<string>;
  listDirectory(path: string): Promise<{ isDirectory: boolean; name: string }[]>;
  makeDirectory(path: string): Promise<void>;
  moveEntry(
    from: string,
    to: string,
    kind: "directory" | "file",
  ): Promise<void>;
  nowIso(): string;
  readBinary(path: string): Promise<Uint8Array>;
  readText(path: string): Promise<string | null>;
  writeBinary(path: string, bytes: Uint8Array): Promise<void>;
  writeText(path: string, text: string): Promise<void>;
}

export type InstallDeps = {
  paths: ExtensionPathPlan;
  platform: ExtensionPlatform;
};

export type InstallOptions = {
  /** Permissions the user already approved for this install/update. */
  acceptedPermissions?: ExtensionPermissionKey[];
  /**
   * Wait before starting (used by retry-with-backoff). Exposed so tests do
   * not have to sleep in real time.
   */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Keep the replaced version as a rollback point instead of deleting it
   * (§32/§33). Update flows set this so a version that installs but fails
   * to activate can be rolled back; plain installs clean up after
   * themselves.
   */
  retainBackup?: boolean;
  /**
   * Publisher-signature policy in force (§51). Omitted means "record the
   * verdict, refuse nothing", which is the honest default for an ecosystem
   * that publishes no signatures.
   */
  signaturePolicy?: SignaturePolicy;
};

export class InstallerError extends Error {}

const PLUGIN_MANIFEST_NAME = "plugin.json";

export type InstallOutcome =
  | {
      /** Version-aware detail when a provider supplied dependency versions. */
      issues: DependencyIssue[];
      manifest: AcodePluginManifest;
      /** Ids required but not installed, in declaration order. */
      missing: string[];
      status: "needs-dependencies";
    }
  | {
      manifest: AcodePluginManifest;
      /** Native capabilities this install lacks (§36). */
      missingCapabilities: string[];
      status: "needs-app-update";
    }
  | {
      manifest: AcodePluginManifest;
      pending: ExtensionPermissionKey[];
      status: "needs-permissions";
    }
  | {
      manifest: AcodePluginManifest;
      status: "signature-rejected";
      verdict: SignatureVerdict;
    }
  | { record: InstalledExtensionRecord; status: "installed" };

export type StoredRecords = { extensions: InstalledExtensionRecord[] };

/** Tolerant parse of persisted installed records. */
export function parseInstalledRecords(raw: string | null): InstalledExtensionRecord[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    const list = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed) && Array.isArray(parsed.extensions)
        ? (parsed.extensions as unknown[])
        : [];
    // Records written before signature support carry no verdict; they are
    // normalized to `null` ("unknown") rather than left undefined, so every
    // reader can trust the field's type.
    return list
      .filter(isRecordRecord)
      .map((record) => ({ ...record, signature: storedSignature(record.signature) }));
  } catch {
    return [];
  }
}

const STORED_SIGNATURE_STATUSES: readonly SignatureVerdict["status"][] = [
  "unsigned",
  "verified",
  "untrusted-key",
  "invalid",
  "unsupported-algorithm",
  "malformed",
];

/** Tolerant read of a persisted verdict: anything unrecognizable is unknown. */
function storedSignature(raw: unknown): SignatureVerdict | null {
  if (!isRecord(raw)) return null;
  if (!STORED_SIGNATURE_STATUSES.includes(raw.status as SignatureVerdict["status"])) {
    return null;
  }
  return {
    detail: typeof raw.detail === "string" ? raw.detail : "",
    keyId: typeof raw.keyId === "string" ? raw.keyId : null,
    status: raw.status as SignatureVerdict["status"],
  };
}

function isRecordRecord(value: unknown): value is InstalledExtensionRecord {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.version === "string" &&
    isRecord(value.manifest)
  );
}

export function serializeInstalledRecords(records: InstalledExtensionRecord[]): string {
  return JSON.stringify({ extensions: records } satisfies StoredRecords);
}

export async function loadInstalledRecords(
  deps: InstallDeps,
): Promise<InstalledExtensionRecord[]> {
  const raw = await deps.platform.readText(deps.paths.installedFile);
  return parseInstalledRecords(raw);
}

export async function saveInstalledRecords(
  deps: InstallDeps,
  records: InstalledExtensionRecord[],
): Promise<void> {
  await deps.platform.writeText(
    deps.paths.installedFile,
    serializeInstalledRecords(records),
  );
}

/** Pure record patch helper (enable/disable/broken/diagnostics). */
export function patchRecord(
  records: InstalledExtensionRecord[],
  pluginId: string,
  patch: Partial<InstalledExtensionRecord>,
  updatedAt: string,
): InstalledExtensionRecord[] {
  return records.map((record) =>
    record.id === pluginId ? { ...record, ...patch, updatedAt } : record,
  );
}

async function resolvePackageBytes(
  deps: InstallDeps,
  provider: RegistryProvider | null,
  source: ExtensionPackageSource,
  onProgress?: (loaded: number, total: number) => void,
): Promise<{ bytes: Uint8Array; sourceKind: PluginSourceKind; sourceUrl: string | null }> {
  switch (source.kind) {
    case "file": {
      const bytes = await deps.platform.readBinary(source.uri);
      return { bytes, sourceKind: "local-file", sourceUrl: null };
    }
    case "url":
      return {
        bytes: await deps.platform.fetchBytes(source.url, onProgress),
        sourceKind: "remote-url",
        sourceUrl: source.url,
      };
    case "registry": {
      const download: ExtensionDownload = provider
        ? await provider.resolveDownload(source.pluginId)
        : { kind: "registry", pluginId: source.pluginId };
      const url =
        download.kind === "url"
          ? download.url
          : `${ACODE_REGISTRY_BASE}/plugin/download/${encodeURIComponent(download.pluginId)}`;
      return {
        bytes: await deps.platform.fetchBytes(url, onProgress),
        sourceKind: "registry",
        sourceUrl: url,
      };
    }
  }
}

/**
 * Install or update a package from any source. All state changes happen
 * only after full validation (§32 atomic install with rollback).
 */
export async function installPackage(
  deps: InstallDeps,
  source: ExtensionPackageSource,
  options: InstallOptions & {
    /** Catalog metadata, so dependency versions can be checked (§53). */
    catalog?: ExtensionMetadata[];
    onProgress?: (loaded: number, total: number) => void;
    provider?: RegistryProvider | null;
  } = {},
): Promise<InstallOutcome> {
  const platform = deps.platform;
  const now = platform.nowIso();

  const { bytes, sourceKind, sourceUrl } = await resolvePackageBytes(
    deps,
    options.provider ?? null,
    source,
    options.onProgress,
  );

  // 1-3. Archive + manifest + entry validation (Acode semantics).
  const pkg = readPluginPackage(bytes);
  const manifest = parsePluginManifest(
    packageText(pkg.files, "plugin.json") ?? "",
    [...pkg.files.keys()],
  );

  // 3a. Native capability gate (Dynamic Updates prompt §36): a plugin that
  // needs native functionality this install lacks is refused with Requires
  // App Update — never installed half-working.
  const native = checkNativeRequirements(manifest.nativeCapabilities);
  if (!native.satisfied) {
    return {
      manifest,
      missingCapabilities: native.missing,
      status: "needs-app-update",
    };
  }

  // 3b. Revocation gate (§24): a revoked package is refused before anything
  // is staged, no matter the source. The catalog is advisory — the check
  // runs on the id the *package itself* declares.
  const catalogEntry = (options.catalog ?? []).find(
    (entry) => entry.id === manifest.id,
  );
  if (catalogEntry?.revoked) {
    throw new InstallerError(
      `Extension "${manifest.id}" was revoked by the registry and cannot be installed.`,
    );
  }

  // 3c. Publisher signature (§51). Verified against the bytes that were
  // actually downloaded, so the verdict describes *this* package and not the
  // version the registry once advertised. A verdict is always recorded; only
  // the user's own policy can make one refuse the install.
  const signaturePolicy = options.signaturePolicy ?? DEFAULT_SIGNATURE_POLICY;
  const signature = evaluatePackageSignature({
    payload: buildSigningPayload({
      files: pkg.files,
      manifest: { id: manifest.id, raw: manifest.raw, version: manifest.version },
    }),
    raw: manifest.raw.signature,
    trustedKeys: signaturePolicy.trustedKeys,
  });
  if (signatureBlocksInstall(signature, signaturePolicy.requireSigned)) {
    // Nothing has been written yet, so a refused package leaves no trace.
    return { manifest, status: "signature-rejected", verdict: signature };
  }

  // 4. Dependency validation (§53). The manifest carries ids only (Acode
  // publishes no versions), so this is the last line of defence: report and
  // never silently auto-install. Version-aware planning happens in
  // `dependencies.ts`, which the registry-backed manager calls first.
  const records = await loadInstalledRecords(deps);
  const missing = manifest.dependencies.filter(
    (dependency) => !records.some((record) => record.id === dependency),
  );
  if (missing.length > 0) {
    return { issues: [], manifest, missing, status: "needs-dependencies" };
  }

  const existing = records.find((record) => record.id === manifest.id);

  // 5. Version-aware check when the registry knows dependency versions
  // (§53): an installed version that cannot satisfy a declared requirement
  // blocks the install with an explanation instead of failing later.
  const catalog = options.catalog ?? [];
  if (catalog.length > 0) {
    const plan = planDependencyInstall(
      manifest.id,
      buildDependencyGraph({
        catalog,
        installed: records,
        root: {
          dependencies: manifest.dependencies.map((id) => ({ id, version: null })),
          id: manifest.id,
        },
      }),
      { catalog, installed: records },
    );
    const blocking = plan.issues.filter(
      (issue) => issue.kind !== "version" || issue.source === "installed",
    );
    if (blocking.length > 0) {
      return {
        issues: blocking,
        manifest,
        missing: plan.missingIds.length
          ? plan.missingIds
          : manifest.dependencies.filter(
              (dependency) => !records.some((record) => record.id === dependency),
            ),
        status: "needs-dependencies",
      };
    }
  }

  // 6. Permission analysis (§50): new capabilities require approval.
  const pending = pendingPermissions(manifest, existing?.permissions ?? []);
  if (pending.length > 0) {
    const accepted = new Set(options.acceptedPermissions ?? []);
    const unaccepted = pending.filter((key) => !accepted.has(key));
    if (unaccepted.length > 0) {
      return { manifest, pending: unaccepted, status: "needs-permissions" };
    }
  }

  // 7. Compatibility evaluation (§54) with entry-source analysis.
  const entrySource = packageText(pkg.files, manifest.main);
  const compatibility = evaluateCompatibility(manifest, entrySource);

  // 8. Stage the full package tree.
  const stamp = now.replace(/[^0-9]/g, "");
  const attemptStaging = stagingDir(deps.paths, `${sanitizePluginId(manifest.id)}-${stamp}`);
  await platform.makeDirectory(attemptStaging);
  for (const [name, data] of pkg.files) {
    const target = `${attemptStaging}/${name}`;
    const lastSlash = target.lastIndexOf("/");
    if (lastSlash > attemptStaging.length + 1) {
      await platform.makeDirectory(target.slice(0, lastSlash));
    }
    await platform.writeBinary(target, data);
  }

  // 9. Atomic replace with backup + rollback (§32).
  const destination = pluginDir(deps.paths, manifest.id);
  const hadPrevious = await platform.exists(destination, "directory");
  const backupPath = options.retainBackup
    ? rollbackPointDir(deps.paths, manifest.id)
    : backupDir(deps.paths, manifest.id, stamp);

  // Record the operation in flight (§52) so an interrupted install is
  // visible on the next launch instead of leaving a record that silently
  // disagrees with what is on disk. Restored if the swap fails.
  await saveInstalledRecords(
    deps,
    records.some((item) => item.id === manifest.id)
      ? patchRecord(
          records,
          manifest.id,
          { runtimeState: "updating", signature },
          now,
        )
      : [
          ...records,
          installingRecord({
            manifest,
            now,
            signature,
            sourceKind,
            sourceUrl,
            version: manifest.version,
          }),
        ],
  );

  if (hadPrevious) {
    await platform.makeDirectory(deps.paths.backupsRoot);
    // Only one rollback point is kept per plugin, so supersede any stale one.
    if (await platform.exists(backupPath, "directory")) {
      await platform.deleteEntry(backupPath, "directory");
    }
    await platform.moveEntry(destination, backupPath, "directory");
  }
  try {
    await platform.moveEntry(attemptStaging, destination, "directory");
  } catch (error) {
    if (hadPrevious) {
      await platform.moveEntry(backupPath, destination, "directory");
    }
    // The swap failed, so the previous record is the true state again.
    await saveInstalledRecords(deps, records).catch(() => {});
    throw error;
  }
  if (hadPrevious && !options.retainBackup) {
    await platform.deleteEntry(backupPath, "directory").catch(() => {});
  }

  const packageSha256 = await platform.hashSha256(bytes);
  const permissions = [...(existing?.permissions ?? []), ...grantAll(pending, now)];
  const record: InstalledExtensionRecord = {
    compatibility,
    // Installing is never activating (§17): a new package arrives disabled
    // and the user enables it explicitly. An update preserves the user's
    // existing enable choice.
    enabled: existing ? existing.enabled : false,
    id: manifest.id,
    installedAt: existing?.installedAt ?? now,
    manifest: manifest.raw,
    packageSha256,
    permissions,
    runtimeError: null,
    // A freshly installed/updated package is never trusted to auto-load: it
    // starts disabled and activates only through an explicit enable (§17).
    runtimeState: "disabled",
    signature,
    source: sourceKind,
    sourceUrl,
    updatedAt: now,
    version: manifest.version,
  };
  const nextRecords = records.some((item) => item.id === manifest.id)
    ? patchRecord(records, manifest.id, record, now)
    : [...records, record];
  await saveInstalledRecords(deps, nextRecords);

  return { record, status: "installed" };
}

/**
 * A record for a plugin that is mid-install: nothing about it is trusted
 * yet, so it is disabled and marked in flight until the swap completes.
 */
function installingRecord(input: {
  manifest: AcodePluginManifest;
  now: string;
  signature: SignatureVerdict;
  sourceKind: PluginSourceKind;
  sourceUrl: string | null;
  version: string;
}): InstalledExtensionRecord {
  return {
    compatibility: { level: "unknown", reasons: ["Installation is still in progress."] },
    enabled: false,
    id: input.manifest.id,
    installedAt: input.now,
    manifest: input.manifest.raw,
    packageSha256: null,
    permissions: [],
    runtimeError: null,
    runtimeState: "installing",
    signature: input.signature,
    source: input.sourceKind,
    sourceUrl: input.sourceUrl,
    updatedAt: input.now,
    version: input.version,
  };
}

const TRANSIENT_STATES: readonly PluginRuntimeState[] = [
  "installing",
  "uninstalling",
  "updating",
];

/**
 * Finish or repair operations that were interrupted (§52).
 *
 * An install/update/uninstall writes its intent to the record before it
 * touches the filesystem, so a process death leaves a record in a transient
 * state. This reconciles each one against what is actually on disk:
 *
 * - package missing (or unreadable manifest) and the record said
 *   `uninstalling` → the removal finished; drop the record;
 * - package missing and it said `installing`/`updating` → the operation never
 *   landed; drop a never-installed record, or park an existing one as broken
 *   with an explanation while keeping any rollback point intact;
 * - package present and valid → the operation did land; adopt the manifest and
 *   version from disk and restore the state implied by the enable flag.
 *
 * Returns the reconciled records, and is a no-op (and no write) when nothing
 * was interrupted.
 */
export async function reconcileInterruptedOperations(
  deps: InstallDeps,
): Promise<InstalledExtensionRecord[]> {
  const records = await loadInstalledRecords(deps);
  const interrupted = records.filter((record) =>
    TRANSIENT_STATES.includes(record.runtimeState),
  );
  if (interrupted.length === 0) return records;

  const now = deps.platform.nowIso();
  const reconciled: InstalledExtensionRecord[] = [];

  for (const record of records) {
    if (!TRANSIENT_STATES.includes(record.runtimeState)) {
      reconciled.push(record);
      continue;
    }
    const wasUninstalling = record.runtimeState === "uninstalling";
    const destination = pluginDir(deps.paths, record.id);
    const hasPackage = await deps.platform.exists(destination, "directory");
    const rawManifest = hasPackage
      ? await deps.platform.readText(`${destination}/${PLUGIN_MANIFEST_NAME}`)
      : null;

    let manifest: AcodePluginManifest | null = null;
    if (rawManifest) {
      try {
        manifest = parsePluginManifest(rawManifest);
      } catch {
        manifest = null;
      }
    }

    if (!manifest || manifest.id !== record.id) {
      if (wasUninstalling) continue; // The removal did complete.
      reconciled.push({
        ...record,
        enabled: false,
        runtimeError: `An ${record.runtimeState} operation was interrupted and the package on disk is unreadable. Reinstall or roll back, then enable it again.`,
        runtimeState: "broken",
        updatedAt: now,
      });
      continue;
    }

    // The package on disk is valid, so adopt it: version, manifest, and the
    // state implied by the user's enable choice.
    const entrySource = await deps.platform
      .readText(`${destination}/${manifest.main}`)
      .catch(() => null);
    reconciled.push({
      ...record,
      compatibility: evaluateCompatibility(manifest, entrySource),
      manifest: manifest.raw,
      runtimeState: record.enabled ? "enabled" : "disabled",
      updatedAt: now,
      version: manifest.version,
    });
  }

  await saveInstalledRecords(deps, reconciled);
  return reconciled;
}

/**
 * Uninstall (§47): removes the package tree and the plugin's isolated
 * data directories, then drops the record. Related Ajiro data is never
 * touched because every path derives from the sanitized plugin id.
 */
export async function uninstallPackage(
  deps: InstallDeps,
  pluginId: string,
): Promise<void> {
  const platform = deps.platform;
  const id = validatePluginId(pluginId);
  const destination = pluginDir(deps.paths, id);

  // Mark the removal in flight (§52): if the process dies mid-delete, the
  // next reconciliation finishes the job instead of leaving a half-deleted
  // package that looks installed.
  const beforeUninstall = await loadInstalledRecords(deps);
  if (beforeUninstall.some((record) => record.id === id)) {
    await saveInstalledRecords(
      deps,
      patchRecord(beforeUninstall, id, { runtimeState: "uninstalling" }, platform.nowIso()),
    );
  }

  if (await platform.exists(destination, "directory")) {
    await platform.deleteEntry(destination, "directory");
  }
  for (const kind of ["cache", "settings", "storage"] as const) {
    const dataDir = pluginDataDir(deps.paths, id, kind);
    if (await platform.exists(dataDir, "directory")) {
      await platform.deleteEntry(dataDir, "directory");
    }
  }
  const records = await loadInstalledRecords(deps);
  await saveInstalledRecords(
    deps,
    records.filter((record) => record.id !== id),
  );
  await discardRollbackPoint(deps, id);
}

/** True when a retained previous version is available to restore (§33). */
export async function hasRollbackPoint(
  deps: InstallDeps,
  pluginId: string,
): Promise<boolean> {
  const id = validatePluginId(pluginId);
  return deps.platform.exists(rollbackPointDir(deps.paths, id), "directory");
}

/** Drop a retained rollback point (after a version proved it activates). */
export async function discardRollbackPoint(
  deps: InstallDeps,
  pluginId: string,
): Promise<void> {
  const id = validatePluginId(pluginId);
  const point = rollbackPointDir(deps.paths, id);
  if (await deps.platform.exists(point, "directory")) {
    await deps.platform.deleteEntry(point, "directory");
  }
}

/**
 * Roll back to the version kept by a previous update (§33). The restored
 * package is re-validated (manifest + entry point) before it becomes the
 * live install, and the discarded version is deleted — never the reverse
 * of an atomic install: the rollback point is moved into place first and
 * only removed from the tree after it lands.
 */
export async function rollbackPackage(
  deps: InstallDeps,
  pluginId: string,
): Promise<InstalledExtensionRecord> {
  const platform = deps.platform;
  const id = validatePluginId(pluginId);
  const point = rollbackPointDir(deps.paths, id);
  if (!(await platform.exists(point, "directory"))) {
    throw new InstallerError(`Extension "${id}" has no version to roll back to.`);
  }
  const rawManifest = await platform.readText(`${point}/${PLUGIN_MANIFEST_NAME}`);
  const manifest = parsePluginManifest(rawManifest ?? "");
  if (manifest.id !== id) {
    throw new InstallerError(
      `Rollback point belongs to "${manifest.id}", not "${id}".`,
    );
  }

  const now = platform.nowIso();
  const destination = pluginDir(deps.paths, id);
  const discard = stagingDir(
    deps.paths,
    `${sanitizePluginId(id)}-rolled-back-${now.replace(/[^0-9]/g, "")}`,
  );
  const hadCurrent = await platform.exists(destination, "directory");
  await platform.makeDirectory(deps.paths.stagingRoot);
  if (hadCurrent) await platform.moveEntry(destination, discard, "directory");
  try {
    await platform.moveEntry(point, destination, "directory");
  } catch (error) {
    if (hadCurrent) await platform.moveEntry(discard, destination, "directory");
    throw error;
  }
  if (hadCurrent) {
    await platform.deleteEntry(discard, "directory").catch(() => {});
  }

  const records = await loadInstalledRecords(deps);
  const existing = records.find((record) => record.id === id);
  if (!existing) {
    throw new InstallerError(`Extension "${id}" is not installed.`);
  }
  const entrySource = await platform.readText(`${destination}/${manifest.main}`);
  const record: InstalledExtensionRecord = {
    ...existing,
    compatibility: evaluateCompatibility(manifest, entrySource),
    // The code changed underneath the user, so the restored version is not
    // live until it is enabled again.
    enabled: false,
    // The rolled-back bytes are an extracted tree, not the original
    // archive, so the previous package hash no longer describes them — and
    // neither does any verdict computed over a downloaded archive.
    packageSha256: null,
    signature: null,
    runtimeError: null,
    runtimeState: "disabled",
    updatedAt: now,
    version: manifest.version,
  };
  await saveInstalledRecords(
    deps,
    records.map((item) => (item.id === id ? record : item)),
  );
  return record;
}



