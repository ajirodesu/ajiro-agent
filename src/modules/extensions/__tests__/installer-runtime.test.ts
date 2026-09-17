import { beforeEach, describe, expect, it } from "vitest";

import {
  installPackage,
  loadInstalledRecords,
  parseInstalledRecords,
  saveInstalledRecords,
  uninstallPackage,
  type InstallDeps,
  type InstallOutcome,
} from "../installer";
import type { ExtensionPermissionKey, InstalledExtensionRecord } from "../models";
import { createExtensionManager } from "../manager";
import type { RegistryProvider } from "../registry";
import {
  ExtensionRuntime,
  installAcodeRuntime,
  isThemePluginId,
} from "../runtime";
import { planExtensionPaths, pluginDataDir, pluginDir } from "../storage";
import {
  createFakeExecutionHost,
  createMemoryPlatform,
  zipOfFiles,
  type MemoryPlatformOptions,
} from "./helpers";

const MANIFEST = {
  author: { name: "Tester" },
  id: "com.example.plugin",
  main: "main.js",
  name: "Example Plugin",
  version: "1.0.0",
};

const ALL_PERMISSIONS = ["storage", "ui", "commands", "editor", "network"] as const;

function packageBytes(version = "1.0.0") {
  return zipOfFiles({
    "main.js": "window.alert('entry');",
    "plugin.json": JSON.stringify({ ...MANIFEST, version }),
  });
}

function setup(options?: MemoryPlatformOptions) {
  const { files, platform } = createMemoryPlatform(options);
  const deps: InstallDeps = {
    paths: planExtensionPaths("file:///docs/"),
    platform,
  };
  return { deps, files, platform };
}

/** Minimal registry stub that serves one downloadable URL. */
function urlProvider(url: string): RegistryProvider {
  return {
    id: "test-registry",
    fetchCatalog: async () => ({ entries: [], version: null }),
    getExtension: async (id) => {
      throw new Error(`getExtension is unused in this test (${id}).`);
    },
    getLatestVersion: async () => null,
    getVersions: async () => [],
    resolveDownload: async () => ({ kind: "url", url }),
    search: async () => [],
  };
}

/** Narrow an install outcome to its permission-consent payload. */
function pendingOf(outcome: InstallOutcome): ExtensionPermissionKey[] {
  if (outcome.status !== "needs-permissions") {
    throw new Error(`expected needs-permissions, got ${outcome.status}`);
  }
  return outcome.pending;
}

