/**
 * Extension preferences (§51/§63/§64): the durable, user-owned choices that
 * govern discovery and publisher trust. Parsing must be tolerant of older and
 * corrupt files without ever inventing trust the user did not grant.
 */
import { describe, expect, it } from "vitest";

import type { InstallDeps } from "../installer";
import {
  createExtensionPreferencesReader,
  DEFAULT_EXTENSION_PREFERENCES,
  parseExtensionPreferences,
} from "../preferences";
import { planExtensionPaths } from "../storage";
import { createMemoryPlatform } from "./helpers";

describe("parsing preference files", () => {
  it("falls back to defaults for a missing or unusable file", () => {
    for (const raw of [null, "", "not json", "[]", '"string"', "42"]) {
      expect(parseExtensionPreferences(raw)).toEqual(DEFAULT_EXTENSION_PREFERENCES);
    }
  });

  it("keeps known booleans and ignores wrong types", () => {
    expect(
      parseExtensionPreferences(
        JSON.stringify({
          allowPluginInstallRequests: false,
          notifyOnDiscovery: "yes",
          requireSignedPackages: true,
        }),
      ),
    ).toMatchObject({
      allowPluginInstallRequests: false,
      notifyOnDiscovery: true,
      requireSignedPackages: true,
    });
  });

  it("does not require signatures unless the user asked for it", () => {
    const parsed = parseExtensionPreferences(JSON.stringify({}));
    expect(parsed.requireSignedPackages).toBe(false);
    expect(parsed.trustedSigningKeys).toEqual({});
  });

  it("defaults the update channel to stable and rejects unknown channels", () => {
    expect(parseExtensionPreferences(JSON.stringify({})).updateChannel).toBe(
      "stable",
    );
    expect(
      parseExtensionPreferences(JSON.stringify({ updateChannel: "beta" }))
        .updateChannel,
    ).toBe("beta");
    expect(
      parseExtensionPreferences(JSON.stringify({ updateChannel: "nightly" }))
        .updateChannel,
    ).toBe("stable");
  });

  it("keeps only usable trusted keys", () => {
    const parsed = parseExtensionPreferences(
      JSON.stringify({
        trustedSigningKeys: {
          "  ": "AAAA",
          "ajiros.publisher": "  BBBB  ",
          blank: "   ",
          notAString: 5,
        },
      }),
    );
    expect(parsed.trustedSigningKeys).toEqual({ "ajiros.publisher": "BBBB" });
  });

  it("cannot be tricked into trusting an inherited key", () => {
    const parsed = parseExtensionPreferences(
      JSON.stringify({ trustedSigningKeys: { __proto__: { evil: "AAAA" } } }),
    );
    expect(Object.keys(parsed.trustedSigningKeys)).not.toContain("evil");
    expect(Object.getPrototypeOf(parsed.trustedSigningKeys)).toBe(Object.prototype);
    expect(parsed.trustedSigningKeys.evil).toBeUndefined();
  });
});

describe("reading and writing preferences", () => {
  function reader() {
    const { files, platform } = createMemoryPlatform();
    const deps: InstallDeps = { paths: planExtensionPaths("file:///docs/"), platform };
    return { deps, files, ...createExtensionPreferencesReader(deps) };
  }

  it("returns defaults before anything has been saved", async () => {
    const prefs = reader();
    expect(await prefs.load()).toEqual(DEFAULT_EXTENSION_PREFERENCES);
  });

  it("round-trips a trust decision and patches one field at a time", async () => {
    const prefs = reader();
    await prefs.save({
      requireSignedPackages: true,
      trustedSigningKeys: { "ajiros.publisher": "AAAA" },
    });
    await prefs.save({ notifyOnDiscovery: false });

    const loaded = await prefs.load();
    expect(loaded).toEqual({
      allowPluginInstallRequests: true,
      formatters: {},
      notifyOnDiscovery: false,
      requireSignedPackages: true,
      trustedSigningKeys: { "ajiros.publisher": "AAAA" },
      updateChannel: "stable",
    });
    // The patch really was merged, not written as a partial document.
    const reread = parseExtensionPreferences(await prefs.deps.platform.readText(
      prefs.deps.paths.preferencesFile,
    ));
    expect(reread).toEqual(loaded);
  });

  it("shares one read between concurrent callers", async () => {
    const prefs = reader();
    await prefs.save({ requireSignedPackages: true });
    const [first, second] = await Promise.all([prefs.load(), prefs.load()]);
    expect(first).toEqual(second);
    expect(first.requireSignedPackages).toBe(true);
  });

  it("keeps formatter selections and drops garbage on file read", async () => {
    const prefs = reader();
    await prefs.save({ formatters: { typescript: "pretty" } });
    expect((await prefs.load()).formatters).toEqual({ typescript: "pretty" });

    // A hand-edited file with garbage entries parses down to usable ones.
    await prefs.deps.platform.writeText(
      prefs.deps.paths.preferencesFile,
      JSON.stringify({ formatters: { typescript: "pretty", "": "x", python: "", nested: { a: 1 } } }),
    );
    const parsed = parseExtensionPreferences(
      await prefs.deps.platform.readText(prefs.deps.paths.preferencesFile),
    );
    expect(parsed.formatters).toEqual({ typescript: "pretty" });
  });
});
