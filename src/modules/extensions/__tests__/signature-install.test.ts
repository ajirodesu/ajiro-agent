/**
 * Signed-package policy during installation (§51): the verdict is always
 * recorded, and the user's own preference decides whether it refuses the
 * install. Exercised through the real installer against a real ZIP, so the
 * payload a plugin publisher would sign is the payload the installer checks.
 */
import { ed25519 } from "@noble/curves/ed25519.js";
import { describe, expect, it } from "vitest";

import {
  installPackage,
  loadInstalledRecords,
  parseInstalledRecords,
  saveInstalledRecords,
  type InstallDeps,
  type InstallOutcome,
} from "../installer";
import { createExtensionManager } from "../manager";
import type {
  ExtensionMetadata,
  ExtensionPermissionKey,
  InstalledExtensionRecord,
} from "../models";
import type { RegistryProvider } from "../registry";
import { ExtensionRuntime, installAcodeRuntime } from "../runtime";
import { buildSigningPayload, encodeBase64 } from "../signature";
import { planExtensionPaths } from "../storage";
import { createMemoryPlatform, zipOfFiles } from "./helpers";

const PLUGIN_ID = "com.example.signed";
/** Exactly the set `deriveRequestedPermissions` infers for an entry script. */
const ALL_PERMISSIONS: ExtensionPermissionKey[] = [
  "commands",
  "editor",
  "network",
  "storage",
  "ui",
];

function metadata(id: string, dependencies: string[] = []): ExtensionMetadata {
  return {
    author: null,
    category: null,
    changelog: null,
    dependencies: dependencies.map((dependencyId) => ({
      id: dependencyId,
      version: null,
    })),
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
    version: "1.0.0",
  };
}

/** The exact file bytes a publisher signs, keyed by package-relative path. */
function packageFiles(version = "1.0.0", signature: unknown = null) {
  const files = new Map<string, Uint8Array>();
  const main = "acode.setPluginInit('com.example.signed', function () {});";
  const manifest = {
    author: { name: "Tester" },
    id: PLUGIN_ID,
    main: "main.js",
    name: "Signed Example",
    version,
    ...(signature ? { signature } : {}),
  };
  files.set("main.js", new TextEncoder().encode(main));
  files.set("plugin.json", new TextEncoder().encode(JSON.stringify(manifest)));
  return { files, manifest, version };
}

function keyPair() {
  const secret = ed25519.utils.randomSecretKey();
  return {
    keyId: "ajiros.publisher",
    publicKey: encodeBase64(ed25519.getPublicKey(secret)),
    secret,
  };
}

/** A ZIP whose plugin.json carries a signature over its exact contents. */
function signedPackage(input: {
  secret?: Uint8Array;
  keyId?: string;
  tamperAfterSigning?: boolean;
  version?: string;
}) {
  const { files, manifest, version } = packageFiles(input.version ?? "1.0.0");
  const payload = buildSigningPayload({
    files,
    manifest: { id: PLUGIN_ID, raw: manifest, version },
  });
  const value = input.secret
    ? encodeBase64(ed25519.sign(new TextEncoder().encode(payload), input.secret))
    : "AAAA";

  const signed = packageFiles(version, {
    algorithm: "ed25519",
    keyId: input.keyId ?? "ajiros.publisher",
    value,
  });
  return zipOfFiles({
    "main.js": new TextDecoder().decode(signed.files.get("main.js")),
    "plugin.json": new TextDecoder().decode(signed.files.get("plugin.json")),
    ...(input.tamperAfterSigning
      ? // The signature still covers the original entry point.
        { "helper.js": "exfiltrateEverything();" }
      : {}),
  });
}

function unsignedPackage(version = "1.0.0") {
  const { files } = packageFiles(version);
  return zipOfFiles({
    "main.js": new TextDecoder().decode(files.get("main.js")),
    "plugin.json": new TextDecoder().decode(files.get("plugin.json")),
  });
}