describe("package manager", () => {
  it("requires permission approval before installing", async () => {
    const { deps } = setup();
    await deps.platform.writeBinary("file:///docs/pick.zip", packageBytes());

    const refused = await installPackage(deps, {
      kind: "file",
      uri: "file:///docs/pick.zip",
    });
    const pending = pendingOf(refused);
    expect(pending.length).toBeGreaterThan(0);
    expect(await loadInstalledRecords(deps)).toHaveLength(0);
  });

  it("installs after permissions are accepted, staging files atomically", async () => {
    const { deps, files } = setup();
    await deps.platform.writeBinary("file:///docs/pick.zip", packageBytes());

    const refused = await installPackage(deps, {
      kind: "file",
      uri: "file:///docs/pick.zip",
    });
    const outcome = await installPackage(
      deps,
      { kind: "file", uri: "file:///docs/pick.zip" },
      { acceptedPermissions: pendingOf(refused) },
    );
    expect(outcome.status).toBe("installed");
    if (outcome.status !== "installed") return;

    const records = await loadInstalledRecords(deps);
    expect(records).toHaveLength(1);
    expect(records[0].id).toBe("com.example.plugin");
    expect(records[0].version).toBe("1.0.0");
    expect(records[0].packageSha256).toBeTruthy();
    expect(
      files.has(`${deps.paths.installedRoot}/com.example.plugin/main.js`),
    ).toBe(true);
    // The entry script only uses window/document, which the plugin host
    // document provides, so nothing about this package is unsupported.
    expect(outcome.record.compatibility.level).toBe("compatible");
    expect(outcome.record.compatibility.reasons.join(" ")).toContain(
      "plugin host document",
    );
    // Nothing left in staging.
    expect(
      [...files.keys()].filter((key) => key.startsWith(deps.paths.stagingRoot)),
    ).toHaveLength(0);
  });

  it("reports missing dependencies instead of silently installing", async () => {
    const { deps } = setup();
    await deps.platform.writeBinary(
      "file:///docs/dep.zip",
      zipOfFiles({
        "main.js": "x();",
        "plugin.json": JSON.stringify({
          dependencies: ["other.required.plugin"],
          id: "com.example.needsdep",
          main: "main.js",
          name: "NeedsDep",
          version: "1.0.0",
        }),
      }),
    );
    const outcome = await installPackage(
      deps,
      { kind: "file", uri: "file:///docs/dep.zip" },
      { acceptedPermissions: [...ALL_PERMISSIONS] },
    );
    expect(outcome.status).toBe("needs-dependencies");
    if (outcome.status === "needs-dependencies") {
      expect(outcome.missing).toEqual(["other.required.plugin"]);
    }
  });

  it("replaces the previous version atomically and cleans backups", async () => {
    const { deps, files } = setup();
    await deps.platform.writeBinary("file:///docs/v1.zip", packageBytes("1.0.0"));
    await deps.platform.writeBinary("file:///docs/v2.zip", packageBytes("1.2.0"));

    await installPackage(deps, { kind: "file", uri: "file:///docs/v1.zip" }, {
      acceptedPermissions: [...ALL_PERMISSIONS],
    });
    const update = await installPackage(
      deps,
      { kind: "file", uri: "file:///docs/v2.zip" },
      { acceptedPermissions: [...ALL_PERMISSIONS] },
    );
    expect(update.status).toBe("installed");
    if (update.status !== "installed") return;
    expect(update.record.version).toBe("1.2.0");

    const records = await loadInstalledRecords(deps);
    expect(records).toHaveLength(1);
    expect(records[0].version).toBe("1.2.0");
    expect(
      [...files.keys()].filter((key) => key.startsWith(deps.paths.backupsRoot)),
    ).toHaveLength(0);
  });

  it("rejects invalid packages without touching the install", async () => {
    const { deps } = setup();
    await deps.platform.writeBinary(
      "file:///docs/broken.zip",
      new TextEncoder().encode("definitely not a zip"),
    );
    await expect(
      installPackage(
        deps,
        { kind: "file", uri: "file:///docs/broken.zip" },
        { acceptedPermissions: [...ALL_PERMISSIONS] },
      ),
    ).rejects.toThrow();
    expect(await loadInstalledRecords(deps)).toHaveLength(0);
  });

  it("uninstalls the package tree, data dirs, and record", async () => {
    const { deps, files } = setup();
    await deps.platform.writeBinary("file:///docs/pkg.zip", packageBytes());
    const outcome = await installPackage(
      deps,
      { kind: "file", uri: "file:///docs/pkg.zip" },
      { acceptedPermissions: [...ALL_PERMISSIONS] },
    );
    if (outcome.status !== "installed") throw new Error("expected install");

    await uninstallPackage(deps, "com.example.plugin");
    expect(await loadInstalledRecords(deps)).toHaveLength(0);
    expect(
      [...files.keys()].filter((key) => key.includes("com.example.plugin")),
    ).toHaveLength(0);
  });

  it("tolerates a corrupt records file", () => {
    expect(parseInstalledRecords("{broken")).toEqual([]);
    expect(parseInstalledRecords(null)).toEqual([]);
  });
});

