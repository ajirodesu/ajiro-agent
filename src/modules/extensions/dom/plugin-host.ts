/**
 * Host side of the plugin DOM runtime (prompt §35-§50, §72-§73).
 *
 * This class owns the conversation between React Native and the plugin host
 * document. It is deliberately transport-agnostic: the React Native surface
 * hands it a `post` function and feeds it raw webview messages, which keeps
 * the entire session state machine — registration, activation, permission
 * checks, request handling, page state, crash isolation — unit-testable on
 * plain node without a WebView.
 *
 * Rules enforced here rather than trusted to the webview:
 * - a bridge request is only served for the plugin that is currently
 *   executing, and only when that plugin holds the matching permission (§50)
 * - reads resolve inside the plugin's own package; writes always land in the
 *   plugin's private data directory, never in its package (§46/§47)
 * - a plugin that fails to load or initialize is reported to the runtime,
 *   which marks it broken and auto-disables it (§52/§72)
 */
import { EXTENSION_TO_MODE_KEY } from "../../../editor/editorLanguages";
import {
  createMemoryFormatterSelections,
  extensionsForLanguageId,
  formatterSupportsLanguage,
  normalizeFormatterExtensions,
  type FormatterRegistration,
  type FormatterSelectionStore,
} from "../formatters";
import type { ExtensionPermissionKey } from "../models";
import {
  isSafePluginPath,
  MAX_TOAST_LENGTH,
  normalizeConsoleText,
  normalizeDialogText,
  normalizeNewFileName,
  normalizePageTitle,
  parsePluginBridgeOutbound,
  PLUGIN_DIALOG_CANCELLED,
  type PluginBridgeInbound,
  type PluginBridgeOutbound,
  type PluginCommandRegistration,
  type PluginDialogKind,
  type PluginDialogPayload,
  type PluginErrorPhase,
  type PluginPageState,
} from "./bridge-protocol";
import { PLUGIN_HOST_READY_TIMEOUT_MS } from "./dom-protocol";

/** Permissions the DOM runtime can actually expose to plugin code. */
export const DOM_GRANTABLE_PERMISSIONS: readonly ExtensionPermissionKey[] = [
  "commands",
  "editor",
  "filesystem",
  "network",
  "notifications",
  "storage",
  // Every installed plugin holds `ui` (permissions.ts); dialogs need no
  // further grant, exactly like Acode, which gates dialogs not at all.
  "ui",
];

export type PluginHostTransport = {
  post(message: PluginBridgeInbound): void;
};

export type PluginHostServices = {
  /** Run a built-in host command (`acode.exec`); false when unknown. */
  execHostCommand(name: string, value: unknown): boolean;
  /**
   * The document the user has open, or null when none is (§39). Only this
   * snapshot is ever handed to a plugin: no editor instance, no other buffer.
   */
  readActiveEditor(): { languageId: string | null; path: string; text: string } | null;
  /** Replace the whole active document; false when nothing is open. */
  writeActiveEditor(text: string): boolean;
  log(pluginId: string, level: "error" | "info" | "warning", message: string): void;
  notify(pluginId: string, level: string, text: string): void;
  onCommandRegistered(pluginId: string, command: PluginCommandRegistration): void;
  onCommandRemoved(pluginId: string, name: string): void;
  /** Read a package-relative file, or null when it does not exist. */
  readPackageFile(pluginId: string, path: string): Promise<string | null>;
  /** Read a plugin-private JSON store ("settings" | "storage" | "cache"). */
  readPluginData(
    pluginId: string,
    kind: "cache" | "settings" | "storage",
  ): Promise<Record<string, unknown>>;
  /** Consent-gated install request raised by acode.installPlugin (§42). */
  requestPluginInstall(pluginId: string, targetId: string): Promise<void>;
  /**
   * Native dialogs (verified against Acode's `src/dialogs/*`): the app
   * renders, the promise settles with the user's answer. The `select` kind
   * stays pending on cancel unless the payload sets `rejectOnCancel`;
   * `multi-prompt` rejects on cancel, mirroring Acode.
   */
  showDialog(kind: PluginDialogKind, payload: PluginDialogPayload): Promise<unknown>;
  /** Create a loader overlay; the returned id feeds operate/destroy calls. */
  createLoader(pluginId: string, title: string, message: string, timeoutMs?: number): Promise<string>;
  operateLoader(loaderId: string, op: "hide" | "setMessage" | "setTitle" | "show", value?: string): void;
  destroyLoader(loaderId: string): void;
  /** Fire-and-forget transient message; never throws, never needs a grant. */
  toast(pluginId: string, text: string, durationMs?: number): void;
  /** User-mediated file picking; resolves the picked URIs, empty on cancel. */
  pickFiles(pluginId: string, mode: string): Promise<string[]>;
  /** Create a file in the active project; resolves the created path. */
  openNewFile(pluginId: string, filename: string, text: string): Promise<string>;
  setPluginSetting(pluginId: string, key: string, value: unknown): Promise<void>;
  /** List a plugin-private data directory. */
  listPluginData(pluginId: string, path: string): Promise<string[]>;
  writePluginData(
    pluginId: string,
    kind: "cache" | "settings" | "storage",
    value: Record<string, unknown>,
  ): Promise<void>;
  writePluginFile(pluginId: string, path: string, text: string): Promise<void>;
};

