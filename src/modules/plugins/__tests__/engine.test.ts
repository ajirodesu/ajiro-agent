import { describe, expect, it } from "vitest";

import {
  compareVersions,
  installPlugin,
  parsePluginManifest,
  pluginCapabilities,
  reviewPlugin,
  setPluginEnabled,
} from "@/modules/plugins/engine";

describe("plugin engine", () => {
  it("validates manifests strictly", () => {
    const manifest = parsePluginManifest({
      name: "my-plugin",
      version: "1.2.3",
      commands: ["deploy"],
      skills: ["review"],
    });
    expect(manifest.name).toBe("my-plugin");
    expect(() => parsePluginManifest({ name: "x" })).toThrow();
    expect(() => parsePluginManifest({ name: "x", version: "nope" })).toThrow();
    expect(() =>
      parsePluginManifest({ name: "x", version: "1.0.0", commands: [1] }),
    ).toThrow();
  });

  it("quarantines third-party plugins by default", () => {
    const manifest = parsePluginManifest({ name: "p", version: "1.0.0" });
    const third = installPlugin(manifest, "third-party");
    expect(third.trust).toBe("quarantined");
    expect(third.enabled).toBe(false);
    expect(() => setPluginEnabled(third, true)).toThrow();
    const official = installPlugin(manifest, "official");
    expect(official.trust).toBe("trusted");
    expect(official.enabled).toBe(true);
  });

  it("reviews quarantine and gates capabilities", () => {
    const manifest = parsePluginManifest({
      name: "p",
      version: "1.0.0",
      commands: ["ship"],
      tools: ["deploy-tool"],
    });
    const installed = installPlugin(manifest, "community");
    expect(pluginCapabilities(installed).commands).toEqual([]);
    const trusted = reviewPlugin(installed, "trust");
    const enabled = setPluginEnabled({ ...trusted, enabled: true }, true);
    expect(pluginCapabilities(enabled).commands).toEqual(["ship"]);
    const blocked = reviewPlugin(installed, "block");
    expect(blocked.enabled).toBe(false);
    expect(pluginCapabilities(blocked).tools).toEqual([]);
  });

  it("compares versions numerically", () => {
    expect(compareVersions("1.2.3", "1.2.10")).toBe(-1);
    expect(compareVersions("2.0.0", "1.9.9")).toBe(1);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  });
});
