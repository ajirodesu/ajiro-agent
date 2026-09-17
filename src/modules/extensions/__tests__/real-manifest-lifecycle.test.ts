/**
 * Lifecycle with real manifests (prompt §74): the exact manifests real
 * publishers ship (see `real-plugin-fixtures.test.ts` for provenance) go
 * through install → enable/activate → disable → update → rollback →
 * uninstall. The entry scripts are minimal representative shims — they use
 * only `setPluginInit`/`setPluginUnmount`, which is all the lifecycle needs
 * — and this is stated here rather than implied, because the real `dist`
 * bundles require network and device APIs outside a unit test.
 */
import { describe, expect, it } from "vitest";

import { installPackage, type InstallDeps } from "../installer";
import { createExtensionManager } from "../manager";
import type { RegistryProvider } from "../registry";
import { ExtensionRuntime } from "../runtime";
import { planExtensionPaths } from "../storage";
import pythonManifestJson from "./fixtures/acode.plugin.python.plugin.json";
import snippetsManifestJson from "./fixtures/acode.plugin.snippets.plugin.json";
import {
  createFakeExecutionHost,
  createMemoryPlatform,
  zipOfFiles,
} from "./helpers";

function setup(downloads: Record<string, Uint8Array> = {}) {
  const { platform } = createMemoryPlatform({ downloads });
  const deps: InstallDeps = { paths: planExtensionPaths("file:///docs/"), platform };
  const runtime = new ExtensionRuntime(deps);
  const host = createFakeExecutionHost();
  runtime.setExecutionHost(host);
  const manager = createExtensionManager({ deps, runtime });
  return { deps, host, manager, runtime };
}

function packageBytes(manifest: unknown, version: string, files: Record<string, string>) {
  return zipOfFiles({
    ...files,
    "plugin.json": JSON.stringify({ ...(manifest as Record<string, unknown>), version }),
  });
}

async function writeZip(
  deps: InstallDeps,
  uri: string,
  manifest: unknown,
  version: string,
  files: Record<string, string>,
) {
  await deps.platform.writeBinary(uri, packageBytes(manifest, version, files));
}

/** Registry stub serving one downloadable URL (mirrors installer tests). */
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

async function installFile(
  manager: ReturnType<typeof createExtensionManager>,
  deps: InstallDeps,
  manifest: unknown,
  version: string,
  files: Record<string, string>,
) {
  await writeZip(deps, "file:///docs/pick.zip", manifest, version, files);
  const first = await installPackage(deps, { kind: "file", uri: "file:///docs/pick.zip" });
  if (first.status !== "needs-permissions") {
    throw new Error(`expected needs-permissions, got ${first.status}`);
  }
  const outcome = await installPackage(
    deps,
    { kind: "file", uri: "file:///docs/pick.zip" },
    { acceptedPermissions: first.pending },
  );
  if (outcome.status !== "installed") {
    throw new Error(`expected installed, got ${outcome.status}`);
  }
  return outcome;
}

const PYTHON_FILES = {
  "dist/main.js": "acode.setPluginInit('acode.plugin.python', function () {});",
  "icon.png": "fake-png-bytes",
};

describe("real-manifest lifecycle (python)", () => {
  it("installs, activates, disables, updates, rolls back, and uninstalls", async () => {
    const updateUrl = "https://registry.test/python-1.1.5.zip";
    const { deps, host, manager, runtime } = setup({
      [updateUrl]: packageBytes(pythonManifestJson, "1.1.5", PYTHON_FILES),
    });

    await installFile(manager, deps, pythonManifestJson, "1.1.4", PYTHON_FILES);
    const enabled = await manager.enable("acode.plugin.python");
    expect(enabled.enabled).toBe(true);
    expect(runtime.getState("acode.plugin.python")).toBe("loaded");
    expect(host.activated).toContain("acode.plugin.python");

    const disabled = await manager.disable("acode.plugin.python");
    expect(disabled.enabled).toBe(false);
    expect(host.unmounted).toContain("acode.plugin.python");

    // A published 1.1.5 arrives through the registry while the plugin is
    // disabled, so the replaced 1.1.4 is retained and restored by rollback
    // (the enabled re-activation path is covered by the installer suite).
    const updating = createExtensionManager({
      deps,
      provider: urlProvider(updateUrl),
      runtime,
    });
    const updated = await updating.update("acode.plugin.python");
    expect(updated.status).toBe("installed");
    expect(await updating.hasRollbackPoint("acode.plugin.python")).toBe(true);
    const rolledBack = await updating.rollback("acode.plugin.python");
    expect(rolledBack.version).toBe("1.1.4");

    await manager.enable("acode.plugin.python");
    expect(host.activated).toContain("acode.plugin.python");
    await updating.uninstall("acode.plugin.python");
    expect(await updating.listInstalled()).toHaveLength(0);
  });
});

describe("real-manifest lifecycle (snippets, many files)", () => {
  it("installs a 55-file package and activates it", async () => {
    const { deps, host, manager } = setup();
    const files: Record<string, string> = {
      "dist/main.js": "acode.setPluginInit('acode.plugin.snippets', function () {});",
      "icon.png": "fake-png-bytes",
      "readme.md": "# Snippets",
    };
    for (const file of snippetsManifestJson.files as string[]) {
      files[file] = "# snippet file";
    }
    await installFile(manager, deps, snippetsManifestJson, "2.0.0", files);
    const records = await manager.listInstalled();
    expect(records).toHaveLength(1);

    await manager.enable("acode.plugin.snippets");
    expect(host.activated).toContain("acode.plugin.snippets");
    await manager.uninstall("acode.plugin.snippets");
    expect(await manager.listInstalled()).toHaveLength(0);
  });
});
