/**
 * DOM plugin runtime tests (prompt §45-§52, §72-§73).
 *
 * The webview-side runtime (`dom-runtime-script.ts`) is generated JavaScript
 * that only runs in a real browser document, so what is tested here is
 * everything on the native side of the bridge: the message protocol, the
 * session state machine, the permission and path checks the host enforces
 * rather than trusting the document, and the bridge that ties the host to the
 * Acode runtime, the command registry, and diagnostics.
 *
 * Where a real document is needed, `createDocumentSimulator` stands in: it
 * answers `define-plugin` / `activate-plugin` / `unmount-plugin` exactly as
 * `dom-runtime-script.ts` does, so the full request/response cycle is
 * exercised without a WebView.
 */
import { describe, expect, it } from "vitest";

import {
  isSafePluginPath,
  parsePluginBridgeOutbound,
  serializePluginBridgeInbound,
  type PluginBridgeInbound,
  type PluginBridgeOutbound,
} from "../dom/bridge-protocol";
import { buildPluginHostDocument } from "../dom/dom-runtime-script";
import { PLUGIN_PAGE_CONTAINER_ID, PLUGIN_RUNTIME_GLOBAL } from "../dom/dom-protocol";
import { createPluginHostServices } from "../dom/host-services";
import { DOM_GRANTABLE_PERMISSIONS, PluginDomHost } from "../dom/plugin-host";
import { createPluginRuntimeBridge } from "../dom/runtime-bridge";
import { createPluginCommandRegistry } from "../command-registry";
import { createDiagnosticRecorder } from "../diagnostics";
import { loadInstalledRecords, type InstallDeps } from "../installer";
import type { ExtensionPermissionKey } from "../models";
import { ExtensionRuntime } from "../runtime";
import { planExtensionPaths } from "../storage";
import { createMemoryPlatform } from "./helpers";

const PLUGIN_ID = "com.example.plugin";

/* ------------------------------------------------------------------ setup */

function setupDeps() {
  const { files, platform } = createMemoryPlatform();
  const deps: InstallDeps = {
    paths: planExtensionPaths("file:///docs/"),
    platform,
  };
  return { deps, files, platform };
}

/** Feed a message as if the plugin host document had posted it. */
function receive(host: PluginDomHost, message: PluginBridgeOutbound): void {
  host.handleMessage(JSON.stringify(message));
}

/**
 * Poll until `check` passes. Bridge requests resolve over several microtask
 * turns (and the platform writes files asynchronously), so assertions wait for
 * the real condition instead of a guessed delay.
 */
