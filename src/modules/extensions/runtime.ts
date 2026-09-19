/**
 * Acode compatibility runtime (prompt §35-§44, §52, §72-73).
 *
 * Exposes the documented Acode global API surface — `globalThis.acode`
 * (and `window.acode` where the host defines a `window`) — with the real
 * lifecycle semantics from Acode's loadPlugin/acode sources
 * ([OPEN-SOURCE, MIT]):
 *
 * - setPluginInit(id, cb, settings?): cb runs during activation with
 *   Acode's positional arguments `(baseUrl, $page, cache)` — verified against
 *   the global API documentation (docs.acode.app/docs/global-apis/acode).
 * - setPluginUnmount(id, cb): cb runs on disable/update/uninstall.
 * - A plugin that throws or hangs while initializing is marked broken AND
 *   auto-disabled, mirroring Acode's loadPlugins.js (`markPluginBroken`),
 *   so it is never retried in a loop until the user intervenes.
 * - define/require: module registry with protected core names.
 * - waitForPlugin(id): resolves `true` after successful activation;
 *   rejects for missing/disabled/broken/uninstalled plugins.
 * - installPlugin(id): routed through an authorized install handler —
 *   without one it refuses, so third-party code can never silently
 *   install other extensions (§42).
 * - clearBrokenPluginMark(id): controlled retry after a crash.
 * - unmountPlugin(id): framework-side unmount (Acode's disable flow).
 *
 * Every plugin callback runs behind crash isolation: a throw — or a hang
 * longer than the load timeout Acode uses (15s) — marks the plugin broken
 * (persisted in its record), auto-disables it, stops auto-load retries, and
 * leaves the app fully functional (§52/§72).
 *
 * Entry scripts (§35, §48, §49): Hermes has no DOM and no eval, so plugin
 * entry JavaScript executes inside the plugin host document — one
 * `react-native-webview` whose runtime is `dom/dom-runtime-script.ts`. This
 * class talks to it through the `PluginExecutionHost` seam, which keeps the
 * runtime free of React Native imports and unit-testable on node. With no
 * document mounted, an entry-script plugin is *not* reported as loaded: the
 * failure is raised as an environment error, which leaves the plugin
 * disabled and retryable instead of marking it broken.
 */
import { emitExtensionEvent } from "./events";
import {
  loadInstalledRecords,
  patchRecord,
  reconcileInterruptedOperations,
  saveInstalledRecords,
  type InstallDeps,
} from "./installer";
import { pluginDataDir, pluginDir } from "./storage";
import {
  parseAceSnippets,
  snippetLanguagesForFile,
} from "@/modules/intel/ace-snippets";
import { isSafePluginPath } from "./dom/bridge-protocol";
import {
  clearPluginSnippets,
  setPluginSnippets,
  type PluginSnippetContribution,
} from "./plugin-snippets";
import type {
  ExtensionDiagnostic,
  ExtensionPermissionKey,
  InstalledExtensionRecord,
  PluginRuntimeState,
} from "./models";

/** Bounds so a hostile package cannot flood completions. */
const MAX_SNIPPET_FILES_PER_PLUGIN = 64;
const MAX_SNIPPETS_PER_PLUGIN = 2000;

/**
 * Core module names plugins may require but never overwrite (§40). Ajiro
 * does not ship Acode's implementations of these modules, so requiring one
 * fails loudly instead of handing back a stub that pretends to work.
 */
export const RESERVED_CORE_MODULES = [
  "app",
  "commands",
  "editor",
  "filesystem",
  "settings",
  "storage",
] as const;

/** Acode's plugin load timeout (loadPlugins.js: PLUGIN_LOAD_TIMEOUT). */
export const DEFAULT_PLUGIN_INIT_TIMEOUT_MS = 15_000;

