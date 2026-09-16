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
import type { ExtensionPermissionKey } from "../models";
import {
  isSafePluginPath,
  normalizeConsoleText,
  normalizePageTitle,
  parsePluginBridgeOutbound,
  type PluginBridgeInbound,
  type PluginBridgeOutbound,
  type PluginCommandRegistration,
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

  constructor(
    private readonly services: PluginHostServices,
    private readonly activationTimeoutMs: number = ACTIVATION_TIMEOUT_MS,
  ) {}

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

