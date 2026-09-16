/**
 * Package manager behaviour that is policy, not plumbing (§31/§33/§52/§53):
 * dependency-first installs, bounded retry with backoff, and reconciliation of
 * operations that were interrupted by the process dying.
 */
import { describe, expect, it } from "vitest";

import {
  installPackage,
  loadInstalledRecords,
  saveInstalledRecords,
  type InstallDeps,
} from "../installer";
import { createExtensionManager } from "../manager";
import type { ExtensionMetadata, ExtensionPermissionKey } from "../models";
import type { RegistryProvider } from "../registry";
import { ExtensionRuntime, installAcodeRuntime } from "../runtime";
import { planExtensionPaths } from "../storage";
import { createMemoryPlatform, zipOfFiles } from "./helpers";

const ALL_PERMISSIONS: ExtensionPermissionKey[] = [
  "commands",
  "editor",
  "network",
  "storage",
  "ui",
];

function packageBytes(id: string, version = "1.0.0", dependencies: string[] = []) {
  return zipOfFiles({
    "main.js": `window.${id} = true;`,
    "plugin.json": JSON.stringify({
      author: { name: "Tester" },
      dependencies,
      id,
      main: "main.js",
      name: id,
      version,
    }),
  });
}

function metadata(
  id: string,
  dependencies: { id: string; version: string | null }[] = [],
  version = "1.0.0",
): ExtensionMetadata {
  return {
    author: null,
    category: null,
    changelog: null,
    dependencies,
    description: null,
    download: null,
    icon: null,
    id,
    keywords: [],
    license: null,
    minVersionCode: null,
    minVersionName: null,
    name: id,
    price: 0,
    readme: null,
    repository: null,
    source: "registry",
    updatedAt: null,
    version,
  };
}

/** A registry whose downloads are served from the in-memory platform. */
function makeRig(input: {
  catalog: ExtensionMetadata[];
  packages: Record<string, Uint8Array>;
}) {
  const downloads: Record<string, Uint8Array> = {};
  for (const [id, bytes] of Object.entries(input.packages)) {
    downloads[`mem://${id}`] = bytes;
  }
  const { files, platform } = createMemoryPlatform({ downloads });
  const deps: InstallDeps = {
    paths: planExtensionPaths("file:///docs/"),
    platform,
  };
  const catalog = async () => input.catalog;
  const provider: RegistryProvider = {
    id: "test-registry",
    fetchCatalog: async () => ({ entries: input.catalog, version: null }),
    getExtension: async (id) => {
      const entry = input.catalog.find((item) => item.id === id);
      if (!entry) throw new Error(`getExtension: unknown id ${id}`);
      return entry;
    },
    getLatestVersion: async () => null,
    getVersions: async () => [],
    resolveDownload: async (id) => ({ kind: "url", url: `mem://${id}` }),
    search: async () => [],
  };
  const runtime = installAcodeRuntime(new ExtensionRuntime(deps));
  const manager = createExtensionManager({ catalog, deps, provider, runtime });
  return { catalog, deps, files, manager, platform, provider, runtime };
}