/**
 * Theme-plugin identifiers (Acode's `loadPlugins.js` THEME_IDENTIFIERS,
 * [OPEN-SOURCE, MIT]). Acode loads theme plugins before everything else, so
 * a theme is in place before plugins that read theme state initialize.
 * Detection is a case-insensitive substring match on the plugin id, exactly
 * like Acode's `isThemePlugin`.
 */
export const THEME_PLUGIN_IDENTIFIERS: readonly string[] = [
  "theme",
  "catppuccin",
  "pine",
  "githubdark",
  "radiant",
  "rdtheme",
  "ayumirage",
  "dust",
  "synthwave",
  "dragon",
  "mint",
  "monokai",
  "lumina_code",
  "sweet",
  "moonlight",
  "bluloco",
  "acode.plugin.extra_syntax_highlights",
  "documentsviewer",
];

/** Case-insensitive substring match on the plugin id, like Acode. */
export function isThemePluginId(pluginId: string): boolean {
  const id = pluginId.toLowerCase();
  return THEME_PLUGIN_IDENTIFIERS.some((identifier) => id.includes(identifier));
}

/**
 * Third argument Acode passes to a plugin's init callback. `cacheFile` and
 * `fileIcons` are explicitly `null`: this runtime has no DOM-backed page and
 * no file-icon API, and pretending otherwise would break plugins later and
 * less legibly.
 */
export type PluginInitCache = {
  cacheFile: null;
  cacheFileUrl: string | null;
  firstInit: boolean;
  fileIcons: null;
};

/**
 * Acode's init signature: `init(baseUrl, $page, cache)` where `$page` is a
 * WC​Page. Ajiro passes `null` for the page; see the compatibility report.
 */
export type PluginInitCallback = (
  baseUrl: string,
  page: null,
  cache: PluginInitCache,
) => void | Promise<void>;

type PluginRuntimeEntry = {
  callbacksInit: Map<string, PluginInitCallback>;
  callbacksUnmount: Map<string, () => void | Promise<void>>;
  /** Settings declaration passed to setPluginInit (Acode's 3rd argument). */
  initSettings: unknown;
  resources: Map<string, () => void>;
  state: PluginRuntimeState;
  waiters: ((error: Error | null) => void)[];
};

export class AcodeRuntimeError extends Error {
  /**
   * True when Ajiro — not the plugin — is why activation failed (no plugin
   * host document mounted, for example). Environment failures must never be
   * recorded as a plugin crash, or a plugin would be auto-disabled for a
   * fault that is ours.
   */
  readonly environment: boolean;

  constructor(message: string, options: { environment?: boolean } = {}) {
    super(message);
    this.name = "AcodeRuntimeError";
    this.environment = options.environment ?? false;
  }
}

/**
 * The runtime state a persisted record implies. Transient states survive the
 * mirror so an in-flight operation is never displayed as settled.
 */
function recordToRuntimeState(record: InstalledExtensionRecord): PluginRuntimeState {
  if (record.runtimeState === "broken") return "broken";
  if (
    record.runtimeState === "installing" ||
    record.runtimeState === "updating" ||
    record.runtimeState === "uninstalling"
  ) {
    return record.runtimeState;
  }
  return record.enabled ? "enabled" : "disabled";
}

/**
 * Pluggable execution host for plugin entry scripts (prompt §35/§48/§49).
 *
 * React Native's Hermes engine has no DOM and no dynamic code execution, so
 * entry scripts can only run inside the plugin host document (see
 * `dom/plugin-host.ts`). The runtime delegates to whatever host is registered
 * and stays free of React Native imports; when no host is registered, plugin
 * activation falls back to the declarative path with an explicit diagnostic.
 */
export interface PluginExecutionHost {
  activate(pluginId: string, options: { firstInit: boolean }): Promise<void>;
  load(
    pluginId: string,
    options: {
      baseUrl: string;
      grantedPermissions: ExtensionPermissionKey[];
      settings: Record<string, unknown>;
      source: string;
      storage: Record<string, unknown>;
    },
  ): Promise<void>;
  unmount(pluginId: string): Promise<void>;
}