export type PluginHostEvent =
  | { type: "activated"; pluginId: string }
  | { type: "commands-changed"; pluginId: string }
  | { type: "error"; message: string; phase: PluginErrorPhase; pluginId: string }
  | { type: "page"; page: PluginPageState }
  | { type: "unmounted"; pluginId: string };

type PluginDefinition = {
  baseUrl: string;
  grantedPermissions: string[];
  /** Entry source, retained so a remounted document can be re-defined. */
  source: string;
  settings: Record<string, unknown>;
  storage: Record<string, unknown>;
};

type PendingActivation = {
  reject: (error: Error) => void;
  resolve: () => void;
  timer: ReturnType<typeof setTimeout> | null;
};

type ReadyWaiter = {
  reject: (error: Error) => void;
  resolve: () => void;
};

export class PluginHostError extends Error {}

/** Pad the runtime's own timeout: the host never outlives its caller. */
const ACTIVATION_TIMEOUT_MS = 20_000;
/** Guard against a runaway plugin flooding the host with messages. */
const MAX_REQUESTS_PER_PLUGIN = 512;

/** File extensions a formatter may declare for an editor language id. */
function extensionsForLanguage(languageId: string): string[] {
  return extensionsForLanguageId(languageId, EXTENSION_TO_MODE_KEY);
}

export class PluginDomHost {
  private readonly definitions = new Map<string, PluginDefinition>();
  private readonly listeners = new Set<(event: PluginHostEvent) => void>();
  private readonly pendingActivations = new Map<string, PendingActivation>();
  private readonly requestCounts = new Map<string, number>();
  /**
   * Definitions of plugins whose unmount is in flight (§52). The plugin's own
   * unmount callback still runs inside the document, and it may legitimately
   * persist state or say goodbye — so plugin-scoped operations stay
   * authorized until the document confirms the unmount is finished.
   */
  private readonly unmounting = new Map<string, PluginDefinition>();
  private activations = new Set<string>();
  private readonly definedWaiters = new Map<
    string,
    { reject: (error: Error) => void; resolve: (hasInit: boolean) => void }
  >();
  private page: PluginPageState = null;
  private readonly readyWaiters = new Set<ReadyWaiter>();
  private transport: PluginHostTransport | null = null;
  private ready = false;
  /** Loader overlay ids owned by each plugin; destroyed with the plugin. */
  private readonly loaders = new Map<string, string>();
  /** Formatter mirror: the functions stay in the document, metadata here. */
  private readonly formatters = new Map<string, FormatterRegistration>();
  private formatterSelections: FormatterSelectionStore;

  constructor(
    private readonly services: PluginHostServices,
    private readonly activationTimeoutMs: number = ACTIVATION_TIMEOUT_MS,
    selections?: FormatterSelectionStore,
  ) {
    this.formatterSelections = selections ?? createMemoryFormatterSelections();
  }

  /** Formatter registrations currently known to the host (selection UI). */
  listFormatters(): FormatterRegistration[] {
    return [...this.formatters.values()].map((entry) => ({
      displayName: entry.displayName,
      extensions: [...entry.extensions],
      formatterId: entry.formatterId,
      pluginId: entry.pluginId,
    }));
  }

  /**
   * The webview mounted (or remounted). Everything the previous document
   * knew died with it, so the surface re-`load()`s the plugins it expects to
   * be live; this method only resets session state and fails in-flight work
   * rather than hiding that loss.
   */
  attach(transport: PluginHostTransport): void {
    this.transport = transport;
    this.ready = false;
    this.activations = new Set();
    this.unmounting.clear();
    this.page = null;
    this.failPending(
      new PluginHostError("The plugin runtime document was replaced."),
    );
  }

  /** The webview went away: registrations inside it are gone with it. */
  detach(): void {
    this.transport = null;
    this.ready = false;
    this.activations = new Set();
    this.unmounting.clear();
    this.page = null;
    this.failPending(new PluginHostError("The plugin runtime document is not available."));
  }

