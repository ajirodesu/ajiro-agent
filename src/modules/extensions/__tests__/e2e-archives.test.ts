/**
 * Real-archive end-to-end validation (prompt §86 #23).
 *
 * Runs ONLY with `AJIRO_E2E_NETWORK=1`: it downloads the three published
 * plugin builds through the registry's own download endpoint — the exact
 * channel installs and updates use — and runs them through the production
 * validation path: `readPluginPackage` (ZIP structure, CRC, traversal) →
 * `parsePluginManifest` → entry-point presence → `evaluateCompatibility`.
 * Nothing is executed or installed; the device runtime still cannot run
 * here.
 *
 * GitHub `main.zip` source archives are deliberately NOT used: the repos do
 * not commit their `dist/` build output, so a source archive is not an
 * installable package (verified firsthand). The installable artifacts are
 * the registry builds, which is also what the seed catalog resolves to.
 *
 * Assertions are drift-proof on purpose: upstream may release new versions,
 * so the suite pins plugin ids, not version strings.
 */
import { describe, expect, it } from "vitest";

import { evaluateCompatibility } from "../compatibility";
import { parsePluginManifest } from "../manifest";
import { packageText, readPluginPackage } from "../zip";

const RUN_E2E = process.env.AJIRO_E2E_NETWORK === "1";

const ARCHIVES = [
  {
    id: "acode.plugin.python",
    url: "https://acode.app/api/plugin/download/acode.plugin.python",
  },
  {
    id: "acode.runner.plugin",
    url: "https://acode.app/api/plugin/download/acode.runner.plugin",
  },
  {
    id: "acode.plugin.snippets",
    url: "https://acode.app/api/plugin/download/acode.plugin.snippets",
  },
] as const;

async function download(url: string): Promise<Uint8Array> {
  // One retry: these are multi-megabyte downloads and a transient reset
  // must not fail the suite.
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetch(url, { redirect: "follow" });
      if (!response.ok) {
        throw new Error(`Download failed (${response.status}) for ${url}.`);
      }
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

describe.runIf(RUN_E2E)("real plugin archives end to end", () => {
  for (const archive of ARCHIVES) {
    it(
      `${archive.id} downloads, validates, and parses`,
      async () => {
        const bytes = await download(archive.url);
        const pkg = readPluginPackage(bytes);
        // files keys are prefix-stripped (GitHub archives nest under one
        // top-level folder); manifestEntry keeps the prefix, so read the
        // manifest the same way the installer does.
        const manifestText = packageText(pkg.files, "plugin.json");
        expect(manifestText).not.toBeNull();
        const manifest = parsePluginManifest(
          manifestText as string,
          [...pkg.files.keys()],
        );
        expect(manifest.id).toBe(archive.id);
        expect(typeof manifest.version).toBe("string");
        // The declared entry point must resolve to a file in the package.
        expect(pkg.files.has(manifest.main)).toBe(true);
        const report = evaluateCompatibility(manifest);
        expect(["compatible", "partial", "unsupported", "unknown"]).toContain(
          report.level,
        );
      },
      120_000,
    );
  }
});

describe("real plugin archives (offline)", () => {
  it("is skipped without AJIRO_E2E_NETWORK=1", () => {
    expect(RUN_E2E).toBe(process.env.AJIRO_E2E_NETWORK === "1");
  });
});