describe("extension package manager", () => {
  async function installViaManager(
    version = "1.0.0",
    downloads?: Record<string, Uint8Array>,
  ) {
    const { deps, files } = setup({ downloads });
    const platform = deps.platform;
    await platform.writeBinary(`file:///docs/v${version}.zip`, packageBytes(version));
    const runtime = new ExtensionRuntime(deps);
    // Plugin entry scripts execute inside the plugin host document, so every
    // runtime that activates a plugin needs an execution host.
    const host = createFakeExecutionHost();
    runtime.setExecutionHost(host);
    const manager = createExtensionManager({ deps, runtime });
    const outcome = await manager.install(
      { kind: "file", uri: `file:///docs/v${version}.zip` },
      { acceptedPermissions: [...ALL_PERMISSIONS] },
    );
    if (outcome.status !== "installed") throw new Error("expected install");
    return { deps, files, host, manager, platform, runtime };
  }

  it("retains the replaced version as a rollback point when asked", async () => {
    const { files, host, manager, platform, runtime } =
      await installViaManager("1.0.0");
    await manager.enable("com.example.plugin");
    expect(runtime.getState("com.example.plugin")).toBe("loaded");
    expect(host.activated).toEqual(["com.example.plugin"]);

    await platform.writeBinary("file:///docs/v1.2.0.zip", packageBytes("1.2.0"));
    const updated = await manager.install(
      { kind: "file", uri: "file:///docs/v1.2.0.zip" },
      { acceptedPermissions: [...ALL_PERMISSIONS], retainBackup: true },
    );
    expect(updated.status).toBe("installed");

    const records = await manager.listInstalled();
    expect(records[0].version).toBe("1.2.0");
    expect(await manager.hasRollbackPoint("com.example.plugin")).toBe(true);
    expect([...files.keys()].some((key) => key.includes("/backups/"))).toBe(true);
    // A plain install never re-activates the extension (§17).
    expect(host.activated).toHaveLength(1);
  });

  it("updates through the registry, re-activates an enabled extension, and clears the rollback point", async () => {
    const updateUrl = "https://registry.test/plugin-1.3.0.zip";
    const { deps, host, manager, runtime } = await installViaManager("1.0.0", {
      [updateUrl]: packageBytes("1.3.0"),
    });
    const updating = createExtensionManager({
      deps,
      provider: urlProvider(updateUrl),
      runtime,
    });
    await manager.enable("com.example.plugin");
    expect(host.activated).toHaveLength(1);

    const outcome = await updating.update("com.example.plugin");
    expect(outcome.status).toBe("installed");
    const records = await updating.listInstalled();
    expect(records[0].version).toBe("1.3.0");
    // Enabled before the update → activated after it, and the replaced
    // version is dropped once the new one loads.
    expect(host.activated).toHaveLength(2);
    expect(runtime.getState("com.example.plugin")).toBe("loaded");
    expect(await updating.hasRollbackPoint("com.example.plugin")).toBe(false);
  });

  it("keeps the rollback point when the updated version fails to activate", async () => {
    const updateUrl = "https://registry.test/broken-2.0.0.zip";
    const { deps, host, manager, runtime } = await installViaManager("1.0.0", {
      [updateUrl]: packageBytes("2.0.0"),
    });
    const updating = createExtensionManager({
      deps,
      provider: urlProvider(updateUrl),
      runtime,
    });
    await manager.enable("com.example.plugin");
    // The replacement version throws while initializing.
    host.failNext("2.0.0 is broken");

    await expect(updating.update("com.example.plugin")).rejects.toThrow(
      /2.0.0 is broken/,
    );
    const records = await updating.listInstalled();
    expect(records[0].runtimeState).toBe("broken");
    // A failed activation must leave the previous version recoverable.
    expect(await updating.hasRollbackPoint("com.example.plugin")).toBe(true);
    const restored = await updating.rollback("com.example.plugin");
    expect(restored.version).toBe("1.0.0");
  });

  it("rolls back to the retained version and re-validates the restored package", async () => {
    const { deps, manager, platform, runtime } = await installViaManager("1.0.0");
    await platform.writeBinary("file:///docs/v2.zip", packageBytes("2.0.0"));
    await manager.install(
      { kind: "file", uri: "file:///docs/v2.zip" },
      { acceptedPermissions: [...ALL_PERMISSIONS], retainBackup: true },
    );
    expect((await manager.listInstalled())[0].version).toBe("2.0.0");

    const restored = await manager.rollback("com.example.plugin");
    expect(restored.version).toBe("1.0.0");
    expect(restored.runtimeState).toBe("disabled");
    expect(restored.packageSha256).toBeNull();
    expect(restored.compatibility.level).toBe("compatible");
    // The rollback point is consumed by the restore.
    expect(await manager.hasRollbackPoint("com.example.plugin")).toBe(false);
    expect(runtime.getState("com.example.plugin")).toBe("disabled");

    const onDisk = await platform.readText(
      `${deps.paths.installedRoot}/com.example.plugin/plugin.json`,
    );
    expect(onDisk).toContain("1.0.0");
  });

  it("refuses to roll back when no previous version was retained", async () => {
    const { manager } = await installViaManager("1.0.0");
    await expect(manager.rollback("com.example.plugin")).rejects.toThrow(
      /no version to roll back to/,
    );
  });

  it("keeps a plain install free of rollback state", async () => {
    const { manager } = await installViaManager("1.0.0");
    expect(await manager.hasRollbackPoint("com.example.plugin")).toBe(false);
    await expect(manager.rollback("com.example.plugin")).rejects.toThrow();
  });

  it("disables without uninstalling, then re-enables through activation", async () => {
    const { host, manager } = await installViaManager("1.0.0");
    const enabled = await manager.enable("com.example.plugin");
    expect(enabled.enabled).toBe(true);

    const disabled = await manager.disable("com.example.plugin");
    expect(disabled.enabled).toBe(false);
    expect(disabled.runtimeState).toBe("disabled");
    // Still installed: disabling is not uninstalling (§34).
    expect(await manager.listInstalled()).toHaveLength(1);
    // Disabling unmounts the plugin inside the runtime document.
    expect(host.unmounted).toEqual(["com.example.plugin"]);
  });

  it("recovers a broken extension after the mark is cleared", async () => {
    const { host, manager } = await installViaManager("1.0.0");
    host.failNext("init exploded");
    await expect(manager.enable("com.example.plugin")).rejects.toThrow(
      /init exploded/,
    );
    expect((await manager.listInstalled())[0].runtimeState).toBe("broken");

    const cleared = await manager.clearBrokenMark("com.example.plugin");
    expect(cleared.runtimeState).toBe("disabled");
    expect(cleared.runtimeError).toBeNull();
  });
});

