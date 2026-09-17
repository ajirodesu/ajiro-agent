import { describe, expect, it } from "vitest";

import {
  checkMcpPresetSupport,
  deriveMcpPresetStatus,
  filterRevokedMcpPresets,
  findMissingMcpDependencies,
  findRevokedMcpServers,
} from "../mcp-compat";
import { parseMcpServerCatalog, resetMcpServerCatalogCache } from "../catalog";
import type { McpServerPreset } from "../catalog";

function preset(overrides: Partial<McpServerPreset> = {}): McpServerPreset {
  const base: McpServerPreset = {
    authMode: "none",
    capabilities: [],
    channel: null,
    changelog: null,
    dependencies: [],
    deprecated: false,
    description: "Test server.",
    headerTemplate: null,
    id: "test-server",
    label: "Test",
    maxAppVersion: null,
    minAppVersion: null,
    oauthAllowedAuthOrigin: null,
    oauthAuthorizationUrl: null,
    oauthClientId: null,
    oauthScopes: null,
    oauthTokenUrl: null,
    platforms: [],
    publishedAt: null,
    publisher: null,
    requiredCapabilities: [],
    revoked: false,
    rolloutPercent: null,
    transport: "http",
    updatedAt: null,
    url: "https://example.com/mcp",
    version: null,
  };
  return Object.assign(base, overrides);
}

describe("mcp catalog parsing", () => {
  it("accepts the legacy shape without dynamic metadata", () => {
    const presets = parseMcpServerCatalog({
      servers: [
        {
          authMode: "none",
          description: "d",
          id: "a",
          label: "A",
          transport: "http",
          url: "https://example.com/mcp",
        },
      ],
      version: 1,
    });
    expect(presets[0]).toMatchObject({
      channel: null,
      deprecated: false,
      revoked: false,
      version: null,
    });
    resetMcpServerCatalogCache();
  });

  it("parses dynamic metadata and rejects bad values", () => {
    const presets = parseMcpServerCatalog({
      servers: [
        {
          authMode: "none",
          channel: "beta",
          description: "d",
          id: "a",
          label: "A",
          minAppVersion: "2.0.0",
          requiredCapabilities: ["mcp:http"],
          rolloutPercent: 25,
          transport: "http",
          url: "https://example.com/mcp",
          version: "1.2.0",
        },
      ],
      version: 1,
    });
    expect(presets[0]).toMatchObject({
      channel: "beta",
      minAppVersion: "2.0.0",
      rolloutPercent: 25,
      version: "1.2.0",
    });
    expect(() =>
      parseMcpServerCatalog({
        servers: [
          {
            authMode: "none",
            channel: "nightly",
            description: "d",
            id: "a",
            label: "A",
            transport: "http",
            url: "https://example.com/mcp",
          },
        ],
        version: 1,
      }),
    ).toThrow(/channel/);
  });
});

describe("mcp preset metadata", () => {
  it("parses publisher, platforms, ceilings, timestamps, and dependencies", () => {
    const presets = parseMcpServerCatalog({
      servers: [
        {
          authMode: "none",
          capabilities: ["search", "read"],
          dependencies: ["other-server"],
          description: "d",
          id: "a",
          label: "A",
          maxAppVersion: "2.0.0",
          platforms: ["Android", "iOS"],
          publishedAt: "2026-01-01",
          publisher: "Example",
          transport: "http",
          updatedAt: "2026-02-01",
          url: "https://example.com/mcp",
        },
      ],
      version: 1,
    });
    expect(presets[0]).toMatchObject({
      capabilities: ["search", "read"],
      dependencies: ["other-server"],
      maxAppVersion: "2.0.0",
      platforms: ["android", "ios"],
      publishedAt: "2026-01-01",
      publisher: "Example",
      updatedAt: "2026-02-01",
    });
    expect(() =>
      parseMcpServerCatalog({
        servers: [
          {
            authMode: "none",
            description: "d",
            id: "a",
            label: "A",
            platforms: "android",
            transport: "http",
            url: "https://example.com/mcp",
          },
        ],
        version: 1,
      }),
    ).toEqual([]);
  });
});