function setup() {
  const { files, platform } = createMemoryPlatform();
  const deps: InstallDeps = {
    paths: planExtensionPaths("file:///docs/"),
    platform,
  };
  const install = async (
    bytes: Uint8Array,
    policy?: { requireSigned: boolean; trustedKeys: Record<string, string> },
  ): Promise<InstallOutcome> => {
    await platform.writeBinary("file:///docs/pick.zip", bytes);
    return installPackage(
      deps,
      { kind: "file", uri: "file:///docs/pick.zip" },
      {
        acceptedPermissions: ALL_PERMISSIONS,
        ...(policy ? { signaturePolicy: policy } : {}),
      },
    );
  };
  return { deps, files, install, platform };
}

describe("recording a signature verdict", () => {
  it("records an unsigned package as unsigned and still installs it", async () => {
    const { install } = setup();
    const outcome = await install(unsignedPackage());
    if (outcome.status !== "installed") {
      throw new Error(`expected installed, got ${outcome.status}`);
    }
    // Acode publishes no signatures, so refusing by default would refuse the
    // entire ecosystem. The verdict is recorded, not acted on.
    expect(outcome.record.signature?.status).toBe("unsigned");
  });

  it("records a verified verdict for a package signed by a trusted key", async () => {
    const { install } = setup();
    const key = keyPair();
    const outcome = await install(signedPackage({ secret: key.secret }), {
      requireSigned: true,
      trustedKeys: { [key.keyId]: key.publicKey },
    });
    if (outcome.status !== "installed") {
      throw new Error(`expected installed, got ${outcome.status}`);
    }
    expect(outcome.record.signature).toEqual({
      detail: expect.stringContaining("matches this package's contents"),
      keyId: key.keyId,
      status: "verified",
    });
  });

  it("records an untrusted signer without blocking when the user allows it", async () => {
    const { install } = setup();
    const key = keyPair();
    const outcome = await install(signedPackage({ secret: key.secret }));
    if (outcome.status !== "installed") {
      throw new Error(`expected installed, got ${outcome.status}`);
    }
    // Signed by a key this device does not trust: honest, not hidden.
    expect(outcome.record.signature?.status).toBe("untrusted-key");
  });

  it("records a signature that does not match the package as invalid", async () => {
    const { install } = setup();
    const key = keyPair();
    const outcome = await install(
      signedPackage({ secret: key.secret, tamperAfterSigning: true }),
      { requireSigned: false, trustedKeys: { [key.keyId]: key.publicKey } },
    );
    if (outcome.status !== "installed") {
      throw new Error(`expected installed, got ${outcome.status}`);
    }
    expect(outcome.record.signature?.status).toBe("invalid");
  });
});

describe("requiring signed packages", () => {
  it("refuses an unsigned package and writes nothing to disk", async () => {
    const { deps, files, install } = setup();
    const outcome = await install(unsignedPackage(), {
      requireSigned: true,
      trustedKeys: {},
    });
    if (outcome.status !== "signature-rejected") {
      throw new Error(`expected signature-rejected, got ${outcome.status}`);
    }
    expect(outcome.verdict.status).toBe("unsigned");
    // Nothing staged, nothing recorded: a refused package leaves no trace.
    expect(await loadInstalledRecords(deps)).toHaveLength(0);
    expect(
      [...files.keys()].some((path) => path.includes(PLUGIN_ID)),
    ).toBe(false);
  });

  it("refuses a package signed by a key the user has not trusted", async () => {
    const { deps, install } = setup();
    const key = keyPair();
    const outcome = await install(signedPackage({ secret: key.secret }), {
      requireSigned: true,
      trustedKeys: { "some.other.key": key.publicKey },
    });
    if (outcome.status !== "signature-rejected") {
      throw new Error(`expected signature-rejected, got ${outcome.status}`);
    }
    expect(outcome.verdict).toMatchObject({ status: "untrusted-key" });
    expect(await loadInstalledRecords(deps)).toHaveLength(0);
  });

  it("refuses a tampered package whose signer is trusted", async () => {
    const { deps, install } = setup();
    const key = keyPair();
    const outcome = await install(
      signedPackage({ secret: key.secret, tamperAfterSigning: true }),
      { requireSigned: true, trustedKeys: { [key.keyId]: key.publicKey } },
    );
    if (outcome.status !== "signature-rejected") {
      throw new Error(`expected signature-rejected, got ${outcome.status}`);
    }
    expect(outcome.verdict.status).toBe("invalid");
    expect(await loadInstalledRecords(deps)).toHaveLength(0);
  });

  it("refuses a package claiming an unsupported algorithm", async () => {
    const { install } = setup();
    const { files, manifest, version } = packageFiles();
    const payload = buildSigningPayload({
      files,
      manifest: { id: PLUGIN_ID, raw: manifest, version },
    });
    expect(payload).toContain(PLUGIN_ID);
    const outcome = await install(
      zipOfFiles({
        "main.js": new TextDecoder().decode(files.get("main.js")),
        "plugin.json": JSON.stringify({
          ...manifest,
          signature: { algorithm: "rsa-pss", keyId: "k", value: "AAAA" },
        }),
      }),
      { requireSigned: true, trustedKeys: {} },
    );
    if (outcome.status !== "signature-rejected") {
      throw new Error(`expected signature-rejected, got ${outcome.status}`);
    }
    expect(outcome.verdict.status).toBe("unsupported-algorithm");
  });
});