describe("dependency-aware installation", () => {
  it("installs the closure dependency-first, then the requested extension", async () => {
    const rig = makeRig({
      catalog: [
        metadata("com.a", [{ id: "com.b", version: null }]),
        metadata("com.b", [{ id: "com.c", version: null }]),
        metadata("com.c"),
      ],
      packages: {
        "com.a": packageBytes("com.a", "1.0.0", ["com.b"]),
        "com.b": packageBytes("com.b", "1.0.0", ["com.c"]),
        "com.c": packageBytes("com.c"),
      },
    });

    const result = await rig.manager.installWithDependencies("com.a", {
      acceptedPermissions: ALL_PERMISSIONS,
    });

    expect(result.issues).toEqual([]);
    expect(result.installed.map((record) => record.id)).toEqual([
      "com.c",
      "com.b",
      "com.a",
    ]);
    // Every package really landed on disk, newest last.
    const records = await loadInstalledRecords(rig.deps);
    expect(records.map((record) => record.id).sort()).toEqual([
      "com.a",
      "com.b",
      "com.c",
    ]);
    // Installing is not activating: nothing is enabled without consent.
    expect(records.every((record) => record.enabled === false)).toBe(true);
  });

  it("installs nothing when the plan is blocked", async () => {
    const rig = makeRig({
      catalog: [metadata("com.a", [{ id: "com.absent", version: "^2.0.0" }])],
      packages: { "com.a": packageBytes("com.a") },
    });

    const result = await rig.manager.installWithDependencies("com.a", {
      acceptedPermissions: ALL_PERMISSIONS,
    });

    expect(result.installed).toEqual([]);
    expect(result.issues).toContainEqual({
      id: "com.absent",
      kind: "missing",
      required: "^2.0.0",
      requiredBy: "com.a",
    });
    expect(await loadInstalledRecords(rig.deps)).toEqual([]);
  });

  it("stops before the root when a dependency cannot be installed", async () => {
    const rig = makeRig({
      catalog: [
        metadata("com.a", [{ id: "com.b", version: null }]),
        metadata("com.b"),
      ],
      // com.b has no downloadable package in this rig.
      packages: { "com.a": packageBytes("com.a") },
    });

    const result = await rig.manager.installWithDependencies("com.a", {
      acceptedPermissions: ALL_PERMISSIONS,
    });

    // The failure is reported rather than thrown: nothing else had been
    // installed yet, and the root was never attempted.
    expect(result.installed).toEqual([]);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({ id: "com.b", kind: "failed" });
    if (result.issues[0].kind === "failed") {
      expect(result.issues[0].message).toContain("com.b");
    }
    expect(await loadInstalledRecords(rig.deps)).toEqual([]);
  });

  it("reports the requirement when a dependency needs its own consent", async () => {
    const rig = makeRig({
      catalog: [
        metadata("com.a", [{ id: "com.b", version: null }]),
        metadata("com.b"),
      ],
      packages: {
        "com.a": packageBytes("com.a", "1.0.0", ["com.b"]),
        "com.b": packageBytes("com.b"),
      },
    });

    // No accepted permissions: the dependency asks for consent and the run
    // stops there rather than installing anything silently.
    const result = await rig.manager.installWithDependencies("com.a");
    expect(result.installed).toEqual([]);
    expect(result.issues[0]).toMatchObject({ id: "com.b", kind: "failed" });
    if (result.issues[0].kind === "failed") {
      expect(result.issues[0].message).toContain("permissions");
    }
  });
});

