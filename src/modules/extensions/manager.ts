/**
 * Extension package manager (prompt §31/§33): the single entry point the UI
 * (and any future caller) uses for package + lifecycle operations, so record
 * persistence and the install→activate→rollback policy live in one place
 * instead of being re-implemented per screen.
 *
 * Policy encoded here:
 * - fresh installs auto-activate when they request no permissions or the
 *   user just granted them (zero-setup); updates never override the
 *   user's enable choice, and an update only re-activates when the
 *   extension was already enabled.
 * - updates retain the replaced version as a rollback point, which is
 *   dropped once the new version successfully activates (§32/§33).
 * - every operation returns the affected record so callers can render
 *   fresh state without a second storage read.
 * - dependency resolution is version-aware when the catalog knows versions,
 *   and installation is dependency-first (§53).
 * - reads reconcile interrupted operations first, so no caller ever sees a
 *   record that disagrees with what is on disk (§52).
 */
import {
  createExtensionHealthLog,
  type ExtensionHealthLog,
} from "@/modules/updates/extension-framework";
import {
  buildDependencyGraph,
  planDependencyInstall,
  type DependencyIssue,
  type DependencyPlan,
} from "./dependencies";
import { emitExtensionEvent } from "./events";
import {
  discardRollbackPoint,
  hasRollbackPoint as hasRollbackPointOnDisk,
  installPackage,
  patchRecord,
  reconcileInterruptedOperations,
  rollbackPackage,
  saveInstalledRecords,
  uninstallPackage,
  type InstallDeps,
  type InstallOptions,
  type InstallOutcome,
} from "./installer";
import type {
  ExtensionMetadata,
  ExtensionPackageSource,
  InstalledExtensionRecord,
} from "./models";
import type { RegistryProvider } from "./registry";
import type { ExtensionRuntime } from "./runtime";
import {
  DEFAULT_SIGNATURE_POLICY,
  signaturePolicyMessage,
  type SignaturePolicy,
} from "./signature";

export type RetryOptions = {
  /** Total attempts, including the first. Default 3. */
  attempts?: number;
  /** First backoff delay; doubles per retry. Default 400 ms. */
  baseDelayMs?: number;
  /** Injected for tests so no real time passes. */
  sleep?: (ms: number) => Promise<void>;
};

export type DependencyInstallResult = {
  /** Records of everything installed, dependencies first. */
  installed: InstalledExtensionRecord[];
  /** Plans issues that stopped the run, if any. */
  issues: DependencyIssue[];
};

export type ExtensionPackageManager = {
  /** Install (or reinstall) from any package source. */
  install(
    source: ExtensionPackageSource,
    options?: InstallOptions,
  ): Promise<InstallOutcome>;
  /**
   * Resolve an extension's dependency closure against the catalog and what
   * is installed (§53), returning an install order and any issues.
   */
  planInstall(pluginId: string): Promise<DependencyPlan>;
  /**
   * Install an extension together with the dependencies it needs, in
   * dependency-first order. Nothing is installed when the plan is blocked.
   */
  installWithDependencies(
    pluginId: string,
    options?: InstallOptions,
  ): Promise<DependencyInstallResult>;
  /** Update an installed extension from the registry. */
  update(pluginId: string, options?: InstallOptions): Promise<InstallOutcome>;
  /**
   * Update with bounded retry and exponential backoff (§33): a transient
   * network failure should not force the user to restart a batch update.
   */
  updateWithRetry(
    pluginId: string,
    options?: InstallOptions & RetryOptions,
  ): Promise<InstallOutcome>;
  /** Remove the package, its private data, and any rollback point. */
  uninstall(pluginId: string): Promise<void>;
  /** Restore the version replaced by the last update. */
  rollback(pluginId: string): Promise<InstalledExtensionRecord>;
  /** Enable and activate (§35): compatibility checks run during activation. */
  enable(pluginId: string): Promise<InstalledExtensionRecord>;
  /** Disable without uninstalling (§34): unmount + resource cleanup. */
  disable(pluginId: string): Promise<InstalledExtensionRecord>;
  /** Controlled retry after a plugin was marked broken (§43/§52). */
  clearBrokenMark(pluginId: string): Promise<InstalledExtensionRecord>;
  hasRollbackPoint(pluginId: string): Promise<boolean>;
  discardRollbackPoint(pluginId: string): Promise<void>;
  listInstalled(): Promise<InstalledExtensionRecord[]>;
  /**
   * Revocation sweep (§24): disable every installed extension the catalog
   * revoked, with a persisted reason. Returns the disabled ids. Safe to run
   * on every sync — already-disabled extensions are left alone.
   */
  reconcileRevoked(entries: ExtensionMetadata[]): Promise<string[]>;
};