describe("persisted verdicts", () => {
  it("round-trips a verdict and treats a legacy record as unknown", () => {
    const base: InstalledExtensionRecord = {
      compatibility: { level: "compatible", reasons: [] },
      enabled: false,
      id: PLUGIN_ID,
      installedAt: "2026-01-01T00:00:00Z",
      manifest: {},
      packageSha256: null,
      permissions: [],
      runtimeError: null,
      runtimeState: "disabled",
      signature: { detail: "checked", keyId: "k", status: "verified" },
      source: "local-file",
      sourceUrl: null,
      updatedAt: "2026-01-01T00:00:00Z",
      version: "1.0.0",
    };
    const parsed = parseInstalledRecords(JSON.stringify([base]));
    expect(parsed[0].signature).toEqual(base.signature);

    // Records written before signature support carry no field at all.
    const { signature: _dropped, ...legacy } = base;
    const fromLegacy = parseInstalledRecords(JSON.stringify([legacy]));
    expect(fromLegacy).toHaveLength(1);
    expect(fromLegacy[0].signature).toBeNull();

    // Corrupt data is unknown too, never a fabricated verdict.
    const corrupt = parseInstalledRecords(
      JSON.stringify([{ ...base, signature: { status: "totally-verified" } }]),
    );
    expect(corrupt[0].signature).toBeNull();
  });
});