describe("update retry", () => {
  it("retries with exponential backoff and returns the eventual success", async () => {
    const rig = makeRig({
      catalog: [metadata("com.a")],
      packages: { "com.a": packageBytes("com.a") },
    });
    await rig.manager.install(
      { kind: "registry", pluginId: "com.a" },
      { acceptedPermissions: ALL_PERMISSIONS },
    );

    const delays: number[] = [];
    // The download fails twice, then succeeds: exactly the transient failure
    // a retry exists for. (The install stored a source URL, so the update
    // re-downloads rather than asking the registry again.)
    let attempts = 0;
    const flaky = createExtensionManager({
      catalog: async () => [metadata("com.a")],
      deps: {
        ...rig.deps,
        platform: {
          ...rig.platform,
          fetchBytes: async (url, onProgress) => {
            attempts += 1;
            if (attempts < 3) throw new Error("network hiccup");
            return rig.platform.fetchBytes(url, onProgress);
          },
        },
      },
      provider: rig.provider,
      runtime: rig.runtime,
    });

    const outcome = await flaky.updateWithRetry("com.a", {
      acceptedPermissions: ALL_PERMISSIONS,
      attempts: 3,
      baseDelayMs: 10,
      sleep: async (ms) => {
        delays.push(ms);
      },
    });

    expect(outcome.status).toBe("installed");
    // Only the failing attempts slept, doubling each time.
    expect(delays).toEqual([10, 20]);
  });

  it("rethrows the last failure once attempts are exhausted", async () => {
    const rig = makeRig({
      catalog: [metadata("com.a")],
      packages: { "com.a": packageBytes("com.a") },
    });
    await rig.manager.install(
      { kind: "registry", pluginId: "com.a" },
      { acceptedPermissions: ALL_PERMISSIONS },
    );

    const delays: number[] = [];
    // The download never succeeds, so every attempt fails.
    const broken = createExtensionManager({
      catalog: async () => [metadata("com.a")],
      deps: {
        ...rig.deps,
        platform: {
          ...rig.platform,
          fetchBytes: async () => {
            throw new Error("registry offline");
          },
        },
      },
      provider: rig.provider,
      runtime: rig.runtime,
    });

    await expect(
      broken.updateWithRetry("com.a", {
        attempts: 3,
        baseDelayMs: 5,
        sleep: async (ms) => {
          delays.push(ms);
        },
      }),
    ).rejects.toThrow(/registry offline/);
    expect(delays).toEqual([5, 10]);
  });

  it("refuses to retry an update for an extension that is not installed", async () => {
    const rig = makeRig({ catalog: [metadata("com.a")], packages: {} });
    await expect(
      rig.manager.updateWithRetry("com.missing", {
        attempts: 2,
        sleep: async () => {},
      }),
    ).rejects.toThrow(/not installed/);
  });
});

describe("interrupted operations", () => {
  it("repairs a record left mid-install and reads it back settled", async () => {
    const rig = makeRig({ catalog: [metadata("com.a")], packages: {} });
    await installPackage(
      rig.deps,
      { kind: "file", uri: "file:///docs/a.zip" },
      {},
    ).catch(() => {});

    // Manufacture the exact state a process kill leaves behind: the package
    // is on disk, the record still says an install was in flight.
    const bytes = packageBytes("com.a");
    await rig.platform.writeBinary("file:///docs/a.zip", bytes);
    await installPackage(
      rig.deps,
      { kind: "file", uri: "file:///docs/a.zip" },
      { acceptedPermissions: ALL_PERMISSIONS },
    );
    const current = await loadInstalledRecords(rig.deps);
    expect(current).toHaveLength(1);
    const interrupted = current.map((record) => ({
      ...record,
      enabled: true,
      runtimeState: "installing" as const,
    }));
    await saveInstalledRecords(rig.deps, interrupted);

    const records = await rig.manager.listInstalled();
    expect(records).toHaveLength(1);
    // The operation completed on disk, so the transient state is dropped and
    // the extension keeps the enabled flag it had before.
    expect(records[0].runtimeState).toBe("enabled");
    expect(records[0].enabled).toBe(true);
  });

  it("marks an interrupted install broken when its files are gone", async () => {
    const rig = makeRig({ catalog: [metadata("com.a")], packages: {} });
    await rig.platform.writeBinary("file:///docs/a.zip", packageBytes("com.a"));
    await installPackage(
      rig.deps,
      { kind: "file", uri: "file:///docs/a.zip" },
      { acceptedPermissions: ALL_PERMISSIONS },
    );
    const current = await loadInstalledRecords(rig.deps);
    await saveInstalledRecords(
      rig.deps,
      current.map((record) => ({ ...record, runtimeState: "updating" as const })),
    );
    // The package directory disappears between the crash and the next read.
    await rig.platform.deleteEntry(
      `${rig.deps.paths.installedRoot}/${current[0].id}`,
      "directory",
    );

    const records = await rig.manager.listInstalled();
    expect(records[0].runtimeState).toBe("broken");
    expect(records[0].enabled).toBe(false);
    expect(records[0].runtimeError).toContain("interrupted");
  });
});