describe("acode compatibility runtime", () => {
  let deps: InstallDeps;

  beforeEach(() => {
    deps = setup().deps;
  });

  async function installEnabled(options: { entry?: boolean } = {}) {
    await deps.platform.writeBinary("file:///docs/pkg.zip", packageBytes());
    const outcome = await installPackage(
      deps,
      { kind: "file", uri: "file:///docs/pkg.zip" },
      { acceptedPermissions: [...ALL_PERMISSIONS] },
    );
    if (outcome.status !== "installed") throw new Error("expected install");
    // Enable the record (the UI does this through the enable flow).
    const records = await loadInstalledRecords(deps);
    await deps.platform.writeText(
      deps.paths.installedFile,
      JSON.stringify({
        extensions: records.map((record) => ({ ...record, enabled: true })),
      }),
    );
    return outcome;
  }

  it("hands the entry script and Acode's baseUrl to the execution host", async () => {
    await installEnabled();
    const runtime = new ExtensionRuntime(deps);
    const host = createFakeExecutionHost();
    runtime.setExecutionHost(host);

    await runtime.activate("com.example.plugin");

    expect(host.loaded).toHaveLength(1);
    expect(host.loaded[0].pluginId).toBe("com.example.plugin");
    expect(host.loaded[0].baseUrl).toBe(
      deps.paths.installedRoot + "/com.example.plugin",
    );
    // The plugin's own source, read from its installed package.
    expect(host.loaded[0].source).toContain("window.alert");
    expect(host.activated).toEqual(["com.example.plugin"]);
    expect(runtime.getState("com.example.plugin")).toBe("loaded");
  });

  it("refuses to call an entry-script plugin loaded without a runtime document", async () => {
    await installEnabled();
    const runtime = new ExtensionRuntime(deps);

    // No execution host: the entry script cannot run, so reporting "loaded"
    // would be a lie. Ours is the fault, so the plugin is not marked broken.
    await expect(runtime.activate("com.example.plugin")).rejects.toThrow(
      /runtime document is not mounted/,
    );
    expect(runtime.getState("com.example.plugin")).toBe("disabled");
    const records = await loadInstalledRecords(deps);
    expect(records[0].runtimeState).toBe("disabled");
    expect(records[0].enabled).toBe(false);

    // Retryable as soon as a document exists: nothing was recorded as a
    // plugin fault, so the user just enables it again.
    const enabled = await loadInstalledRecords(deps);
    await deps.platform.writeText(
      deps.paths.installedFile,
      JSON.stringify({
        extensions: enabled.map((record) => ({ ...record, enabled: true })),
      }),
    );
    const host = createFakeExecutionHost();
    runtime.setExecutionHost(host);
    await runtime.activate("com.example.plugin");
    expect(runtime.getState("com.example.plugin")).toBe("loaded");
    expect(host.activated).toEqual(["com.example.plugin"]);
  });

  it("records the settings declaration passed to setPluginInit", async () => {
    // No activation happens here, so an entry script is harmless (and proves
    // setPluginInit is recorded before anything executes).
    await installEnabled();
    const runtime = new ExtensionRuntime(deps);
    runtime.buildAcodeGlobal().setPluginInit(
      "com.example.plugin",
      () => undefined,
      { list: [{ key: "mode", text: "Mode" }] },
    );
    expect(runtime.getPluginSettings("com.example.plugin")).toEqual({
      list: [{ key: "mode", text: "Mode" }],
    });
  });

  it("marks a plugin broken and auto-disables it when init hangs", async () => {
    await installEnabled();
    const runtime = new ExtensionRuntime(deps, { initTimeoutMs: 10 });
    const host = createFakeExecutionHost();
    runtime.setExecutionHost(host);
    // Never settles: stands in for a plugin waiting on a DOM event.
    host.hangNext();

    await expect(runtime.activate("com.example.plugin")).rejects.toThrow(
      /did not finish within 10 ms/,
    );
    expect(runtime.getState("com.example.plugin")).toBe("broken");
    const records = await loadInstalledRecords(deps);
    expect(records[0].runtimeState).toBe("broken");
  });

  it("marks broken on init crash and blocks retries until cleared", async () => {
    await installEnabled();
    const runtime = new ExtensionRuntime(deps);
    const acode = runtime.buildAcodeGlobal();
    const host = createFakeExecutionHost();
    runtime.setExecutionHost(host);
    host.failNext("boom");
    await expect(runtime.activate("com.example.plugin")).rejects.toThrow(/boom/);
    expect(runtime.getState("com.example.plugin")).toBe("broken");

    const records = await loadInstalledRecords(deps);
    expect(records[0].runtimeState).toBe("broken");
    expect(records[0].runtimeError).toMatch(/boom/);
    // Acode auto-disables a broken plugin so it cannot be retried in a loop.
    expect(records[0].enabled).toBe(false);

    await expect(runtime.activate("com.example.plugin")).rejects.toThrow(/broken/);
    await acode.clearBrokenPluginMark("com.example.plugin");
    expect(runtime.getState("com.example.plugin")).toBe("disabled");
    const afterClear = await loadInstalledRecords(deps);
    expect(afterClear[0].runtimeState).toBe("disabled");
    expect(afterClear[0].runtimeError).toBeNull();
  });

  it("runs unmount callbacks and cleans tracked resources on deactivate", async () => {
    await installEnabled();
    const runtime = new ExtensionRuntime(deps);
    const host = createFakeExecutionHost();
    runtime.setExecutionHost(host);
    const acode = runtime.buildAcodeGlobal();
    let unmounted = 0;
    let cleaned = 0;
    acode.setPluginInit("com.example.plugin", () => undefined);
    acode.setPluginUnmount("com.example.plugin", () => {
      unmounted += 1;
    });
    await runtime.activate("com.example.plugin");
    runtime.trackResource("com.example.plugin", "timer", () => {
      cleaned += 1;
    });
    await runtime.deactivate("com.example.plugin");
    expect(unmounted).toBe(1);
    expect(cleaned).toBe(1);
    expect(runtime.getState("com.example.plugin")).toBe("disabled");
  });

  it("waitForPlugin resolves true on load and rejects when broken/missing", async () => {
    await installEnabled();
    const runtime = new ExtensionRuntime(deps);
    runtime.setExecutionHost(createFakeExecutionHost());

    const pending = runtime.waitForPlugin("com.example.plugin");
    await runtime.activate("com.example.plugin");
    await expect(pending).resolves.toBe(true);

    await expect(runtime.waitForPlugin("missing.plugin")).rejects.toThrow(
      /does not exist/,
    );
  });

  it("protects core modules and routes installs through consent", async () => {
    const runtime = new ExtensionRuntime(null);
    const acode = runtime.buildAcodeGlobal();
    acode.define("my-module", { value: 42 });
    // Acode documents module names as case insensitive.
    expect(acode.require("MY-Module")).toEqual({ value: 42 });
    expect(() => acode.define("commands", {})).toThrow(/reserved/);
    expect(() => acode.define("Commands", {})).toThrow(/reserved/);
    // Ajiro has no Acode implementation of the core modules, so requiring one
    // fails loudly instead of returning a stub that cannot work.
    expect(() => acode.require("commands")).toThrow(/not provided/);

    await expect(acode.installPlugin("some.plugin")).rejects.toThrow(
      /authorization/,
    );
    let requested: string | null = null;
    runtime.setInstallRequestHandler(async (pluginId) => {
      requested = pluginId;
    });
    await acode.installPlugin("some.plugin");
    expect(requested).toBe("some.plugin");
  });

  it("installs the global acode object once", () => {
    const first = installAcodeRuntime();
    const second = installAcodeRuntime();
    expect(second).toBe(first);
    expect(globalThis.acode).toBeDefined();
    expect(typeof globalThis.acode?.require).toBe("function");
  });

  it("detects theme plugins the way Acode does", () => {
    // Acode's isThemePlugin: case-insensitive substring match on the id.
    expect(isThemePluginId("acode.plugin.monokai")).toBe(true);
    expect(isThemePluginId("ACODE.PLUGIN.DRACULA-THEME")).toBe(true);
    expect(isThemePluginId("acode.plugin.extra_syntax_highlights")).toBe(true);
    expect(isThemePluginId("com.example.tools")).toBe(false);
    expect(isThemePluginId("acode.plugin.python")).toBe(false);
  });

  it("restores theme plugins before other plugins", async () => {
    // Acode loads theme plugins first so a theme is in place before other
    // plugins initialize; the order here is installation order, proving the
    // runtime re-sorts rather than inheriting it.
    const { deps } = setup();
    const record = (id: string): InstalledExtensionRecord => ({
      compatibility: { level: "compatible", reasons: [] },
      enabled: true,
      id,
      installedAt: "2026-01-01T00:00:00Z",
      manifest: { main: "main.js" },
      packageSha256: null,
      permissions: [],
      runtimeError: null,
      runtimeState: "enabled",
      signature: null,
      source: "registry",
      sourceUrl: null,
      updatedAt: "2026-01-01T00:00:00Z",
      version: "1.0.0",
    });
    const records = [record("com.example.tools"), record("com.example.monokai")];
    await saveInstalledRecords(deps, records);
    for (const entry of records) {
      await deps.platform.writeText(
        `${pluginDir(deps.paths, entry.id)}/main.js`,
        "acode.setPluginInit('x', () => {});",
      );
    }
    const runtime = new ExtensionRuntime(deps);
    const host = createFakeExecutionHost();
    runtime.setExecutionHost(host);
    await runtime.restoreActivePlugins();
    expect(host.activated).toEqual(["com.example.monokai", "com.example.tools"]);
  });

  it("clears the plugin cache directory on deactivation, keeping settings", async () => {
    // Mirrors Acode's unmountPlugin, which always deletes the plugin cache.
    const { platform } = createMemoryPlatform();
    const deps: InstallDeps = { paths: planExtensionPaths("file:///docs/"), platform };
    const cacheDir = pluginDataDir(deps.paths, "com.example.plugin", "cache");
    const settingsDir = pluginDataDir(deps.paths, "com.example.plugin", "settings");
    await platform.writeText(`${cacheDir}/cache.json`, "{}");
    await platform.writeText(`${settingsDir}/settings.json`, "{}");

    const runtime = new ExtensionRuntime(deps);
    await runtime.deactivate("com.example.plugin");

    expect(await platform.exists(cacheDir, "directory")).toBe(false);
    expect(await platform.exists(`${settingsDir}/settings.json`, "file")).toBe(true);
  });
});