function entry(): PluginRuntimeEntry {
  return {
    callbacksInit: new Map(),
    callbacksUnmount: new Map(),
    initSettings: null,
    resources: new Map(),
    state: "not-installed",
    waiters: [],
  };
}

export class ExtensionRuntime {
  private readonly modules = new Map<string, unknown>();
  private readonly plugins = new Map<string, PluginRuntimeEntry>();
  private readonly diagnostics: ExtensionDiagnostic[] = [];
  private readonly initTimeoutMs: number;
  private executionHost: PluginExecutionHost | null = null;
  private pluginStoreReaders: {
    readPluginData(
      pluginId: string,
      kind: "cache" | "settings" | "storage",
    ): Promise<Record<string, unknown>>;
  } | null = null;
  private installRequestHandler: ((pluginId: string) => Promise<void>) | null = null;

  constructor(
    private readonly deps: InstallDeps | null = null,
    options: { initTimeoutMs?: number } = {},
  ) {
    this.initTimeoutMs = options.initTimeoutMs ?? DEFAULT_PLUGIN_INIT_TIMEOUT_MS;
  }

  /** Register the authorized install handler (store UI consent flow). */
  setInstallRequestHandler(handler: ((pluginId: string) => Promise<void>) | null): void {
    this.installRequestHandler = handler;
  }

  /**
   * Register the DOM execution host. Called by the plugin host surface while
   * it is mounted; plugins with entry scripts execute there when available.
   */
  setExecutionHost(host: PluginExecutionHost | null): void {
    this.executionHost = host;
  }

  hasExecutionHost(): boolean {
    return this.executionHost !== null;
  }