export type ExtensionManagerConfig = {
  deps: InstallDeps;
  provider?: RegistryProvider | null;
  runtime: ExtensionRuntime;
  /**
   * Catalog metadata for dependency resolution. The Store wires this to its
   * persisted cache so planning never forces a network round trip.
   */
  catalog?: () => Promise<ExtensionMetadata[]>;
  /**
   * The signature policy in force (§51). The Store wires this to the user's
   * extension preferences, so a package is always judged by the trust store
   * that was in place when the user asked for it.
   */
  signaturePolicy?: () => Promise<SignaturePolicy>;
};

const DEFAULT_SLEEP = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Local-only install/update/rollback telemetry (§49, optional; the app has
 * no remote pipeline). Shared process-wide so the Store can surface recent
 * health without threading a log through every caller.
 */
const health: ExtensionHealthLog = createExtensionHealthLog();

export function extensionHealthLog(): ExtensionHealthLog {
  return health;
}

export function createExtensionManager({
  deps,
  provider = null,
  runtime,
  catalog,
  signaturePolicy,
}: ExtensionManagerConfig): ExtensionPackageManager {
  async function records(): Promise<InstalledExtensionRecord[]> {
    // Interrupted operations are reconciled before anything reads the
    // records, so every caller sees a state that matches disk (§52).
    return reconcileInterruptedOperations(deps);
  }

  /**
   * Policy for this operation, resolved fresh. A failed preference read must
   * not become a silent "trust everything": an unreadable policy means no
   * trusted keys, which can only ever *refuse* more, never verify more.
   */
  async function policy(): Promise<SignaturePolicy | undefined> {
    if (!signaturePolicy) return undefined;
    return signaturePolicy().catch(() => DEFAULT_SIGNATURE_POLICY);
  }

  /** Catalog entries for dependency planning: cache first, network second. */
  async function catalogEntries(): Promise<ExtensionMetadata[]> {
    if (catalog) {
      const cached = await catalog().catch(() => [] as ExtensionMetadata[]);
      if (cached.length > 0) return cached;
    }
    if (!provider) return [];
    const fetched = await provider.fetchCatalog().catch(() => null);
    return fetched?.entries ?? [];
  }

  async function patch(
    pluginId: string,
    changes: Partial<InstalledExtensionRecord>,
  ): Promise<InstalledExtensionRecord> {
    const current = await records();
    const existing = current.find((record) => record.id === pluginId);
    if (!existing) {
      throw new Error(`Extension "${pluginId}" is not installed.`);
    }
    const next = patchRecord(current, pluginId, changes, deps.platform.nowIso());
    await saveInstalledRecords(deps, next);
    return next.find((record) => record.id === pluginId) ?? existing;
  }

  const manager: ExtensionPackageManager = {
    async install(source, options = {}) {
      const before = await records();
      const installOnce = async (extra?: InstallOptions) =>
        installPackage(deps, source, {
          ...options,
          ...extra,
          catalog: await catalogEntries(),
          provider,
          signaturePolicy: await policy(),
        });
      let outcome: InstallOutcome;
      try {
        outcome = await installOnce();
      } catch (error) {
        health.record(
          "plugin",
          source.kind === "registry" ? source.pluginId : source.kind,
          "install-failure",
          error instanceof Error ? error.message : String(error),
        );
        throw error;
      }
      if (outcome.status === "needs-permissions") {
        // Zero-setup: tapping install grants the requested capabilities —
        // recorded in health and surfaced in the success notice, revocable
        // anytime by disabling. Signature, revocation, and native-cap
        // gates are unaffected (they resolve before permissions).
        const granted = outcome.pending;
        health.record(
          "plugin",
          outcome.manifest.id,
          "permissions-auto-granted",
          granted.join(", "),
        );
        try {
          outcome = await installOnce({ acceptedPermissions: granted });
        } catch (error) {
          health.record(
            "plugin",
            source.kind === "registry" ? source.pluginId : source.kind,
            "install-failure",
            error instanceof Error ? error.message : String(error),
          );
          throw error;
        }
      }
      if (outcome.status === "installed") {
        health.record("plugin", outcome.record.id, "install-success");
        // Surfaces (tab bar, records lists, snippet revisions) subscribe
        // to these lifecycle events; the manager is their single source.
        emitExtensionEvent({
          pluginId: outcome.record.id,
          type: "installed",
        });
        // Reconcile first: refreshStateFromRecords mirrors records into
        // memory, so it must run BEFORE activation below — otherwise it
        // would clobber the fresh "loaded" state back to "enabled".
        await runtime.refreshStateFromRecords();
        // Zero-setup activation: a fresh install activates immediately —
        // permissions auto-granted above — so its features (themes,
        // terminal snippets, editor tools, languages, pages) work with
        // no extra step. Updates never override the user's enable choice.
        const installedId = outcome.record.id;
        // Updates never override the user's enable choice — keyed by the
        // installed record id so file/URL reinstalls count as updates too.
        const isUpdate = before.some((record) => record.id === installedId);
        if (!isUpdate) {
          try {
            const enabled = await manager.enable(outcome.record.id);
            outcome = { record: enabled, status: "installed" };
            health.record(
              "plugin",
              outcome.record.id,
              "auto-enabled",
              "Plugin activated on install.",
            );
          } catch (error) {
            // Activation failed (e.g. broken entry script): roll back
            // to disabled so the record never claims a running plugin
            // that isn't, preserving whatever state activation set.
            const rolledBack = patchRecord(
              await records(),
              outcome.record.id,
              { enabled: false },
              deps.platform.nowIso(),
            );
            await saveInstalledRecords(deps, rolledBack).catch(() => {});
            // Records screens refresh off lifecycle events, not storage
            // polls: announce the rollback so no stale "enabled" lingers.
            emitExtensionEvent({
              pluginId: outcome.record.id,
              type: "disabled",
            });
            health.record(
              "plugin",
              outcome.record.id,
              "auto-enable-failed",
              error instanceof Error ? error.message : String(error),
            );
          }
        }
      } else if (outcome.status === "needs-app-update") {
        health.record(
          "plugin",
          outcome.manifest.id,
          "incompatible",
          `missing native: ${outcome.missingCapabilities.join(", ")}`,
        );
      }
      return outcome;
    },

    async planInstall(pluginId) {
      const installed = await records();
      const entries = await catalogEntries();
      const entry = entries.find((item) => item.id === pluginId);
      return planDependencyInstall(
        pluginId,
        buildDependencyGraph({
          catalog: entries,
          installed,
          root: entry ? { dependencies: entry.dependencies, id: entry.id } : undefined,
        }),
        { catalog: entries, installed },
      );
    },

    async installWithDependencies(pluginId, options = {}) {
      const plan = await manager.planInstall(pluginId);
      if (!plan.resolvable) {
        return { installed: [], issues: plan.issues };
      }
      const installed: InstalledExtensionRecord[] = [];
      // Dependencies first, then the requested extension (§53).
      for (const dependency of plan.installOrder) {
        try {
          const outcome = await manager.install(
            { kind: "registry", pluginId: dependency.id },
            options,
          );
          if (outcome.status !== "installed") {
            // Consent is a per-package decision, so a dependency that needs
            // approval stops the run instead of being forced through. So is a
            // refused signature: the user's policy applies to every package
            // in the closure, not only to the one they tapped (§51).
            return {
              installed,
              issues: [
                {
                  id: dependency.id,
                  kind: "failed",
                    message:
                      outcome.status === "needs-permissions"
                        ? "it requires permissions that have not been approved"
                        : outcome.status === "signature-rejected"
                          ? signaturePolicyMessage(outcome.verdict)
                          : outcome.status === "needs-app-update"
                            ? `it requires a newer Ajiro Agent (missing: ${outcome.missingCapabilities.join(", ")})`
                            : "it could not be installed",
                  requiredBy: pluginId,
                },
              ],
            };
          }
          installed.push(outcome.record);
        } catch (error) {
          // A thrown install (network, validation, disk) must not discard the
          // dependencies that already succeeded.
          return {
            installed,
            issues: [
              {
                id: dependency.id,
                kind: "failed",
                message: error instanceof Error ? error.message : String(error),
                requiredBy: pluginId,
              },
            ],
          };
        }
      }

      const outcome = await manager.install(
        { kind: "registry", pluginId },
        options,
      );
      if (outcome.status === "installed") installed.push(outcome.record);
      return { installed, issues: plan.issues };
    },

    async updateWithRetry(pluginId, options = {}) {
      const attempts = Math.max(1, options.attempts ?? 3);
      const baseDelayMs = options.baseDelayMs ?? 400;
      const sleep = options.sleep ?? DEFAULT_SLEEP;
      let lastError: unknown = null;
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
          return await manager.update(pluginId, options);
        } catch (error) {
          lastError = error;
          if (attempt < attempts) {
            // Exponential backoff: 400 ms, 800 ms, 1600 ms …
            await sleep(baseDelayMs * 2 ** (attempt - 1));
          }
        }
      }
      throw lastError instanceof Error
        ? lastError
        : new Error(`Updating "${pluginId}" failed after ${attempts} attempt(s).`);
    },

    async update(pluginId, options = {}) {
      const current = await records();
      const existing = current.find((record) => record.id === pluginId);
      if (!existing) {
        throw new Error(`Extension "${pluginId}" is not installed.`);
      }
      const source: ExtensionPackageSource = existing.sourceUrl
        ? { kind: "url", url: existing.sourceUrl }
        : { kind: "registry", pluginId };
      let outcome: InstallOutcome;
      try {
        outcome = await installPackage(deps, source, {
          ...options,
          catalog: await catalogEntries(),
          provider,
          // Keep the replaced version until the new one activates (§32).
          retainBackup: true,
          signaturePolicy: await policy(),
        });
      } catch (error) {
        health.record(
          "plugin",
          pluginId,
          "update-failure",
          error instanceof Error ? error.message : String(error),
        );
        throw error;
      }
      if (outcome.status !== "installed") return outcome;

      await runtime.refreshStateFromRecords();
      if (existing.enabled) {
        // Updating an enabled extension re-activates it: the user already
        // authorized this extension and explicitly asked for the update.
        await runtime.activate(pluginId, { firstInit: false });
        await discardRollbackPoint(deps, pluginId);
      }
      health.record("plugin", pluginId, "update-success");
      emitExtensionEvent({ pluginId, type: "updated" });
      return outcome;
    },

    async uninstall(pluginId) {
      await runtime.deactivate(pluginId).catch(() => {});
      await uninstallPackage(deps, pluginId);
      await runtime.refreshStateFromRecords();
      emitExtensionEvent({ pluginId, type: "uninstalled" });
    },

    async rollback(pluginId) {
      // Unmount the failed version before its files are replaced.
      await runtime.deactivate(pluginId).catch(() => {});
      try {
        const record = await rollbackPackage(deps, pluginId);
        await runtime.refreshStateFromRecords();
        health.record("plugin", pluginId, "rollback");
        emitExtensionEvent({ pluginId, type: "rolled-back" });
        return record;
      } catch (error) {
        health.record(
          "plugin",
          pluginId,
          "update-failure",
          `rollback failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        throw error;
      }
    },

    async enable(pluginId) {
      const record = await patch(pluginId, {
        enabled: true,
        runtimeState: "enabled",
      });
      await runtime.activate(pluginId);
      // The new version activated successfully, so the rollback point for
      // the version it replaced is no longer needed.
      await discardRollbackPoint(deps, pluginId);
      return (await records()).find((item) => item.id === pluginId) ?? record;
    },

    async disable(pluginId) {
      await runtime.deactivate(pluginId);
      return patch(pluginId, { enabled: false, runtimeState: "disabled" });
    },

    async clearBrokenMark(pluginId) {
      // The runtime clears the persisted mark itself, so re-read afterwards.
      await runtime.clearBrokenPluginMark(pluginId);
      const record = (await records()).find((item) => item.id === pluginId);
      if (!record) {
        throw new Error(`Extension "${pluginId}" is not installed.`);
      }
      return record;
    },

    hasRollbackPoint(pluginId) {
      return hasRollbackPointOnDisk(deps, pluginId);
    },

    discardRollbackPoint(pluginId) {
      return discardRollbackPoint(deps, pluginId);
    },

    listInstalled: records,

    async reconcileRevoked(entries) {
      const current = await records();
      const revoked = new Set(
        entries.filter((entry) => entry.revoked).map((entry) => entry.id),
      );
      const disabled: string[] = [];
      // Accumulate onto one list: patching the stale pre-loop snapshot and
      // saving per iteration would let each save overwrite the previous
      // disable, leaving only the last revoked extension disabled.
      let next = current;
      for (const record of current) {
        if (!revoked.has(record.id) || !record.enabled) continue;
        await runtime.deactivate(record.id).catch(() => {});
        next = patchRecord(
          next,
          record.id,
          {
            enabled: false,
            runtimeError: "Revoked by the registry.",
            runtimeState: "disabled",
          },
          deps.platform.nowIso(),
        );
        health.record("plugin", record.id, "revoked", "Disabled by revocation sweep.");
        disabled.push(record.id);
      }
      if (disabled.length > 0) {
        await saveInstalledRecords(deps, next);
      }
      await runtime.refreshStateFromRecords();
      return disabled;
    },
  };

  return manager;
}