describe("mcp preset support", () => {
  it("revokes first, then gates unknown transports and runtimes", () => {
    expect(checkMcpPresetSupport(preset({ revoked: true })).status).toBe("revoked");
    expect(
      checkMcpPresetSupport(preset({ transport: "stdio" as never })).status,
    ).toBe("requires-app-update");
    expect(
      checkMcpPresetSupport(preset({ minAppVersion: "9.9.9" }), {
        appVersion: "1.1.5",
      }).status,
    ).toBe("requires-app-update");
    expect(
      checkMcpPresetSupport(preset({ requiredCapabilities: ["arKit"] })).status,
    ).toBe("requires-app-update");
    expect(
      checkMcpPresetSupport(preset({ deprecated: true })).status,
    ).toBe("deprecated");
    expect(checkMcpPresetSupport(preset()).status).toBe("not-installed");
  });

  it("separates wrong-platform and exceeded-ceiling incompatibility", () => {
    expect(
      checkMcpPresetSupport(preset({ platforms: ["ios"] }), { platform: "android" })
        .status,
    ).toBe("incompatible");
    expect(
      checkMcpPresetSupport(preset({ platforms: ["ios"] }), { platform: "ios" })
        .status,
    ).toBe("not-installed");
    expect(
      checkMcpPresetSupport(preset({ maxAppVersion: "1.0.0" }), {
        appVersion: "1.1.5",
      }).status,
    ).toBe("incompatible");
    expect(
      checkMcpPresetSupport(preset({ maxAppVersion: "2.0.0" }), {
        appVersion: "1.1.5",
      }).status,
    ).toBe("not-installed");
  });

  it("lists unconfigured dependencies", () => {
    expect(
      findMissingMcpDependencies(preset({ dependencies: ["b", "c"], id: "a" }), ["b"]),
    ).toEqual(["c"]);
    expect(
      findMissingMcpDependencies(preset({ dependencies: ["a"], id: "a" }), []),
    ).toEqual([]);
  });
});

describe("mcp preset statuses", () => {
  const installed = {
    authMode: "none" as const,
    enabled: true,
    oauthAuthorizationUrl: null,
    oauthTokenUrl: null,
    transport: "http" as const,
    url: "https://example.com/mcp",
  };

  it("hides non-channel and non-rolled-out presets from discovery", () => {
    expect(
      deriveMcpPresetStatus(preset({ channel: "beta" }), null, { channel: "stable" })
        .status,
    ).toBe("not-installed");
    expect(
      deriveMcpPresetStatus(preset({ channel: "beta" }), null, { channel: "beta" })
        .status,
    ).toBe("not-installed");
    expect(deriveMcpPresetStatus(preset({ rolloutPercent: 0 }), null).status).toBe(
      "not-installed",
    );
  });

  it("reports drift as update-available and calm as installed", () => {
    expect(deriveMcpPresetStatus(preset(), installed).status).toBe("installed");
    expect(
      deriveMcpPresetStatus(preset({ url: "https://example.com/v2" }), installed)
        .status,
    ).toBe("update-available");
    expect(
      deriveMcpPresetStatus(preset(), { ...installed, enabled: false }).status,
    ).toBe("disabled");
  });

  it("finds revoked installed servers and filters revoked presets", () => {
    const presets = [preset({ id: "a" }), preset({ id: "b", revoked: true })];
    expect(filterRevokedMcpPresets(presets).map((entry) => entry.id)).toEqual(["a"]);
    expect(
      findRevokedMcpServers(presets, [
        { id: "a", url: "https://a.example" },
        { id: "b", url: "https://b.example" },
      ]).map((server) => server.id),
    ).toEqual(["b"]);
  });
});