async function until(
  check: () => boolean | Promise<boolean>,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() > deadline) {
      throw new Error("timed out waiting for the bridge to settle");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** True once the host has answered a given request id. */
function answered(sent: PluginBridgeInbound[], requestId: number): boolean {
  return sent.some(
    (message) => message.type === "response" && message.requestId === requestId,
  );
}

/** A transport that records traffic without answering (manual control). */
function createManualTransport() {
  const sent: PluginBridgeInbound[] = [];
  return {
    sent,
    transport: {
      post(message: PluginBridgeInbound) {
        sent.push(message);
      },
    },
  };
}

/**
 * The webview half of the bridge: records what the host sends and answers the
 * messages a real document answers.
 */
function createDocumentSimulator(
  host: PluginDomHost,
  options: { hasInit?: boolean } = {},
) {
  const sent: PluginBridgeInbound[] = [];
  return {
    /** Simulate the document's runtime script finishing installation. */
    ready() {
      receive(host, { type: "ready" });
    },
    sent,
    transport: {
      post(message: PluginBridgeInbound) {
        sent.push(message);
        if (message.type === "define-plugin") {
          receive(host, {
            hasInit: options.hasInit ?? true,
            pluginId: message.pluginId,
            type: "defined",
          });
        } else if (message.type === "activate-plugin") {
          receive(host, { pluginId: message.pluginId, type: "activated" });
        } else if (message.type === "unmount-plugin") {
          receive(host, { pluginId: message.pluginId, type: "unmounted" });
        }
      },
    },
  };
}

type HarnessOptions = {
  /** Granted capabilities, as recorded on the installed extension. */
  permissions?: ExtensionPermissionKey[];
  pluginId?: string;
  /** Set false to drive `load()`/`activate()` from the test itself. */
  preload?: boolean;
};

async function harness(options: HarnessOptions = {}) {
  const { deps, files, platform } = setupDeps();
  const pluginId = options.pluginId ?? PLUGIN_ID;
  const logs: { level: string; message: string; pluginId: string }[] = [];
  const notifications: { level: string; pluginId: string; text: string }[] = [];
  const commands: { name: string; pluginId: string }[] = [];
  const installs: { pluginId: string; targetId: string }[] = [];
  const diagnostics = createDiagnosticRecorder(deps);

  const services = createPluginHostServices({
    callbacks: {
      log(pluginIdArg, level, message) {
        logs.push({ level, message, pluginId: pluginIdArg });
      },
      notify(pluginIdArg, level, text) {
        notifications.push({ level, pluginId: pluginIdArg, text });
      },
      onCommandRegistered(pluginIdArg, command) {
        commands.push({ name: command.name, pluginId: pluginIdArg });
      },
      onCommandRemoved(pluginIdArg, name) {
        const index = commands.findIndex(
          (entry) => entry.pluginId === pluginIdArg && entry.name === name,
        );
        if (index >= 0) commands.splice(index, 1);
      },
      requestPluginInstall(pluginIdArg, targetId) {
        installs.push({ pluginId: pluginIdArg, targetId });
        return Promise.resolve();
      },
    },
    deps,
    diagnostics,
  });

  const host = new PluginDomHost(services, 50);
  const document = createDocumentSimulator(host);
  host.attach(document.transport);
  document.ready();

  const permissions = options.permissions ?? [...DOM_GRANTABLE_PERMISSIONS];
  const loading = host.load(pluginId, {
    baseUrl: `${deps.paths.installedRoot}/${pluginId}`,
    grantedPermissions: permissions,
    settings: {},
    source: "acode.setPluginInit('com.example.plugin', () => {});",
    storage: {},
  });
  // The document replies as soon as it has executed the entry script.
  receive(host, { hasInit: true, pluginId, type: "defined" });
  if (options.preload !== false) await loading;

  return {
    commands,
    deps,
    diagnostics,
    document,
    files,
    host,
    installs,
    loading,
    logs,
    notifications,
    permissions,
    platform,
    pluginId,
    sent: document.sent,
    services,
  };
}

/* --------------------------------------------------------------- protocol */

describe("plugin bridge protocol", () => {
  it("drops messages that are not valid bridge envelopes", () => {
    expect(parsePluginBridgeOutbound("not json")).toBeNull();
    expect(parsePluginBridgeOutbound("[]")).toBeNull();
    expect(parsePluginBridgeOutbound(JSON.stringify({ noType: true }))).toBeNull();
    expect(parsePluginBridgeOutbound(JSON.stringify({ type: "ready" }))).toEqual({
      type: "ready",
    });
  });

  it("escapes angle brackets so plugin source cannot break out of the injection", () => {
    const serialized = serializePluginBridgeInbound({
      grantedPermissions: [],
      pluginId: PLUGIN_ID,
      settings: {},
      source: "document.write('</script><script>evil()</script>')",
      storage: {},
      type: "define-plugin",
    });
    expect(serialized).not.toContain("</script>");
    expect(serialized).toContain("\\u003c");
    expect(JSON.parse(serialized).source).toContain("</script>");
  });

  it("only accepts package-relative paths for file operations", () => {
    expect(isSafePluginPath("assets/icon.png")).toBe(true);
    expect(isSafePluginPath("main.js")).toBe(true);
    expect(isSafePluginPath("../secrets.json")).toBe(false);
    expect(isSafePluginPath("a/../../b")).toBe(false);
    expect(isSafePluginPath("/etc/passwd")).toBe(false);
    expect(isSafePluginPath("file:///etc/passwd")).toBe(false);
    expect(isSafePluginPath("C:\\Windows\\system32")).toBe(false);
    expect(isSafePluginPath("")).toBe(false);
  });

  it("builds a document that defines the inbox, page container, and theme", () => {
    const html = buildPluginHostDocument({
      theme: {
        accent: "#00aaff",
        background: "#001122",
        backgroundElement: "#002233",
        border: "#003344",
        text: "#ffffff",
        textSecondary: "#8899aa",
      },
    });
    expect(html).toContain(PLUGIN_PAGE_CONTAINER_ID);
    expect(html).toContain(PLUGIN_RUNTIME_GLOBAL);
    expect(html).toContain("ReactNativeWebView");
    expect(html).toContain("#001122");
    // The runtime must never be injected as a separate remote script.
    expect(html).not.toContain("http://");
  });
});

/* ------------------------------------------------------------ host session */

describe("plugin DOM host session", () => {
  it("waits for the document to report ready", async () => {
    const { host, services } = await harness();
    const delayed = new PluginDomHost(services, 50);
    const document = createDocumentSimulator(delayed);
    delayed.attach(document.transport);
    const pending = delayed.waitForReady(1_000);
    expect(delayed.isReady()).toBe(false);
    document.ready();
    await expect(pending).resolves.toBeUndefined();
    expect(delayed.isReady()).toBe(true);
    void host;
  });

  it("gives up when the document never reports ready", async () => {
    const { services } = await harness();
    const host = new PluginDomHost(services, 50);
    host.attach(createDocumentSimulator(host).transport);
    await expect(host.waitForReady(10)).rejects.toThrow(/did not report ready/);
  });

  it("fails in-flight work when the document is replaced", async () => {
    const { deps, host } = await harness({ preload: false });
    const { transport } = createManualTransport();
    host.attach(transport);
    const loading = host.load(PLUGIN_ID, {
      baseUrl: `${deps.paths.installedRoot}/${PLUGIN_ID}`,
      grantedPermissions: [...DOM_GRANTABLE_PERMISSIONS],
      settings: {},
      source: "const define = acode.setPluginInit",
      storage: {},
    });
    host.attach(createDocumentSimulator(host).transport);
    await expect(loading).rejects.toThrow(/was replaced/);
  });

  it("rejects an entry script that never registers an init callback", async () => {
    const { deps, host } = await harness({ preload: false });
    host.attach(createManualTransport().transport);
    const loading = host.load(PLUGIN_ID, {
      baseUrl: `${deps.paths.installedRoot}/${PLUGIN_ID}`,
      grantedPermissions: [...DOM_GRANTABLE_PERMISSIONS],
      settings: {},
      source: "no init here",
      storage: {},
    });
    receive(host, { hasInit: false, pluginId: PLUGIN_ID, type: "defined" });
    await expect(loading).rejects.toThrow(/registered no init callback/);
  });

  it("activates a plugin and rejects when its init throws", async () => {
    const { deps, host } = await harness({ preload: false });
    // Manual transport: the document's reply is driven by the test, so the
    // activation stays in flight while the failure is injected.
    const { sent, transport } = createManualTransport();
    host.attach(transport);
    receive(host, { type: "ready" });
    const loading = host.load(PLUGIN_ID, {
      baseUrl: `${deps.paths.installedRoot}/${PLUGIN_ID}`,
      grantedPermissions: [...DOM_GRANTABLE_PERMISSIONS],
      settings: {},
      source: "acode.setPluginInit('com.example.plugin', () => { throw 1; });",
      storage: {},
    });
    receive(host, { hasInit: true, pluginId: PLUGIN_ID, type: "defined" });
    await loading;

    const activating = host.activate(PLUGIN_ID, { firstInit: true });
    expect(sent.at(-1)).toMatchObject({ firstInit: true, type: "activate-plugin" });
    receive(host, { message: "boom", phase: "activate", pluginId: PLUGIN_ID, type: "error" });
    await expect(activating).rejects.toThrow(/boom/);
    // The failure is reported to the runtime, which marks the plugin broken.
    expect(sent.some((message) => message.type === "activate-plugin")).toBe(true);
  });

  it("tracks the plugin page and clears it on hide and unmount", async () => {
    const { host, sent } = await harness();
    receive(host, {
      action: "shown",
      pluginId: PLUGIN_ID,
      title: "  Trimmed  ",
      type: "page",
    });
    expect(host.getPage()).toEqual({ pluginId: PLUGIN_ID, title: "Trimmed" });

    host.hidePage();
    expect(host.getPage()).toBeNull();
    expect(sent.some((message) => message.type === "hide-page")).toBe(true);

    await host.unmount(PLUGIN_ID);
    expect(sent.some((message) => message.type === "unmount-plugin")).toBe(true);
    expect(host.hasDefinition(PLUGIN_ID)).toBe(false);
  });

  it("registers, lists, applies, and unregisters editor themes", async () => {
    const { host, sent } = await harness();
    const spec = {
      caption: "Chai Theme",
      config: {
        background: "#101418",
        foreground: "#e6edf3",
        keyword: "#ffb86c",
      },
      dark: true,
      id: "chai_theme",
    };
    receive(host, { ...spec, pluginId: PLUGIN_ID, type: "editor-theme-register" });
    expect(host.listEditorThemes()).toEqual([
      {
        id: "chai_theme",
        caption: "Chai Theme",
        dark: true,
        pluginId: PLUGIN_ID,
        config: spec.config,
      },
    ]);
    expect(
      sent.some((message) => message.type === "editor-themes-sync"),
    ).toBe(true);

    // Unknown ids are refused, never listed.
    receive(host, {
      ...spec,
      id: "  ",
      pluginId: PLUGIN_ID,
      type: "editor-theme-register",
    });
    expect(host.listEditorThemes()).toHaveLength(1);

    await host.setEditorThemeSelection("chai_theme");
    expect(host.getEditorThemeSelection()).toBe("chai_theme");

    // Only the owning plugin may remove its theme.
    receive(host, {
      id: "chai_theme",
      pluginId: "com.example.other",
      type: "editor-theme-unregister",
    });
    expect(host.listEditorThemes()).toHaveLength(1);
    receive(host, {
      id: "chai_theme",
      pluginId: PLUGIN_ID,
      type: "editor-theme-unregister",
    });
    expect(host.listEditorThemes()).toHaveLength(0);
    // Selection falls back when its theme disappears.
    expect(host.getEditorThemeSelection()).toBeNull();

    await expect(host.setEditorThemeSelection("nope")).rejects.toThrow(
      /Unknown editor theme/,
    );
  });

  it("clears a plugin's editor themes on unmount", async () => {
    const { host } = await harness();
    receive(host, {
      caption: "X",
      config: { background: "#000000", foreground: "#ffffff" },
      dark: true,
      id: "x-theme",
      pluginId: PLUGIN_ID,
      type: "editor-theme-register",
    });
    await host.setEditorThemeSelection("x-theme");
    await host.unmount(PLUGIN_ID);
    expect(host.listEditorThemes()).toHaveLength(0);
    expect(host.getEditorThemeSelection()).toBeNull();
  });

  it("normalizes a missing page title instead of showing an empty header", async () => {
    const { host } = await harness();
    receive(host, {
      action: "shown",
      pluginId: PLUGIN_ID,
      title: "   ",
      type: "page",
    });
    expect(host.getPage()?.title).toBe("Plugin");
  });

  it("runs plugin commands only while a document is live", async () => {
    const { host } = await harness();
    expect(host.runCommand("run", undefined)).toBe(true);
    host.detach();
    expect(host.runCommand("run", undefined)).toBe(false);
  });
});

/* --------------------------------------------------------------- permissions */

describe("plugin DOM host permissions", () => {
  it("refuses command registration without the commands capability", async () => {
    const { commands, host, logs } = await harness({ permissions: ["storage"] });
    receive(host, {
      command: { name: "hello" },
      pluginId: PLUGIN_ID,
      type: "command-register",
    });
    expect(commands).toEqual([]);
    expect(logs.at(-1)?.message).toMatch(/without the commands capability/);
  });

  it("mirrors command registration when the capability is granted", async () => {
    const { commands, host } = await harness({ permissions: ["commands"] });
    receive(host, {
      command: { bindKey: { ctrl: "k" }, name: "hello" },
      pluginId: PLUGIN_ID,
      type: "command-register",
    });
    expect(commands).toEqual([{ name: "hello", pluginId: PLUGIN_ID }]);

    receive(host, { name: "hello", pluginId: PLUGIN_ID, type: "command-remove" });
    expect(commands).toEqual([]);
  });

  it("refuses notifications without the notifications capability", async () => {
    const refused = await harness({ permissions: ["storage"] });
    receive(refused.host, {
      level: "info",
      pluginId: PLUGIN_ID,
      text: "hi",
      type: "notify",
    });
    expect(refused.notifications).toEqual([]);

    const granted = await harness({ permissions: ["notifications"] });
    receive(granted.host, {
      level: "info",
      pluginId: PLUGIN_ID,
      text: "hi",
      type: "notify",
    });
    expect(granted.notifications).toEqual([
      { level: "info", pluginId: PLUGIN_ID, text: "hi" },
    ]);
  });

  it("refuses file reads without the filesystem capability", async () => {
    const { host, sent } = await harness({ permissions: ["storage"] });
    receive(host, { path: "main.js", pluginId: PLUGIN_ID, requestId: 1, type: "fs-read" });
    await until(() => answered(sent, 1));
    expect(sent.at(-1)).toMatchObject({ ok: false, requestId: 1 });
  });

  it("refuses reads that escape the plugin's own package", async () => {
    const { host, sent } = await harness({ permissions: ["filesystem"] });
    receive(host, {
      path: "../storage/storage.json",
      pluginId: PLUGIN_ID,
      requestId: 2,
      type: "fs-read",
    });
    await until(() => answered(sent, 2));
    expect(sent.at(-1)).toMatchObject({ ok: false, requestId: 2 });
  });

  it("serves a package read when the capability is granted", async () => {
    const { deps, host, sent } = await harness({ permissions: ["filesystem"] });
    await deps.platform.writeText(
      `${deps.paths.installedRoot}/${PLUGIN_ID}/main.js`,
      "console.log(1);",
    );
    receive(host, { path: "main.js", pluginId: PLUGIN_ID, requestId: 3, type: "fs-read" });
    await until(() => answered(sent, 3));
    expect(sent.at(-1)).toMatchObject({
      ok: true,
      requestId: 3,
      result: "console.log(1);",
    });
  });

  it("writes plugin files into the plugin's private data tree, never its package", async () => {
    const { deps, host, platform } = await harness({ permissions: ["filesystem"] });
    receive(host, {
      path: "notes/todo.txt",
      pluginId: PLUGIN_ID,
      requestId: 1,
      text: "hello",
      type: "fs-write",
    });
    await until(
      async () =>
        (await platform.readText(
          `${deps.paths.dataRoot}/${PLUGIN_ID}/storage/files/notes/todo.txt`,
        )) === "hello",
    );
    expect(
      await platform.exists(
        `${deps.paths.installedRoot}/${PLUGIN_ID}/notes/todo.txt`,
        "file",
      ),
    ).toBe(false);
  });

  it("refuses storage access without the storage capability", async () => {
    const { host, sent } = await harness({ permissions: ["filesystem"] });
    receive(host, {
      key: "answer",
      pluginId: PLUGIN_ID,
      requestId: 1,
      type: "storage-get",
    });
    await until(() => answered(sent, 1));
    expect(sent.at(-1)).toMatchObject({ ok: false, requestId: 1 });
  });

  it("keeps plugin storage private, namespaced by plugin id", async () => {
    const { deps, host, platform, sent } = await harness({ permissions: ["storage"] });
    receive(host, {
      key: "answer",
      pluginId: PLUGIN_ID,
      type: "storage-set",
      value: 42,
    });
    await until(async () =>
      (
        await platform.readText(
          `${deps.paths.dataRoot}/${PLUGIN_ID}/storage/storage.json`,
        )
      )?.includes("42") === true,
    );

    receive(host, {
      key: "answer",
      pluginId: PLUGIN_ID,
      requestId: 9,
      type: "storage-get",
    });
    await until(() => answered(sent, 9));
    expect(sent.at(-1)).toMatchObject({ ok: true, requestId: 9, result: 42 });
  });

  it("writes plugin settings under the plugin's own settings file", async () => {
    const { deps, host, platform } = await harness({ permissions: ["storage"] });
    receive(host, { key: "mode", pluginId: PLUGIN_ID, type: "settings-set", value: "dark" });
    await until(async () =>
      (
        await platform.readText(
          `${deps.paths.dataRoot}/${PLUGIN_ID}/settings/settings.json`,
        )
      )?.includes('"mode":"dark"') === true,
    );
  });

  it("caps how many requests one plugin may make", async () => {
    const { deps, host, sent } = await harness({ permissions: ["filesystem"] });
    await deps.platform.writeText(
      `${deps.paths.installedRoot}/${PLUGIN_ID}/a.txt`,
      "x",
    );
    for (let index = 0; index < 600; index += 1) {
      receive(host, {
        path: "a.txt",
        pluginId: PLUGIN_ID,
        requestId: index + 1,
        type: "fs-read",
      });
    }
    await until(() =>
      sent.some(
        (message) =>
          message.type === "response" &&
          message.ok === false &&
          message.error === "This plugin exceeded its request budget.",
      ),
    );
  });

  it("routes a plugin-initiated install through the consent handler", async () => {
    const { host, installs, sent } = await harness();
    receive(host, {
      pluginId: PLUGIN_ID,
      requestId: 4,
      targetId: "other.plugin",
      type: "install-plugin",
    });
    await until(() => answered(sent, 4));
    expect(installs).toEqual([{ pluginId: PLUGIN_ID, targetId: "other.plugin" }]);
    expect(sent.at(-1)).toMatchObject({ ok: true, requestId: 4 });
  });

  it("reports a refused plugin-initiated install back to the plugin", async () => {
    const { deps } = setupDeps();
    const services = createPluginHostServices({
      callbacks: {
        log: () => {},
        notify: () => {},
        onCommandRegistered: () => {},
        onCommandRemoved: () => {},
        requestPluginInstall: () =>
          Promise.reject(new Error("declined by the user")),
      },
      deps,
      diagnostics: createDiagnosticRecorder(deps),
    });
    const host = new PluginDomHost(services, 50);
    const document = createDocumentSimulator(host);
    host.attach(document.transport);
    document.ready();
    receive(host, {
      pluginId: PLUGIN_ID,
      requestId: 7,
      targetId: "other.plugin",
      type: "install-plugin",
    });
    await until(() => answered(document.sent, 7));
    expect(document.sent.at(-1)).toMatchObject({
      error: "declined by the user",
      ok: false,
      requestId: 7,
    });
  });

  it("records plugin console output in the diagnostics log", async () => {
    const { diagnostics, host } = await harness();
    receive(host, { level: "warn", pluginId: PLUGIN_ID, text: "careful", type: "console" });
    await until(async () => (await diagnostics.list(PLUGIN_ID)).length === 1);
    expect((await diagnostics.list(PLUGIN_ID)).at(-1)).toMatchObject({
      level: "warning",
      message: "careful",
    });
  });

  it("caps diagnostic entries so a chatty plugin cannot grow the log forever", async () => {
    const { diagnostics, host } = await harness();
    for (let index = 0; index < 450; index += 1) {
      receive(host, {
        level: "log",
        pluginId: PLUGIN_ID,
        text: `line ${index}`,
        type: "console",
      });
    }
    await until(
      async () => (await diagnostics.list(PLUGIN_ID)).at(-1)?.message === "line 449",
    );
    const entries = await diagnostics.list(PLUGIN_ID);
    expect(entries.length).toBeLessThanOrEqual(400);
  });
});

/* ------------------------------------------------------------------- bridge */

async function installFixture(
  deps: InstallDeps,
  pluginId = PLUGIN_ID,
  permissionKeys: ExtensionPermissionKey[] = ["commands", "notifications"],
) {
  // A minimal installed record: the bridge and runtime only need the manifest,
  // the entry file, and the enabled flag.
  const manifest = {
    id: pluginId,
    main: "main.js",
    name: "Example",
    version: "1.0.0",
  };
  await deps.platform.writeText(
    `${deps.paths.installedRoot}/${pluginId}/main.js`,
    `acode.setPluginInit('${pluginId}', function () {});`,
  );
  await deps.platform.writeText(
    `${deps.paths.installedRoot}/${pluginId}/plugin.json`,
    JSON.stringify(manifest),
  );
  await deps.platform.writeText(
    deps.paths.installedFile,
    JSON.stringify({
      extensions: [
        {
          compatibility: { level: "compatible", reasons: [] },
          enabled: true,
          id: pluginId,
          installedAt: "2026-01-01T00:00:00.000Z",
          manifest,
          packageSha256: null,
          permissions: permissionKeys.map((key) => ({
            grantedAt: "2026-01-01T00:00:00.000Z",
            key,
          })),
          runtimeError: null,
          runtimeState: "enabled",
          source: "local-file",
          sourceUrl: null,
          updatedAt: "2026-01-01T00:00:00.000Z",
          version: "1.0.0",
        },
      ],
    }),
  );
}

describe("plugin runtime bridge", () => {
  function bridgeHarness() {
    const { deps } = setupDeps();
    const runtime = new ExtensionRuntime(deps);
    const bridge = createPluginRuntimeBridge({ deps, runtime });
    const document = createDocumentSimulator(bridge.host);
    return { bridge, deps, document, runtime };
  }

  it("reports whether mounting a document could accomplish anything", async () => {
    const { bridge, deps } = bridgeHarness();
    expect(await bridge.hasExecutableExtensions()).toBe(false);
    await installFixture(deps);
    expect(await bridge.hasExecutableExtensions()).toBe(true);
  });

  it("attaches the document, restarts live plugins, and detaches cleanly", async () => {
    const { bridge, deps, document, runtime } = bridgeHarness();
    await installFixture(deps);

    const attaching = bridge.attachDocument(document.transport);
    expect(runtime.hasExecutionHost()).toBe(true);
    document.ready();
    await attaching;

    // The plugin that was enabled before the document mounted is re-defined
    // and re-activated inside it, with no second user action (§21/§73).
    expect(document.sent.some((message) => message.type === "define-plugin")).toBe(true);
    expect(document.sent.some((message) => message.type === "activate-plugin")).toBe(true);
    expect(bridge.status()).toEqual({
      page: null,
      pages: [],
      editorThemes: { themes: [], selected: null },
      ready: true,
    });
    expect(runtime.getState(PLUGIN_ID)).toBe("loaded");

    bridge.detachDocument();
    expect(runtime.hasExecutionHost()).toBe(false);
    expect(bridge.status()).toEqual({
      page: null,
      pages: [],
      editorThemes: { themes: [], selected: null },
      ready: false,
    });
  });

  it("publishes page state so the surface can show the plugin page", async () => {
    const { bridge, deps, document, runtime } = bridgeHarness();
    await installFixture(deps);
    const attaching = bridge.attachDocument(document.transport);
    document.ready();
    await attaching;

    const seen: unknown[] = [];
    bridge.subscribe((status) => seen.push(status.page));
    receive(bridge.host, {
      action: "shown",
      pluginId: PLUGIN_ID,
      title: "My Page",
      type: "page",
    });
    expect(bridge.status().page).toEqual({ pluginId: PLUGIN_ID, title: "My Page" });
    expect(seen).toEqual([{ pluginId: PLUGIN_ID, title: "My Page" }]);

    bridge.hidePage();
    expect(seen.at(-1)).toBeNull();
    void runtime;
  });

  it("routes plugin notifications to the listener", async () => {
    const { bridge, deps, document } = bridgeHarness();
    await installFixture(deps);
    const notices: { pluginId: string; text: string }[] = [];
    bridge.setNotifyHandler((notice) => notices.push(notice));
    const attaching = bridge.attachDocument(document.transport);
    document.ready();
    await attaching;

    receive(bridge.host, {
      level: "info",
      pluginId: PLUGIN_ID,
      text: "hello",
      type: "notify",
    });
    expect(notices).toEqual([
      { level: "info", pluginId: PLUGIN_ID, text: "hello" },
    ]);
    // A plugin without the notifications capability gets nothing through.
    const refused = bridgeHarness();
    await installFixture(refused.deps, PLUGIN_ID, []);
    const refusedNotices: unknown[] = [];
    refused.bridge.setNotifyHandler((notice) => refusedNotices.push(notice));
    const refusedAttaching = refused.bridge.attachDocument(refused.document.transport);
    refused.document.ready();
    await refusedAttaching;
    receive(refused.bridge.host, {
      level: "info",
      pluginId: PLUGIN_ID,
      text: "hello",
      type: "notify",
    });
    expect(refusedNotices).toEqual([]);
  });

  it("mirrors plugin commands and can invoke them inside the document", async () => {
    const { bridge, deps, document } = bridgeHarness();
    await installFixture(deps);
    const attaching = bridge.attachDocument(document.transport);
    document.ready();
    await attaching;

    receive(bridge.host, {
      command: { name: "greet" },
      pluginId: PLUGIN_ID,
      type: "command-register",
    });
    expect(bridge.commands.list()).toEqual([
      {
        bindKey: null,
        chordId: null,
        description: null,
        executable: false,
        name: "greet",
        pluginId: PLUGIN_ID,
      },
    ]);

    expect(bridge.runCommand("greet", { value: 1 })).toBe(true);
    expect(document.sent.at(-1)).toMatchObject({
      name: "greet",
      type: "exec-command",
    });

    // Registrations lived in the document, so they die with it.
    bridge.detachDocument();
    expect(bridge.commands.list()).toEqual([]);
  });

  it("forgets a plugin's commands as soon as it unmounts", async () => {
    const { bridge, deps, document } = bridgeHarness();
    await installFixture(deps);
    const attaching = bridge.attachDocument(document.transport);
    document.ready();
    await attaching;

    receive(bridge.host, {
      command: { name: "greet" },
      pluginId: PLUGIN_ID,
      type: "command-register",
    });
    expect(bridge.commands.list()).toHaveLength(1);

    // Disabling or uninstalling a plugin must not leave its commands behind
    // in the app's registry, where they could still be listed and run.
    receive(bridge.host, { pluginId: PLUGIN_ID, type: "unmounted" });
    expect(bridge.commands.list()).toEqual([]);
    expect(bridge.chordIds()).toEqual([]);
  });

  it("persists diagnostics and clears them per plugin", async () => {
    const { bridge, deps, document } = bridgeHarness();
    await installFixture(deps);
    const attaching = bridge.attachDocument(document.transport);
    document.ready();
    await attaching;

    receive(bridge.host, {
      level: "error",
      pluginId: PLUGIN_ID,
      text: "something odd",
      type: "console",
    });
    receive(bridge.host, {
      level: "log",
      pluginId: "other.plugin",
      text: "from another plugin",
      type: "console",
    });

    await until(async () => (await bridge.listDiagnostics()).length === 2);
    await bridge.clearDiagnostics(PLUGIN_ID);
    const remaining = await bridge.listDiagnostics();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].pluginId).toBe("other.plugin");
    // The clear is persisted, not just in-memory.
    expect(await bridge.listDiagnostics(PLUGIN_ID)).toEqual([]);
    expect(await deps.platform.readText(deps.paths.diagnosticsFile)).toContain(
      "from another plugin",
    );
  });

  it("refuses plugin-initiated installs when no consent handler is registered", async () => {
    const { bridge, deps, document } = bridgeHarness();
    await installFixture(deps);
    const attaching = bridge.attachDocument(document.transport);
    document.ready();
    await attaching;

    receive(bridge.host, {
      pluginId: PLUGIN_ID,
      requestId: 2,
      targetId: "other.plugin",
      type: "install-plugin",
    });
    await until(() => answered(document.sent, 2));
    const last = document.sent.at(-1);
    expect(last).toMatchObject({ ok: false, requestId: 2 });
    expect(last && "error" in last ? last.error : "").toMatch(
      /without user consent/,
    );
  });

  it("surfaces an environment failure instead of blaming the plugin", async () => {
    const { bridge, deps, document, runtime } = bridgeHarness();
    await installFixture(deps);

    const attaching = bridge.attachDocument(document.transport);
    document.ready();
    await attaching;
    bridge.detachDocument();

    await expect(runtime.activate(PLUGIN_ID)).rejects.toThrow(
      /runtime document is not mounted/,
    );
    const records = await loadInstalledRecords(deps);
    expect(records[0].runtimeState).toBe("disabled");
    expect(records[0].runtimeError).toMatch(/runtime document is not mounted/);
  });

  it("re-activates a plugin whose document reloads mid-session", async () => {
    const { bridge, deps, document, runtime } = bridgeHarness();
    await installFixture(deps);
    const first = bridge.attachDocument(document.transport);
    document.ready();
    await first;
    expect(runtime.getState(PLUGIN_ID)).toBe("loaded");

    // A remount gives the surface a brand-new document: the bridge must
    // re-define and re-activate everything that was live (§73).
    const second = createDocumentSimulator(bridge.host);
    const remounting = bridge.attachDocument(second.transport);
    second.ready();
    await remounting;
    expect(
      second.sent.filter((message) => message.type === "define-plugin"),
    ).toHaveLength(1);
    expect(
      second.sent.filter((message) => message.type === "activate-plugin"),
    ).toHaveLength(1);
    expect(runtime.getState(PLUGIN_ID)).toBe("loaded");
  });
});