  /**
   * Resolve once the mounted document has installed its runtime and is able
   * to receive messages. Without this the host would post plugin code into a
   * document that does not yet define the inbox, and every plugin would look
   * like it failed to load.
   */
  waitForReady(timeoutMs: number = PLUGIN_HOST_READY_TIMEOUT_MS): Promise<void> {
    if (this.ready) return Promise.resolve();
    this.requireTransport();
    return new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const waiter: ReadyWaiter = {
        reject: (error: Error) => {
          if (timer) clearTimeout(timer);
          this.readyWaiters.delete(waiter);
          reject(error);
        },
        resolve: () => {
          if (timer) clearTimeout(timer);
          this.readyWaiters.delete(waiter);
          resolve();
        },
      };
      timer = setTimeout(() => {
        waiter.reject(
          new PluginHostError(
            `The plugin runtime document did not report ready within ${timeoutMs} ms.`,
          ),
        );
      }, timeoutMs);
      this.readyWaiters.add(waiter);
      // The document may have reported ready between the check and here.
      if (this.ready) waiter.resolve();
    });
  }

  /** Run a command a plugin registered inside the document (§45). */
  runCommand(name: string, value?: unknown): boolean {
    if (!this.transport || !this.ready) return false;
    try {
      this.transport.post({ name, type: "exec-command", value });
      return true;
    } catch {
      return false;
    }
  }

  isReady(): boolean {
    return this.ready && this.transport !== null;
  }

  getPage(): PluginPageState {
    return this.page;
  }

  hasDefinition(pluginId: string): boolean {
    return this.definitions.has(pluginId);
  }

  subscribe(listener: (event: PluginHostEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Hide the visible plugin page (the user closed the surface). */
  hidePage(): void {
    if (this.page === null) return;
    this.page = null;
    this.transport?.post({ type: "hide-page" });
    this.emit({ type: "page", page: null });
  }

  /* ------------------------------------------------------------ lifecycle */

  /**
   * Inject a plugin's entry script and wait for it to register its init
   * callback. Idempotent: an already-defined plugin is not re-executed.
   */
  async load(
    pluginId: string,
    options: {
      baseUrl: string;
      grantedPermissions: ExtensionPermissionKey[];
      settings: Record<string, unknown>;
      source: string;
      storage: Record<string, unknown>;
    },
  ): Promise<void> {
    const definition: PluginDefinition = {
      baseUrl: options.baseUrl,
      grantedPermissions: options.grantedPermissions.filter((permission) =>
        DOM_GRANTABLE_PERMISSIONS.includes(permission),
      ),
      settings: options.settings,
      source: options.source,
      storage: options.storage,
    };
    const alreadyLive =
      this.definitions.get(pluginId)?.source === definition.source &&
      this.activations.has(pluginId);
    this.definitions.set(pluginId, definition);
    if (alreadyLive) return;

    const transport = this.requireTransport();
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        finish();
        reject(
          new PluginHostError(
            `Plugin "${pluginId}" did not finish loading within ${this.activationTimeoutMs} ms.`,
          ),
        );
      }, this.activationTimeoutMs);
      const unsubscribe = this.subscribe((event) => {
        if (settled) return;
        if (event.type === "error" && event.pluginId === pluginId && event.phase === "load") {
          finish();
          reject(new PluginHostError(event.message));
        }
      });
      // The document posts `defined` once the entry script has executed, so
      // this resolves on real completion rather than a guessed delay.
      this.definedWaiters.set(pluginId, {
        reject: (error) => {
          finish();
          reject(error);
        },
        resolve: (hasInit) => {
          finish();
          if (hasInit) resolve();
          else {
            reject(
              new PluginHostError(
                `Plugin "${pluginId}" registered no init callback; entry scripts must call acode.setPluginInit.`,
              ),
            );
          }
        },
      });
      const finish = () => {
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        this.definedWaiters.delete(pluginId);
      };
      try {
        transport.post({
          type: "define-plugin",
          grantedPermissions: definition.grantedPermissions,
          pluginId,
          settings: definition.settings,
          source: definition.source,
          storage: definition.storage,
        });
      } catch (error) {
        finish();
        reject(error instanceof Error ? error : new PluginHostError(String(error)));
      }
    });
  }

  /** Run the plugin's init callback inside the document. */
  async activate(pluginId: string, options: { firstInit: boolean }): Promise<void> {
    const definition = this.definitions.get(pluginId);
    if (!definition) {
      throw new PluginHostError(`Plugin "${pluginId}" is not defined in the runtime.`);
    }
    if (this.activations.has(pluginId)) return;
    const transport = this.requireTransport();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingActivations.delete(pluginId);
        reject(
          new PluginHostError(
            `Plugin "${pluginId}" did not finish initialization within ${this.activationTimeoutMs} ms.`,
          ),
        );
      }, this.activationTimeoutMs);
      this.pendingActivations.set(pluginId, { reject, resolve, timer });
      try {
        transport.post({
          type: "activate-plugin",
          baseUrl: definition.baseUrl,
          firstInit: options.firstInit,
          pluginId,
        });
      } catch (error) {
        this.pendingActivations.delete(pluginId);
        clearTimeout(timer);
        reject(error instanceof Error ? error : new PluginHostError(String(error)));
      }
    });
  }

  async unmount(pluginId: string): Promise<void> {
    const definition = this.definitions.get(pluginId);
    // Formatter registrations died with the document state; drop the mirror
    // so a stale entry can never route a format at a gone plugin. Saved
    // per-language selections are pruned lazily on the next format instead,
    // mirroring Acode's own cleanup-on-unregister behavior.
    for (const [formatterId, entry] of this.formatters) {
      if (entry.pluginId === pluginId) this.formatters.delete(formatterId);
    }
    if (!definition) return;
    // Kept aside until the document answers: the plugin's unmount callback
    // runs after this point and must still be able to write and notify.
    this.unmounting.set(pluginId, definition);
    this.definitions.delete(pluginId);
    this.activations.delete(pluginId);
    this.requestCounts.delete(pluginId);
    this.pendingActivations.get(pluginId)?.reject(
      new PluginHostError(`Plugin "${pluginId}" was unmounted while initializing.`),
    );
    this.pendingActivations.delete(pluginId);
    if (this.page?.pluginId === pluginId) {
      this.page = null;
      this.emit({ type: "page", page: null });
    }
    try {
      this.transport?.post({ type: "unmount-plugin", pluginId });
    } catch {
      // The document is gone; its state died with it.
      this.unmounting.delete(pluginId);
    }
  }

  /* -------------------------------------------------------------- inbound */

  /** Feed one raw message from the webview document. */
  handleMessage(raw: string): void {
    const message = parsePluginBridgeOutbound(raw);
    if (!message) {
      this.services.log("runtime", "warning", "Unparseable plugin runtime message.");
      return;
    }
    try {
      this.dispatch(message);
    } catch (error) {
      this.services.log(
        message.type,
        "error",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private dispatch(message: PluginBridgeOutbound): void {
    switch (message.type) {
      case "ready":
        this.ready = true;
        for (const waiter of [...this.readyWaiters]) waiter.resolve();
        return;
      case "registered":
        return;
      case "defined": {
        const waiter = this.definedWaiters.get(message.pluginId);
        if (waiter) {
          this.definedWaiters.delete(message.pluginId);
          waiter.resolve(message.hasInit);
        }
        return;
      }
      case "activated": {
        this.activations.add(message.pluginId);
        const pending = this.pendingActivations.get(message.pluginId);
        if (pending) {
          this.pendingActivations.delete(message.pluginId);
          if (pending.timer) clearTimeout(pending.timer);
          pending.resolve();
        }
        this.emit({ type: "activated", pluginId: message.pluginId });
        return;
      }
      case "unmounted":
        this.activations.delete(message.pluginId);
        this.unmounting.delete(message.pluginId);
        // A dead plugin keeps no loader overlay on screen.
        for (const [loaderId, owner] of [...this.loaders]) {
          if (owner === message.pluginId) {
            this.loaders.delete(loaderId);
            try {
              this.services.destroyLoader(loaderId);
            } catch {
              // Teardown must never break the unmount path.
            }
          }
        }
        this.emit({ type: "unmounted", pluginId: message.pluginId });
        return;
      case "console":
        this.services.log(
          message.pluginId ?? "runtime",
          message.level === "error" ? "error" : message.level === "warn" ? "warning" : "info",
          normalizeConsoleText(message.text),
        );
        return;
      case "error": {
        const pluginId = message.pluginId ?? "runtime";
        this.services.log(pluginId, "error", message.message);
        if (message.pluginId) {
          const pending = this.pendingActivations.get(message.pluginId);
          if (pending && message.phase === "activate") {
            this.pendingActivations.delete(message.pluginId);
            if (pending.timer) clearTimeout(pending.timer);
            pending.reject(new PluginHostError(message.message));
          }
          this.emit({
            message: message.message,
            phase: message.phase,
            pluginId: message.pluginId,
            type: "error",
          });
        }
        return;
      }
      case "page": {
        this.page =
          message.action === "shown"
            ? { pluginId: message.pluginId, title: normalizePageTitle(message.title) }
            : null;
        this.emit({ type: "page", page: this.page });
        return;
      }
      case "command-register": {
        if (!this.hasPermission(message.pluginId, "commands")) {
          this.services.log(
            message.pluginId,
            "warning",
            `Refused to register command "${message.command.name}" without the commands capability.`,
          );
          return;
        }
        this.services.onCommandRegistered(message.pluginId, message.command);
        this.emit({ pluginId: message.pluginId, type: "commands-changed" });
        return;
      }
      case "command-remove": {
        this.services.onCommandRemoved(message.pluginId, message.name);
        this.emit({ pluginId: message.pluginId, type: "commands-changed" });
        return;
      }
      case "notify": {
        if (!this.hasPermission(message.pluginId, "notifications")) {
          this.services.log(
            message.pluginId,
            "warning",
            "Refused a notification without the notifications capability.",
          );
          return;
        }
        this.services.notify(message.pluginId, message.level, message.text);
        return;
      }
      case "settings-set":
        if (!this.hasPermission(message.pluginId, "storage")) return;
        void this.services.setPluginSetting(message.pluginId, message.key, message.value);
        return;
      case "editor-read": {
        if (!this.withinRequestBudget(message.pluginId, message.requestId)) return;
        if (!this.hasPermission(message.pluginId, "editor")) {
          this.respond(message.requestId, {
            error: "The editor capability was not granted to this plugin.",
            ok: false,
          });
          return;
        }
        this.respond(message.requestId, {
          ok: true,
          value: this.services.readActiveEditor(),
        });
        return;
      }
      case "editor-write": {
        if (!this.withinRequestBudget(message.pluginId, message.requestId)) return;
        if (!this.hasPermission(message.pluginId, "editor")) {
          this.respond(message.requestId, {
            error: "The editor capability was not granted to this plugin.",
            ok: false,
          });
          return;
        }
        if (typeof message.text !== "string") {
          this.respond(message.requestId, {
            error: "An editor write requires text.",
            ok: false,
          });
          return;
        }
        let applied = false;
        try {
          applied = this.services.writeActiveEditor(message.text);
        } catch (error) {
          this.respond(message.requestId, {
            error: error instanceof Error ? error.message : "The edit was refused.",
            ok: false,
          });
          return;
        }
        if (!applied) {
          this.respond(message.requestId, {
            error: "No document is open in the editor.",
            ok: false,
          });
          return;
        }
        this.respond(message.requestId, { ok: true, value: true });
        return;
      }
      case "storage-get":
        void this.handleDataRequest(message.pluginId, message.requestId, "storage", message.key);
        return;
      case "storage-set":
      case "storage-remove":
        void this.handleStorageWrite(
          message.type,
          message.pluginId,
          message.key,
          "value" in message ? message.value : undefined,
        );
        return;
      case "fs-read":
        void this.handleReadRequest(message.pluginId, message.requestId, message.path);
        return;
      case "fs-list":
        void this.handleListRequest(message.pluginId, message.requestId, message.path);
        return;
      case "fs-write":
        void this.handleWriteRequest(
          message.pluginId,
          message.requestId,
          message.path,
          message.text,
        );
        return;
      case "install-plugin":
        void this.handleInstallRequest(message.pluginId, message.requestId, message.targetId);
        return;
      case "formatter-register":
        this.handleFormatterRegister(message);
        return;
      case "formatter-unregister":
        this.handleFormatterUnregister(message);
        return;
      case "format-request":
        void this.handleFormatRequest(message.pluginId, message.requestId);
        return;
      case "format-apply":
        void this.handleFormatApply(message.pluginId, message.requestId, message.text);
        return;
      case "dialog":
        void this.handleDialogRequest(message.pluginId, message.requestId, message.kind, message.payload);
        return;
      case "dialog-loader-create":
        void this.handleLoaderCreate(
          message.pluginId,
          message.requestId,
          message.title,
          message.message,
          message.options,
        );
        return;
      case "dialog-loader-op":
        this.handleLoaderOp(message.pluginId, message.loaderId, message.op, message.value);
        return;
      case "toast":
        this.handleToast(message.pluginId, message.text, message.durationMs);
        return;
      case "file-browser":
        void this.handleFileBrowser(message.pluginId, message.requestId, message.mode);
        return;
      case "editor-new-file":
        void this.handleNewEditorFile(
          message.pluginId,
          message.requestId,
          message.filename,
          message.text,
        );
        return;
      case "exec-request":
        if (message.pluginId && !this.hasPermission(message.pluginId, "commands")) {
          this.services.log(
            message.pluginId,
            "warning",
            `Refused to run command "${message.name}" without the commands capability.`,
          );
          return;
        }
        if (!this.services.execHostCommand(message.name, message.value)) {
          this.services.log(
            message.pluginId ?? "runtime",
            "warning",
            `Unknown command "${message.name}".`,
          );
        }
        return;
      default:
        return;
    }
  }

  /* ------------------------------------------------------------- requests */

  private requireTransport(): PluginHostTransport {
    if (!this.transport) {
      throw new PluginHostError(
        "The plugin runtime document is not mounted, so plugin code cannot run.",
      );
    }
    return this.transport;
  }

  private respond(
    requestId: number,
    result: { error?: string; ok: boolean; value?: unknown },
  ): void {
    this.transport?.post({
      error: result.error,
      ok: result.ok,
      requestId,
      result: result.value,
      type: "response",
    });
  }

  private hasPermission(pluginId: string, permission: string): boolean {
    const definition =
      this.definitions.get(pluginId) ?? this.unmounting.get(pluginId);
    return definition?.grantedPermissions.includes(permission) ?? false;
  }

  private withinRequestBudget(pluginId: string, requestId: number): boolean {
    const count = (this.requestCounts.get(pluginId) ?? 0) + 1;
    this.requestCounts.set(pluginId, count);
    if (count > MAX_REQUESTS_PER_PLUGIN) {
      this.respond(requestId, {
        error: "This plugin exceeded its request budget.",
        ok: false,
      });
      return false;
    }
    return true;
  }

  private async handleReadRequest(
    pluginId: string,
    requestId: number,
    path: string,
  ): Promise<void> {
    if (!this.hasPermission(pluginId, "filesystem") || !isSafePluginPath(path)) {
      this.respond(requestId, {
        error: `Read of "${path}" was refused.`,
        ok: false,
      });
      return;
    }
    if (!this.withinRequestBudget(pluginId, requestId)) return;
    try {
      const text = await this.services.readPackageFile(pluginId, path);
      if (text === null) {
        this.respond(requestId, { error: `"${path}" does not exist.`, ok: false });
        return;
      }
      this.respond(requestId, { ok: true, value: text });
    } catch (error) {
      this.respond(requestId, {
        error: error instanceof Error ? error.message : "Read failed.",
        ok: false,
      });
    }
  }

  private async handleListRequest(
    pluginId: string,
    requestId: number,
    path: string,
  ): Promise<void> {
    if (!this.hasPermission(pluginId, "filesystem") || !isSafePluginPath(path)) {
      this.respond(requestId, { error: `List of "${path}" was refused.`, ok: false });
      return;
    }
    if (!this.withinRequestBudget(pluginId, requestId)) return;
    try {
      this.respond(requestId, {
        ok: true,
        value: await this.services.listPluginData(pluginId, path),
      });
    } catch (error) {
      this.respond(requestId, {
        error: error instanceof Error ? error.message : "List failed.",
        ok: false,
      });
    }
  }

  private async handleWriteRequest(
    pluginId: string,
    requestId: number,
    path: string,
    text: string,
  ): Promise<void> {
    if (!this.hasPermission(pluginId, "filesystem") || !isSafePluginPath(path)) {
      this.respond(requestId, { error: `Write to "${path}" was refused.`, ok: false });
      return;
    }
    if (!this.withinRequestBudget(pluginId, requestId)) return;
    try {
      await this.services.writePluginFile(pluginId, path, text);
      this.respond(requestId, { ok: true });
    } catch (error) {
      this.respond(requestId, {
        error: error instanceof Error ? error.message : "Write failed.",
        ok: false,
      });
    }
  }

  private async handleDataRequest(
    pluginId: string,
    requestId: number,
    kind: "cache" | "settings" | "storage",
    key: string,
  ): Promise<void> {
    if (!this.hasPermission(pluginId, "storage")) {
      this.respond(requestId, { error: "Storage was not granted.", ok: false });
      return;
    }
    if (!this.withinRequestBudget(pluginId, requestId)) return;
    try {
      const data = await this.services.readPluginData(pluginId, kind);
      this.respond(requestId, { ok: true, value: data[key] ?? null });
    } catch (error) {
      this.respond(requestId, {
        error: error instanceof Error ? error.message : "Read failed.",
        ok: false,
      });
    }
  }

  private async handleStorageWrite(
    type: "storage-remove" | "storage-set",
    pluginId: string,
    key: string,
    value: unknown,
  ): Promise<void> {
    if (!this.hasPermission(pluginId, "storage")) return;
    const definition =
      this.definitions.get(pluginId) ?? this.unmounting.get(pluginId);
    if (!definition) return;
    const data: Record<string, unknown> = await this.services
      .readPluginData(pluginId, "storage")
      .catch(() => ({}) as Record<string, unknown>);
    if (type === "storage-remove") delete data[key];
    else data[key] = value;
    if (definition) definition.storage = data;
    await this.services.writePluginData(pluginId, "storage", data);
  }

  private async handleInstallRequest(
    pluginId: string,
    requestId: number,
    targetId: string,
  ): Promise<void> {
    try {
      await this.services.requestPluginInstall(pluginId, targetId);
      this.respond(requestId, { ok: true });
    } catch (error) {
      this.respond(requestId, {
        error: error instanceof Error ? error.message : "The install request was refused.",
        ok: false,
      });
    }
  }

  /**
   * Native dialogs (verified against Acode's `src/dialogs/*`). Gated on the
   * `ui` capability every plugin holds; the app renders and the promise
   * settles with the user's answer. Cancellation mirrors Acode per kind:
   * `select` stays pending unless the payload sets `rejectOnCancel`,
   * `multi-prompt` rejects, everything else resolves its empty value.
   */
  private async handleDialogRequest(
    pluginId: string,
    requestId: number,
    kind: PluginDialogKind,
    payload: PluginDialogPayload,
  ): Promise<void> {
    if (!this.withinRequestBudget(pluginId, requestId)) return;
    if (!pluginId || !this.hasPermission(pluginId, "ui")) {
      this.respond(requestId, {
        error: "Showing a dialog requires the ui capability.",
        ok: false,
      });
      return;
    }
    if (kind !== "alert" && kind !== "confirm" && kind !== "prompt" && kind !== "select" && kind !== "multi-prompt") {
      this.respond(requestId, { error: `Unknown dialog kind "${String(kind)}".`, ok: false });
      return;
    }
    try {
      const value = await this.services.showDialog(kind, payload);
      this.respond(requestId, { ok: true, value: value ?? null });
    } catch (error) {
      if (error instanceof Error && error.name === PLUGIN_DIALOG_CANCELLED) {
        this.respond(requestId, { error: PLUGIN_DIALOG_CANCELLED, ok: false });
        return;
      }
      this.respond(requestId, {
        error: error instanceof Error ? error.message : "The dialog could not be shown.",
        ok: false,
      });
    }
  }

  private async handleLoaderCreate(
    pluginId: string,
    requestId: number,
    title: unknown,
    message: unknown,
    options: unknown,
  ): Promise<void> {
    if (!this.withinRequestBudget(pluginId, requestId)) return;
    if (!pluginId || !this.hasPermission(pluginId, "ui")) {
      this.respond(requestId, {
        error: "Showing a loader requires the ui capability.",
        ok: false,
      });
      return;
    }
    const optionsRecord =
      typeof options === "object" && options !== null
        ? (options as { timeoutMs?: unknown })
        : {};
    const timeoutMs =
      typeof optionsRecord.timeoutMs === "number" && optionsRecord.timeoutMs > 0
        ? Math.min(Math.floor(optionsRecord.timeoutMs), 120_000)
        : undefined;
    try {
      const loaderId = await this.services.createLoader(
        pluginId,
        normalizeDialogText(title, 200),
        normalizeDialogText(message),
        timeoutMs,
      );
      this.loaders.set(loaderId, pluginId);
      this.respond(requestId, { ok: true, value: loaderId });
    } catch (error) {
      this.respond(requestId, {
        error: error instanceof Error ? error.message : "The loader could not be shown.",
        ok: false,
      });
    }
  }

  /** Loader ops are one-way: unknown ids are ignored, cross-plugin ops refused. */
  private handleLoaderOp(
    pluginId: string,
    loaderId: unknown,
    op: string,
    value: unknown,
  ): void {
    if (typeof loaderId !== "string" || this.loaders.get(loaderId) !== pluginId) return;
    if (op === "destroy") {
      this.loaders.delete(loaderId);
      try {
        this.services.destroyLoader(loaderId);
      } catch {
        // Loader teardown must never break the plugin.
      }
      return;
    }
    if (op === "hide" || op === "show" || op === "setTitle" || op === "setMessage") {
      try {
        this.services.operateLoader(
          loaderId,
          op,
          typeof value === "string" ? normalizeDialogText(value, 500) : undefined,
        );
      } catch {
        // Loader teardown must never break the plugin.
      }
    }
  }

  /** Toasts need no grant (Acode requires none) but count toward the budget. */
  private handleToast(pluginId: string, text: unknown, durationMs: unknown): void {
    if (!pluginId || !this.definitions.has(pluginId)) return;
    const count = (this.requestCounts.get(pluginId) ?? 0) + 1;
    this.requestCounts.set(pluginId, count);
    if (count > MAX_REQUESTS_PER_PLUGIN) return;
    const duration =
      typeof durationMs === "number" && durationMs > 0
        ? Math.min(Math.floor(durationMs), 10_000)
        : undefined;
    try {
      this.services.toast(pluginId, normalizeDialogText(text, MAX_TOAST_LENGTH), duration);
    } catch {
      // A toast must never break the plugin that showed it.
    }
  }

  private async handleFileBrowser(
    pluginId: string,
    requestId: number,
    mode: unknown,
  ): Promise<void> {
    if (!this.withinRequestBudget(pluginId, requestId)) return;
    if (!pluginId || !this.hasPermission(pluginId, "ui")) {
      this.respond(requestId, {
        error: "Opening the file browser requires the ui capability.",
        ok: false,
      });
      return;
    }
    try {
      const uris = await this.services.pickFiles(
        pluginId,
        typeof mode === "string" ? mode : "file",
      );
      this.respond(requestId, { ok: true, value: uris });
    } catch (error) {
      this.respond(requestId, {
        error: error instanceof Error ? error.message : "No file was picked.",
        ok: false,
      });
    }
  }

  private async handleNewEditorFile(
    pluginId: string,
    requestId: number,
    filename: unknown,
    text: unknown,
  ): Promise<void> {
    if (!this.withinRequestBudget(pluginId, requestId)) return;
    if (!pluginId || !this.hasPermission(pluginId, "editor")) {
      this.respond(requestId, {
        error: "Creating an editor file requires the editor capability.",
        ok: false,
      });
      return;
    }
    const name = normalizeNewFileName(filename);
    if (!name) {
      this.respond(requestId, {
        error: "A new editor file requires a file name.",
        ok: false,
      });
      return;
    }
    try {
      const path = await this.services.openNewFile(
        pluginId,
        name,
        typeof text === "string" ? text : "",
      );
      this.respond(requestId, { ok: true, value: path });
    } catch (error) {
      this.respond(requestId, {
        error: error instanceof Error ? error.message : "The file could not be created.",
        ok: false,
      });
    }
  }

  /**
   * Formatter registration (verified against Acode's acode.js). Registering
   * is metadata-only and needs no permission; *running* a formatter goes
   * through the editor-gated format flow below. Only a defined plugin may
   * register — messages from nowhere are dropped.
   */
  private handleFormatterRegister(message: {
    displayName: string;
    extensions: string[];
    formatterId: string;
    pluginId: string;
  }): void {
    if (!message.pluginId || !this.definitions.has(message.pluginId)) return;
    const formatterId = message.formatterId?.trim();
    if (!formatterId) {
      this.services.log(message.pluginId, "warning", "Refused a formatter registration without an id.");
      return;
    }
    this.formatters.set(formatterId, {
      displayName: typeof message.displayName === "string" ? message.displayName : "",
      extensions: normalizeFormatterExtensions(message.extensions),
      formatterId,
      pluginId: message.pluginId,
    });
  }

  /**
   * Only the owning plugin may remove its formatter. Acode checks nothing
   * here; silent cross-plugin removal is sabotage, not compatibility.
   */
  private async handleFormatterUnregister(message: {
    formatterId: string;
    pluginId: string;
  }): Promise<void> {
    const entry = this.formatters.get(message.formatterId);
    if (entry && entry.pluginId === message.pluginId) {
      this.formatters.delete(message.formatterId);
      await this.clearFormatterSelections(entry.formatterId);
    }
  }

  private async clearFormatterSelections(formatterId: string): Promise<void> {
    try {
      const selections = await this.formatterSelections.loadSelections();
      let changed = false;
      for (const [languageId, selected] of Object.entries(selections)) {
        if (selected === formatterId) {
          delete selections[languageId];
          changed = true;
        }
      }
      if (changed) await this.formatterSelections.saveSelections(selections);
    } catch {
      // Selection cleanup is best-effort; stale entries are pruned lazily.
    }
  }

  /**
   * `acode.format()` entry: resolve the selection for the active document's
   * language and hand the document everything its formatter function needs.
   * The caller must hold the editor capability — formatting reads and
   * replaces the open document.
   */
  private async handleFormatRequest(pluginId: string | null, requestId: number): Promise<void> {
    if (!pluginId || !this.hasPermission(pluginId, "editor")) {
      this.respond(requestId, {
        error: "Formatting the active document requires the editor capability.",
        ok: false,
      });
      return;
    }
    if (!this.withinRequestBudget(pluginId, requestId)) return;
    const snapshot = this.services.readActiveEditor();
    if (!snapshot) {
      this.respond(requestId, { error: "No document is open in the editor.", ok: false });
      return;
    }
    const languageId = (snapshot.languageId ?? "").toLowerCase();
    let selections: Record<string, string> = {};
    try {
      selections = await this.formatterSelections.loadSelections();
    } catch {
      selections = {};
    }
    let formatterId: string | null = selections[languageId] ?? null;
    let entry = formatterId ? (this.formatters.get(formatterId) ?? null) : null;
    if (formatterId && !entry) {
      // Mirror Acode's lazy cleanup: a selection pointing at a formatter
      // that no longer exists is deleted instead of failing forever.
      delete selections[languageId];
      await this.formatterSelections.saveSelections(selections).catch(() => {});
      formatterId = null;
    }
    if (!entry) {
      // Unambiguous single candidate: use it without forcing the user
      // through the Store picker's detail view mid-keystroke. Zero or
      // several candidates is an honest refusal, not a guess.
      const candidates = [...this.formatters.values()].filter((candidate) =>
        formatterSupportsLanguage(candidate, extensionsForLanguage(languageId)),
      );
      if (candidates.length === 1 && candidates[0]) {
        entry = candidates[0];
        formatterId = entry.formatterId;
      }
    }
    if (!entry || !formatterId) {
      this.services.log(
        pluginId,
        "info",
        `No formatter selected for language "${languageId || "plain text"}".`,
      );
      this.respond(requestId, { error: "No formatter is selected for this file.", ok: false });
      return;
    }
    this.respond(requestId, {
      ok: true,
      value: {
        formatterId,
        languageId,
        path: snapshot.path,
        text: snapshot.text,
      },
    });
  }

  /**
   * The document ran the selected formatter and posts the result. The
   * caller (the plugin that invoked `format()`) must still hold the editor
   * capability at apply time.
   */
  private async handleFormatApply(
    pluginId: string | null,
    requestId: number,
    text: unknown,
  ): Promise<void> {
    if (!pluginId || !this.hasPermission(pluginId, "editor")) {
      this.respond(requestId, {
        error: "Applying formatted text requires the editor capability.",
        ok: false,
      });
      return;
    }
    if (!this.withinRequestBudget(pluginId, requestId)) return;
    if (typeof text !== "string") {
      this.respond(requestId, { error: "A formatter must return text.", ok: false });
      return;
    }
    let applied = false;
    try {
      applied = this.services.writeActiveEditor(text);
    } catch {
      applied = false;
    }
    if (!applied) {
      this.respond(requestId, { error: "No document is open in the editor.", ok: false });
      return;
    }
    this.respond(requestId, { ok: true, value: true });
  }

  /* --------------------------------------------------------------- events */

  private emit(event: PluginHostEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // A broken listener must not stop the others.
      }
    }
  }

  private failPending(error: Error): void {
    for (const [pluginId, pending] of this.pendingActivations) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(error);
      this.pendingActivations.delete(pluginId);
    }
    for (const [pluginId, waiter] of this.definedWaiters) {
      this.definedWaiters.delete(pluginId);
      waiter.reject(error);
    }
    for (const waiter of [...this.readyWaiters]) waiter.reject(error);
  }
}