describe("the manager applies the policy from preferences", () => {
  function rig(
    policy: () => Promise<{
      requireSigned: boolean;
      trustedKeys: Record<string, string>;
    }>,
    catalogEntries: ExtensionMetadata[] = [],
  ) {
    const bytes = unsignedPackage();
    const { files, platform } = createMemoryPlatform({
      downloads: { "mem://com.example.signed": bytes },
    });
    const deps: InstallDeps = {
      paths: planExtensionPaths("file:///docs/"),
      platform,
    };
    const provider: RegistryProvider = {
      id: "test-registry",
      fetchCatalog: async () => ({ entries: [], version: null }),
      getExtension: async (id) => {
        throw new Error(`getExtension is unused in this test (${id}).`);
      },
      getLatestVersion: async () => null,
      getVersions: async () => [],
      resolveDownload: async () => ({
        kind: "url",
        url: "mem://com.example.signed",
      }),
      search: async () => [],
    };
    const runtime = installAcodeRuntime(new ExtensionRuntime(deps));
    const manager = createExtensionManager({
      catalog: async () => catalogEntries,
      deps,
      provider,
      runtime,
      signaturePolicy: policy,
    });
    return { deps, files, manager };
  }

  it("installs when preferences do not require signatures", async () => {
    const { manager } = rig(async () => ({
      requireSigned: false,
      trustedKeys: {},
    }));
    const outcome = await manager.install(
      { kind: "registry", pluginId: PLUGIN_ID },
      { acceptedPermissions: ALL_PERMISSIONS },
    );
    expect(outcome.status).toBe("installed");
  });

  it("refuses when the preference requires signatures", async () => {
    const { manager } = rig(async () => ({
      requireSigned: true,
      trustedKeys: {},
    }));
    const outcome = await manager.install(
      { kind: "registry", pluginId: PLUGIN_ID },
      { acceptedPermissions: ALL_PERMISSIONS },
    );
    expect(outcome).toMatchObject({ status: "signature-rejected" });
  });

  it("fails closed when the preference store cannot be read", async () => {
    const { manager } = rig(async () => {
      throw new Error("preferences are unreadable");
    });
    // An unreadable policy must not become "trust everything": with no
    // trusted keys, only the installed verdict changes — the package still
    // installs, but its signature is reported as untrusted, never verified.
    const outcome = await manager.install(
      { kind: "registry", pluginId: PLUGIN_ID },
      { acceptedPermissions: ALL_PERMISSIONS },
    );
    if (outcome.status !== "installed") {
      throw new Error(`expected installed, got ${outcome.status}`);
    }
    expect(outcome.record.signature?.status).toBe("unsigned");
  });

  it("uses the policy again for each dependency in a closure", async () => {
    const dependency = zipOfFiles({
      "main.js": "window.dep = true;",
      "plugin.json": JSON.stringify({
        author: { name: "Tester" },
        id: "com.example.dep",
        main: "main.js",
        name: "Dependency",
        version: "1.0.0",
      }),
    });
    const { files, platform } = createMemoryPlatform({
      downloads: {
        "mem://com.example.dep": dependency,
        "mem://com.example.signed": unsignedPackage(),
      },
    });
    const deps: InstallDeps = {
      paths: planExtensionPaths("file:///docs/"),
      platform,
    };
    const provider: RegistryProvider = {
      id: "test-registry",
      fetchCatalog: async () => ({ entries: [], version: null }),
      getExtension: async (id) => {
        throw new Error(`getExtension is unused in this test (${id}).`);
      },
      getLatestVersion: async () => null,
      getVersions: async () => [],
      resolveDownload: async (id) => ({ kind: "url", url: `mem://${id}` }),
      search: async () => [],
    };
    const runtime = installAcodeRuntime(new ExtensionRuntime(deps));
    const manager = createExtensionManager({
      catalog: async () => [
        metadata(PLUGIN_ID, ["com.example.dep"]),
        metadata("com.example.dep"),
      ],
      deps,
      provider,
      runtime,
      signaturePolicy: async () => ({ requireSigned: true, trustedKeys: {} }),
    });
    const result = await manager.installWithDependencies(PLUGIN_ID, {
      acceptedPermissions: ALL_PERMISSIONS,
    });
    // The dependency is unsigned too, so the closure stops there with the
    // signature as the stated reason rather than a silent failure.
    expect(result.installed).toHaveLength(0);
    const issue = result.issues[0];
    if (!issue || issue.kind !== "failed") {
      throw new Error(`expected a failed issue, got ${issue?.kind ?? "none"}`);
    }
    expect(issue.id).toBe("com.example.dep");
    expect(issue.message).toContain("unsigned");
    // Nothing was written for either package.
    expect(await loadInstalledRecords(deps)).toHaveLength(0);
    expect([...files.keys()].some((path) => path.includes("com.example"))).toBe(
      false,
    );
  });
});

describe("saving records keeps the verdict", () => {
  it("loses nothing between save and load", async () => {
    const { deps } = setup();
    const records: InstalledExtensionRecord[] = [
      {
        compatibility: { level: "unknown", reasons: [] },
        enabled: false,
        id: PLUGIN_ID,
        installedAt: "2026-01-01T00:00:00Z",
        manifest: { id: PLUGIN_ID },
        packageSha256: null,
        permissions: [],
        runtimeError: null,
        runtimeState: "disabled",
        signature: { detail: "d", keyId: "k", status: "untrusted-key" },
        source: "registry",
        sourceUrl: null,
        updatedAt: "2026-01-01T00:00:00Z",
        version: "1.0.0",
      },
    ];
    await saveInstalledRecords(deps, records);
    const loaded = await loadInstalledRecords(deps);
    expect(loaded[0].signature).toEqual(records[0].signature);
  });
});