  /**
   * Re-run every live extension inside a freshly mounted plugin document.
   * The webview's own state dies with the document, so an enabled plugin that
   * ships an entry script must be re-defined and re-initialized (Acode does
   * the same when it reloads plugins). Failures are recorded, never thrown:
   * one plugin that cannot restart must not stop the others.
   */
  async restoreActivePlugins(): Promise<void> {
    if (!this.deps || !this.executionHost) return;
    const records = await loadInstalledRecords(this.deps);
    // Acode loads theme plugins before everything else (loadPlugins.js), so
    // a theme is in place before plugins that read theme state initialize.
    const ordered = [...records].sort(
      (left, right) => Number(isThemePluginId(right.id)) - Number(isThemePluginId(left.id)),
    );
    for (const record of ordered) {
      if (!record.enabled || record.runtimeState === "broken") continue;
      const source = await this.readEntrySource(record);
      if (!source) continue;
      try {
        await this.activate(record.id, { firstInit: false });
      } catch (error) {
        this.log(
          record.id,
          "error",
          `Could not restart after the plugin runtime document reloaded: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  /** Entry source for a plugin, read from its installed package. */
  private async readEntrySource(
    record: InstalledExtensionRecord,
  ): Promise<string | null> {
    if (!this.deps) return null;
    const main = typeof record.manifest.main === "string" ? record.manifest.main : null;
    if (!main) return null;
    const base = pluginDir(this.deps.paths, record.id);
    return this.deps.platform.readText(`${base}/${main}`);
  }

  /**
   * Snippet sync: parse the package's `.snippets` data files into the
   * plugin snippet store so completions offer them with zero setup.
   * Best-effort and bounded — a corrupt file is skipped, never fatal.
   */
  private async syncPluginSnippets(
    record: InstalledExtensionRecord,
  ): Promise<void> {
    if (!this.deps) return;
    const files = record.manifest.files;
    if (!Array.isArray(files)) return;
    const base = pluginDir(this.deps.paths, record.id);
    const contributions: PluginSnippetContribution[] = [];
    let filesRead = 0;
    for (const file of files) {
      if (typeof file !== "string") continue;
      if (!file.toLowerCase().endsWith(".snippets")) continue;
      if (!isSafePluginPath(file)) continue;
      if (filesRead >= MAX_SNIPPET_FILES_PER_PLUGIN) break;
      filesRead += 1;
      let text: string | null;
      try {
        text = await this.deps.platform.readText(`${base}/${file}`);
      } catch {
        continue;
      }
      if (text === null) continue;
      const languageIds = snippetLanguagesForFile(file);
      for (const snippet of parseAceSnippets(text)) {
        if (contributions.length >= MAX_SNIPPETS_PER_PLUGIN) break;
        contributions.push({
          body: snippet.body,
          description: snippet.description,
          id: `${record.id}:${snippet.trigger}`,
          languageIds,
          prefix: snippet.trigger,
        });
      }
    }
    setPluginSnippets(record.id, contributions);
  }

  private pluginEntry(pluginId: string): PluginRuntimeEntry {
    let found = this.plugins.get(pluginId);
    if (!found) {
      found = entry();
      this.plugins.set(pluginId, found);
    }
    return found;
  }

  private log(pluginId: string, level: ExtensionDiagnostic["level"], message: string): void {
    this.diagnostics.push({ at: new Date().toISOString(), level, message, pluginId });
    if (this.diagnostics.length > 500) this.diagnostics.shift();
  }

  getDiagnostics(pluginId?: string): ExtensionDiagnostic[] {
    return pluginId
      ? this.diagnostics.filter((entry) => entry.pluginId === pluginId)
      : [...this.diagnostics];
  }

  getState(pluginId: string): PluginRuntimeState {
    return this.pluginEntry(pluginId).state;
  }

  async refreshStateFromRecords(): Promise<void> {
    if (!this.deps) return;
    // Reconcile first: an interrupted install/update/uninstall is repaired
    // (or explained) before its state is mirrored into memory (§52).
    const records = await reconcileInterruptedOperations(this.deps);
    for (const record of records) {
      const pluginEntry = this.pluginEntry(record.id);
      pluginEntry.state = recordToRuntimeState(record);
    }
  }

  /** Activate a plugin (§35): load → initialize → loaded, with isolation. */
  async activate(pluginId: string, options: { firstInit?: boolean } = {}): Promise<void> {
    const pluginEntry = this.pluginEntry(pluginId);
    if (pluginEntry.state === "broken") {
      throw new AcodeRuntimeError(
        `Plugin "${pluginId}" is marked broken; clear the broken mark before retrying.`,
      );
    }
    const record = await this.loadRecord(pluginId);
    if (!record) {
      throw new AcodeRuntimeError(`Plugin "${pluginId}" is not installed.`);
    }
    if (!record.enabled) {
      throw new AcodeRuntimeError(`Plugin "${pluginId}" is disabled.`);
    }

    pluginEntry.state = "loading";
    const baseUrl = this.deps ? pluginDir(this.deps.paths, pluginId) : "";
    const cache: PluginInitCache = {
      cacheFile: null,
      cacheFileUrl: null,
      firstInit: options.firstInit ?? false,
      fileIcons: null,
    };

    try {
      const entrySource = await this.readEntrySource(record);
      if (entrySource && this.executionHost) {
        // Real Acode behavior: the entry script runs in a DOM and registers
        // its own init callback, which the host then invokes.
        await this.runWithTimeout(pluginId, "initialization", async () => {
          await this.executionHost?.load(pluginId, {
            baseUrl,
            grantedPermissions: record.permissions.map((grant) => grant.key),
            settings: (await this.readSettingsStore(pluginId)).settings,
            source: entrySource,
            storage: (await this.readSettingsStore(pluginId)).storage,
          });
          await this.executionHost?.activate(pluginId, {
            firstInit: options.firstInit ?? false,
          });
        });
      } else if (entrySource) {
        // Refusing here is deliberate (§35/§52/§82): reporting a plugin as
        // loaded when its entry script never ran would be a lie. The failure
        // is marked as environmental so the plugin is not blamed for it.
        throw new AcodeRuntimeError(
          "The plugin runtime document is not mounted, so this plugin's entry script cannot execute. Open Ajiro with the extension platform active and try again.",
          { environment: true },
        );
      } else {
        const initCallback = pluginEntry.callbacksInit.get(pluginId);
        if (initCallback) {
          await this.runWithTimeout(
            pluginId,
            "initialization",
            async () => initCallback(baseUrl, null, cache),
          );
        } else {
          this.log(
            pluginId,
            "warning",
            "No init callback registered. The plugin was activated declaratively.",
          );
        }
      }
      try {
        await this.syncPluginSnippets(record);
      } catch (error) {
        this.log(
          pluginId,
          "warning",
          `Snippet sync skipped: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      pluginEntry.state = "loaded";
      this.resolveWaiters(pluginId, null);
      await this.persistRuntimeState(pluginId, "loaded", null, { enabled: true });
      emitExtensionEvent({ pluginId, type: "enabled" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof AcodeRuntimeError && error.environment) {
        // Our fault, not the plugin's: leave it disabled and retryable.
        pluginEntry.state = "disabled";
        this.log(pluginId, "error", `Not activated: ${message}`);
        this.resolveWaiters(pluginId, new AcodeRuntimeError(message));
        await this.persistRuntimeState(pluginId, "disabled", message, {
          enabled: false,
        });
        throw error;
      }
      // Crash isolation (§72): mark broken, never crash the host. Acode also
      // auto-disables a broken plugin (loadPlugins.js markPluginBroken) so no
      // reload loop can start; the user re-enables it deliberately (§52).
      pluginEntry.state = "broken";
      this.log(pluginId, "error", `Initialization failed: ${message}`);
      this.resolveWaiters(pluginId, new AcodeRuntimeError(message));
      await this.persistRuntimeState(pluginId, "broken", message, {
        enabled: false,
      });
      emitExtensionEvent({ message, pluginId, type: "broken" });
      throw new AcodeRuntimeError(`Plugin "${pluginId}" failed to initialize: ${message}`);
    }
  }

  /**
   * Run a plugin callback under Acode's load timeout. A plugin that never
   * settles must not pin activation open forever.
   */
  private async runWithTimeout(
    pluginId: string,
    label: string,
    run: () => Promise<void>,
  ): Promise<void> {
    if (!Number.isFinite(this.initTimeoutMs) || this.initTimeoutMs <= 0) {
      await run();
      return;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      await Promise.race([
        run(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            reject(
              new AcodeRuntimeError(
                `Plugin "${pluginId}" ${label} did not finish within ${this.initTimeoutMs} ms.`,
              ),
            );
          }, this.initTimeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Plugin-private persisted stores, hydrated into the document at load. */
  private async readSettingsStore(
    pluginId: string,
  ): Promise<{ settings: Record<string, unknown>; storage: Record<string, unknown> }> {
    const empty = { settings: {}, storage: {} };
    if (!this.deps) return empty;
    if (!this.pluginStoreReaders) return empty;
    try {
      const [settings, storage] = await Promise.all([
        this.pluginStoreReaders.readPluginData(pluginId, "settings"),
        this.pluginStoreReaders.readPluginData(pluginId, "storage"),
      ]);
      return { settings, storage };
    } catch {
      return empty;
    }
  }

  /** Wire plugin-private storage reads (the same reader the host uses). */
  setPluginStoreReader(
    reader: {
      readPluginData(
        pluginId: string,
        kind: "cache" | "settings" | "storage",
      ): Promise<Record<string, unknown>>;
    } | null,
  ): void {
    this.pluginStoreReaders = reader;
  }

  /** Deactivate (disable/update/uninstall): unmount + cleanup (§38/§73). */
  async deactivate(pluginId: string): Promise<void> {
    const pluginEntry = this.pluginEntry(pluginId);
    // Snippets leave with the plugin: disable/update/uninstall all funnel
    // through here, so completions can never offer stale snippets.
    clearPluginSnippets(pluginId);
    // Unload the entry script from the DOM document first: it owns the
    // webview-side timers, listeners, pages, and commands of this plugin.
    if (this.executionHost) {
      await this.executionHost.unmount(pluginId).catch(() => {});
    }
    // Acode's unmount always deletes the plugin's cache directory; settings
    // and storage survive (only uninstall removes those). Cache is
    // disposable by definition, so a failure here never fails deactivation.
    if (this.deps) {
      await this.deps.platform
        .deleteEntry(pluginDataDir(this.deps.paths, pluginId, "cache"), "directory")
        .catch(() => {});
    }
    for (const cleanup of pluginEntry.callbacksUnmount.values()) {
      try {
        await cleanup();
      } catch (error) {
        this.log(
          pluginId,
          "error",
          `Unmount callback failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    pluginEntry.callbacksUnmount.clear();
    pluginEntry.callbacksInit.clear();
    for (const cleanup of pluginEntry.resources.values()) {
      try {
        cleanup();
      } catch {
        // Resource cleanup is best-effort.
      }
    }
    pluginEntry.resources.clear();
    if (pluginEntry.state !== "broken") {
      pluginEntry.state = "disabled";
      emitExtensionEvent({ pluginId, type: "disabled" });
    }
  }

  /** Persist runtime state into the installed record (broken marks etc.). */
  private async persistRuntimeState(
    pluginId: string,
    state: PluginRuntimeState,
    error: string | null,
    extra: Partial<InstalledExtensionRecord> = {},
  ): Promise<void> {
    if (!this.deps) return;
    const records = await loadInstalledRecords(this.deps);
    if (!records.some((record) => record.id === pluginId)) return;
    const now = this.deps.platform.nowIso();
    await saveInstalledRecords(
      this.deps,
      patchRecord(
        records,
        pluginId,
        { ...extra, runtimeError: error, runtimeState: state },
        now,
      ),
    );
  }

  private async loadRecord(pluginId: string): Promise<InstalledExtensionRecord | null> {
    if (!this.deps) return null;
    const records = await loadInstalledRecords(this.deps);
    return records.find((record) => record.id === pluginId) ?? null;
  }

  private resolveWaiters(pluginId: string, error: Error | null): void {
    const pluginEntry = this.pluginEntry(pluginId);
    const waiters = pluginEntry.waiters;
    pluginEntry.waiters = [];
    for (const waiter of waiters) waiter(error);
  }

  trackResource(pluginId: string, key: string, cleanup: () => void): void {
    this.pluginEntry(pluginId).resources.set(key, cleanup);
  }

  /** Settings declaration a plugin registered through setPluginInit (§59). */
  getPluginSettings(pluginId: string): unknown {
    return this.pluginEntry(pluginId).initSettings;
  }

  async waitForPlugin(pluginId: string): Promise<boolean> {
    let state = this.getState(pluginId);
    if (state === "not-installed") {
      // In-memory state may be cold; consult the installed records.
      const record = await this.loadRecord(pluginId);
      if (record) {
        state = recordToRuntimeState(record);
        this.pluginEntry(pluginId).state = state;
      }
    }
    if (state === "broken") {
      throw new AcodeRuntimeError(`Plugin "${pluginId}" is broken.`);
    }
    if (state === "not-installed") {
      throw new AcodeRuntimeError(`Plugin "${pluginId}" does not exist.`);
    }
    // Acode documents waitForPlugin as Promise<boolean>: true once loaded.
    if (state === "loaded") return true;
    await new Promise<void>((resolve, reject) => {
      this.pluginEntry(pluginId).waiters.push((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    return true;
  }

  async clearBrokenPluginMark(pluginId: string): Promise<void> {
    const pluginEntry = this.pluginEntry(pluginId);
    pluginEntry.state = "disabled";
    this.log(pluginId, "info", "Broken plugin mark cleared; retry allowed.");
    await this.persistRuntimeState(pluginId, "disabled", null);
    emitExtensionEvent({ pluginId, type: "recovered" });
  }

  /** Acode global API implementation (§36-§43). */
  buildAcodeGlobal(): AcodeGlobal {
    return {
      clearBrokenPluginMark: (pluginId: string) =>
        this.clearBrokenPluginMark(pluginId),

      define: (name: string, module: unknown) => {
        if (typeof name !== "string" || !name.trim()) {
          throw new AcodeRuntimeError("acode.define requires a module name.");
        }
        // Acode documents module names as case insensitive.
        const key = name.trim().toLowerCase();
        if (isReservedModule(key)) {
          throw new AcodeRuntimeError(
            `"${name}" is a reserved core module and cannot be replaced.`,
          );
        }
        this.modules.set(key, module);
      },

      installPlugin: async (pluginId: string, _installerPluginName?: string) => {
        if (!this.installRequestHandler) {
          throw new AcodeRuntimeError(
            "Plugin installation requests require user authorization; no handler is registered.",
          );
        }
        await this.installRequestHandler(pluginId);
      },

      require: (name: string): unknown => {
        const key = name.trim().toLowerCase();
        if (isReservedModule(key)) {
          throw new AcodeRuntimeError(
            `The core module "${name}" is not provided by this runtime. See the Acode compatibility report for the supported API surface.`,
          );
        }
        return this.modules.get(key);
      },

      setPluginInit: (
        pluginId: string,
        callback: PluginInitCallback,
        settings?: unknown,
      ) => {
        if (typeof callback !== "function") {
          throw new AcodeRuntimeError("acode.setPluginInit requires a function.");
        }
        const pluginEntry = this.pluginEntry(pluginId);
        pluginEntry.callbacksInit.set(pluginId, callback);
        pluginEntry.initSettings = settings ?? null;
      },

      setPluginUnmount: (pluginId: string, callback: () => void | Promise<void>) => {
        if (typeof callback !== "function") {
          throw new AcodeRuntimeError("acode.setPluginUnmount requires a function.");
        }
        this.pluginEntry(pluginId).callbacksUnmount.set(pluginId, callback);
      },

      unmountPlugin: (pluginId: string) => {
        void this.deactivate(pluginId);
      },

      waitForPlugin: (pluginId: string) => this.waitForPlugin(pluginId),
    };
  }
}

/**
 * Install `globalThis.acode` (and `window.acode` when a window exists).
 * Idempotent: repeated calls reuse the first runtime instance.
 */
let installedRuntime: ExtensionRuntime | null = null;

export function installAcodeRuntime(runtime?: ExtensionRuntime): ExtensionRuntime {
  if (installedRuntime && !runtime) return installedRuntime;
  const instance = runtime ?? installedRuntime ?? new ExtensionRuntime();
  const acodeGlobal = instance.buildAcodeGlobal();
  globalThis.acode = acodeGlobal;
  const windowRef = (globalThis as unknown as { window?: { acode?: AcodeGlobal } }).window;
  if (windowRef) windowRef.acode = acodeGlobal;
  installedRuntime = instance;
  return instance;
}

export function getAcodeRuntime(): ExtensionRuntime | null {
  return installedRuntime;
}

export type AcodeGlobal = {
  /**
   * Acode declares this as sync `void`; returning a promise is a superset
   * that also lets callers await the persisted state change.
   */
  clearBrokenPluginMark(pluginId: string): Promise<void>;
  define(name: string, module: unknown): void;
  installPlugin(pluginId: string, installerPluginName?: string): Promise<void>;
  require(name: string): unknown;
  setPluginInit(
    pluginId: string,
    callback: PluginInitCallback,
    settings?: unknown,
  ): void;
  setPluginUnmount(pluginId: string, callback: () => void | Promise<void>): void;
  unmountPlugin(pluginId: string): void;
  waitForPlugin(pluginId: string): Promise<boolean>;
};

function isReservedModule(name: string): boolean {
  return (RESERVED_CORE_MODULES as readonly string[]).includes(name);
}

declare global {
  var acode: AcodeGlobal | undefined;
}