/* -------------------------------------------------------- command registry */

describe("plugin command registry", () => {
  it("registers, lists, invokes, and clears commands", () => {
    const invoked: string[] = [];
    const registry = createPluginCommandRegistry((name) => invoked.push(name));
    let changes = 0;
    registry.subscribe(() => {
      changes += 1;
    });

    registry.register("com.a", { exec: true, name: "second" });
    registry.register("com.a", { bindKey: { ctrl: "b" }, name: "first" });
    registry.register("com.b", { name: "third" });

    // Sorted by name; only a command with a real exec callback is runnable.
    expect(registry.list().map((command) => command.name)).toEqual([
      "first",
      "second",
      "third",
    ]);
    expect(registry.list()[0].executable).toBe(false);
    expect(registry.invoke("first")).toBe(false);
    expect(registry.invoke("second")).toBe(true);
    expect(invoked).toEqual(["second"]);

    registry.remove("com.a", "second");
    expect(registry.list().map((command) => command.name)).toEqual(["first", "third"]);

    registry.clear("com.a");
    expect(registry.list().map((command) => command.name)).toEqual(["third"]);
    registry.clear();
    expect(registry.list()).toEqual([]);
    expect(changes).toBeGreaterThan(4);
  });

  it("keeps two plugins' same-named commands apart", () => {
    const registry = createPluginCommandRegistry();
    registry.register("com.a", { exec: true, name: "shared" });
    registry.register("com.b", { exec: true, name: "shared" });
    expect(registry.list()).toHaveLength(2);
    registry.remove("com.a", "shared");
    expect(registry.list()).toEqual([
      {
        bindKey: null,
        chordId: null,
        description: null,
        executable: true,
        name: "shared",
        pluginId: "com.b",
      },
    ]);
  });
});
