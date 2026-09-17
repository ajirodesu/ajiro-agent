/**
 * Real-plugin fixtures (prompt §74).
 *
 * Provenance (fetched firsthand, September 2026):
 * - `acode.plugin.python.plugin.json`: verbatim copy of
 *   https://github.com/Acode-Foundation/acode-plugin-python/blob/main/plugin.json
 * - `acode.runner.plugin.plugin.json`: verbatim copy of
 *   https://github.com/Acode-Foundation/acode-runner-plugin/blob/main/plugin.json
 * - `acode.plugin.snippets.plugin.json`: verbatim copy of
 *   https://github.com/deadlyjack/acode-plugin-snippets/blob/main/plugin.json
 *   (55 `files` entries, verified by count)
 * - `registry-plugin-python.json`: verbatim body of
 *   `GET https://acode.app/api/plugin/acode.plugin.python` (snapshot; the
 *   live record keeps evolving, so this file pins what the tests assert)
 *
 * What these fixtures prove: the manifest parser accepts the exact
 * manifests real publishers ship (including absent optional fields), and
 * the registry normalizer handles the live API's real shapes
 * (JSON-encoded `keywords`, string `author` plus flat `author_*` fields,
 * inline `changelogs` markdown, `min_version_code: -1`).
 *
 * What they deliberately do NOT do: download or execute the real archives
 * (network + device runtime required; see the compatibility report §7).
 * Entry-script API usage below is asserted through minimal sources that
 * reproduce patterns observed firsthand in the real entry scripts — the
 * Python plugin's `editorManager.activeFile`, `new Worker(...)`, and
 * `$page.settitle(...)` calls (from
 * `acode-plugin-python/src/main.js`) — so the compatibility verdicts are
 * tested against reality, not invented shapes.
 */
import { describe, expect, it } from "vitest";

import {
  evaluateCompatibility,
  usesBareEditorManager,
} from "../compatibility";
import { normalizeRegistryEntry } from "../registry";
import { parsePluginManifest } from "../manifest";
import pythonManifestJson from "./fixtures/acode.plugin.python.plugin.json";
import runnerManifestJson from "./fixtures/acode.runner.plugin.plugin.json";
import snippetsManifestJson from "./fixtures/acode.plugin.snippets.plugin.json";
import registryPythonJson from "./fixtures/registry-plugin-python.json";

function manifestText(value: unknown): string {
  return JSON.stringify(value);
}

describe("real plugin manifests parse", () => {
  it("accepts the Python manifest (sparse optionals, no minVersionCode)", () => {
    const manifest = parsePluginManifest(manifestText(pythonManifestJson), [
      "dist/main.js",
      "icon.png",
    ]);
    expect(manifest.id).toBe("acode.plugin.python");
    expect(manifest.name).toBe("Python");
    expect(manifest.version).toBe("1.1.4");
    expect(manifest.main).toBe("dist/main.js");
    expect(manifest.minVersionCode).toBeNull();
    expect(manifest.author?.github).toBe("deadlyjack");
    expect(manifest.keywords).toEqual(["python"]);
  });

  it("accepts the Runner manifest (minVersionCode 963)", () => {
    const manifest = parsePluginManifest(manifestText(runnerManifestJson), [
      "main.js",
      "icon.png",
    ]);
    expect(manifest.id).toBe("acode.runner.plugin");
    expect(manifest.minVersionCode).toBe(963);
    expect(manifest.price).toBe(0);
  });

  it("accepts the Snippets manifest (55 packaged files, no readme/license)", () => {
    const manifest = parsePluginManifest(
      manifestText(snippetsManifestJson),
      ["dist/main.js", "icon.png", "readme.md"],
    );
    expect(manifest.id).toBe("acode.plugin.snippets");
    expect(manifest.files).toHaveLength(55);
    expect(manifest.readme).toBe("readme.md");
    expect(manifest.license).toBeNull();
  });
});

describe("live registry entry shape", () => {
  it("normalizes the real Python registry record", () => {
    const entry = normalizeRegistryEntry(registryPythonJson);
    expect(entry).not.toBeNull();
    expect(entry?.id).toBe("acode.plugin.python");
    expect(entry?.version).toBe("1.1.4");
    // JSON-encoded keywords string decodes to a real list.
    expect(entry?.keywords).toEqual(["python"]);
    // String author merged with the flat author_* fields.
    expect(entry?.author?.name).toBe("Ajit Kumar");
    expect(entry?.author?.email).toBe("me@ajitkumar.dev");
    expect(entry?.author?.github).toBe("deadlyjack");
    expect(entry?.description).toContain("Pyodide");
    // Inline changelog markdown survives as text.
    expect(entry?.changelog).toContain("Acode Python Plugin Changelog");
    // -1 means "no floor", not "version negative one".
    expect(entry?.minVersionCode).toBe(-1);
    expect(entry?.repository).toContain("acode-plugin-python");
  });
});

describe("real-world entry-script patterns", () => {
  // Reproduces the API surface of acode-plugin-python/src/main.js:
  // bare editorManager access, a Web Worker, and $page.settitle.
  const PYTHON_LIKE_SOURCE = [
    "editorManager.on('switch-file', check);",
    "const file = editorManager.activeFile;",
    "this.#worker = new Worker(this.baseUrl + 'worker.js');",
    "$page.settitle('Python');",
    "acode.setPluginInit(plugin.id, () => {});",
  ].join("\n");

  it("detects bare editorManager access outside require() calls", () => {
    expect(usesBareEditorManager(PYTHON_LIKE_SOURCE)).toBe(true);
    expect(
      usesBareEditorManager('const editor = acode.require("editor");\neditor.getText();'),
    ).toBe(false);
    expect(usesBareEditorManager("const x = 1;")).toBe(false);
  });

  it("rates the Python-shaped entry partial with concrete reasons", () => {
    const manifest = parsePluginManifest(manifestText(pythonManifestJson), [
      "dist/main.js",
    ]);
    const report = evaluateCompatibility(manifest, PYTHON_LIKE_SOURCE);
    expect(report.level).toBe("partial");
    expect(report.reasons.join("\n")).toContain("editorManager");
    expect(report.reasons.join("\n")).toContain("Worker");
  });

  it("rates a clean entry compatible", () => {
    const manifest = parsePluginManifest(manifestText(runnerManifestJson), ["main.js"]);
    const report = evaluateCompatibility(
      manifest,
      "acode.setPluginInit('acode.runner.plugin', () => {});",
    );
    expect(report.level).toBe("compatible");
  });
});
