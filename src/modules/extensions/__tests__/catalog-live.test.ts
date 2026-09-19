/**
 * Live per-plugin catalog verification (the "every plugin" checklist).
 *
 * Runs ONLY with `AJIRO_VERIFY_CATALOG=1` (opt-in: it downloads the real
 * registry builds). For every free catalog entry it runs the production
 * path end to end: download → ZIP/CRC/traversal validation → manifest
 * parse → install → enable/activate with the REAL plugin host document
 * (jsdom, same rig as dom-document.test.ts, so entry scripts genuinely
 * execute) → feature inventory (commands, formatters, custom pages,
 * snippets, scopes, compatibility verdict) → uninstall.
 * Paid entries are listed as excluded, never downloaded.
 *
 * Anything a node harness cannot prove (on-device rendering, PTY-backed
 * terminal execution) is reported per plugin as `requiresDevice: true`
 * instead of claimed. The machine-readable report lands at
 * `docs/catalog-verification.json`; the suite enforces a regression gate
 * against the previous report. `AJIRO_VERIFY_LIMIT` caps the plugin count
 * (default: all free).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

import { createPluginCommandRegistry } from "../command-registry";
import type { InstallDeps } from "../installer";
import { createExtensionManager } from "../manager";
import { packageText, readPluginPackage } from "../zip";
import { AcodeRegistryProvider } from "../registry";
import { ExtensionRuntime } from "../runtime";
import { planExtensionPaths } from "../storage";
import {
  clearPluginSnippets,
  listPluginSnippets,
} from "../plugin-snippets";
import { entryInStoreScope, isFreeEntry, pluginScopes } from "../scopes";
import { PLUGIN_RUNTIME_GLOBAL } from "../dom/dom-protocol";
import { buildPluginHostDocument } from "../dom/dom-runtime-script";
import { PluginDomHost } from "../dom/plugin-host";
import type { PluginBridgeInbound } from "../dom/bridge-protocol";
import type { ExtensionMetadata } from "../models";
import { createMemoryPlatform } from "./helpers";

const RUN = process.env.AJIRO_VERIFY_CATALOG === "1";
const LIMIT = Number(process.env.AJIRO_VERIFY_LIMIT ?? "1000000");

const THEME = {
  accent: "#4c8dff",
  background: "#101418",
  backgroundElement: "#182027",
  border: "#26303a",
  text: "#e6edf3",
  textSecondary: "#93a1b1",
};

type PluginVerdict = {
  id: string;
  version: string;
  scopes: string[];
  stores: string[];
  downloadOk: boolean;
  /** False when the server refuses the build (paid-gated 403 etc.). */
  downloadUnavailable: boolean;
  zipOk: boolean;
  manifestOk: boolean;
  installedOk: boolean;
  activatedOk: boolean;
  /** False for data-only packages (no entry script to execute). */
  hasEntry: boolean;
  compatibility: string;
  features: {
    commands: number;
    formatters: number;
    pages: number;
    snippets: number;
  };
  paidExcluded: boolean;
  requiresDevice: boolean;
  /** Persisted activation failure (e.g. missing `editorManager` global). */
  activationError: string | null;
  error: string | null;
};

const DOWNLOAD_TIMEOUT_MS = 90_000;

async function download(url: string): Promise<Uint8Array> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        redirect: "follow",
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Download failed (${response.status}).`);
      }
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** Real host document per plugin (fresh DOM = isolation between plugins). */
function mountDocument(host: PluginDomHost): { dom: JSDOM; close(): void } {
  const mounted: { current: JSDOM | null } = { current: null };
  host.attach({
    post(message: PluginBridgeInbound) {
      const deliver = (
        mounted.current?.window as unknown as Record<string, unknown>
      )[PLUGIN_RUNTIME_GLOBAL] as
        | ((payload: PluginBridgeInbound) => void)
        | undefined;
      if (typeof deliver !== "function") {
        throw new Error("The document did not install its runtime inbox.");
      }
      deliver(JSON.parse(JSON.stringify(message)) as PluginBridgeInbound);
    },
  });
  const dom = new JSDOM(buildPluginHostDocument({ theme: THEME }), {
    beforeParse(window) {
      Object.defineProperty(window, "ReactNativeWebView", {
        configurable: true,
        value: {
          postMessage(raw: string) {
            host.handleMessage(raw);
          },
        },
      });
    },
    pretendToBeVisual: true,
    runScripts: "dangerously",
    url: "https://plugin.ajiro.invalid/",
  });
  mounted.current = dom;
  return {
    dom,
    close() {
      host.detach();
      dom.window.close();
    },
  };
}

async function verifyEntry(entry: ExtensionMetadata): Promise<PluginVerdict> {
  const verdict: PluginVerdict = {
    id: entry.id,
    version: entry.version,
    scopes: pluginScopes(entry),
    stores: (["studio", "workshop", "all"] as const).filter((scope) =>
      entryInStoreScope(entry, scope),
    ),
    downloadOk: false,
    downloadUnavailable: false,
    zipOk: false,
    manifestOk: false,
    installedOk: false,
    activatedOk: false,
    hasEntry: false,
    compatibility: "unknown",
    features: { commands: 0, formatters: 0, pages: 0, snippets: 0 },
    paidExcluded: !isFreeEntry(entry),
    requiresDevice: true,
    activationError: null,
    error: null,
  };
  if (verdict.paidExcluded) {
    verdict.error = "paid plugin: excluded from both stores";
    return verdict;
  }
  let doc: { close(): void } | null = null;
  try {
    let bytes: Uint8Array;
    try {
      bytes = await download(
        `https://acode.app/api/plugin/download/${encodeURIComponent(entry.id)}`,
      );
    } catch (error) {
      // The server gates some builds (paid-only 403s, removed 404s):
      // unavailable is environmental, never an incompatibility.
      verdict.downloadUnavailable = true;
      verdict.error = `build unavailable: ${error instanceof Error ? error.message : String(error)}`;
      return verdict;
    }
    verdict.downloadOk = true;
    const pkg = readPluginPackage(bytes);
    verdict.zipOk = true;
    packageText(pkg.files, "plugin.json");
    verdict.manifestOk = true;

    const { platform } = createMemoryPlatform();
    const deps: InstallDeps = {
      paths: planExtensionPaths("file:///docs/"),
      platform,
    };
    const uri = `file:///docs/${entry.id}.zip`;
    await platform.writeBinary(uri, bytes);
    const runtime = new ExtensionRuntime(deps);
    const commands = createPluginCommandRegistry(() => {}, {
      platform: "android",
    });
    const host = new PluginDomHost({
      createLoader: async () => "loader-1",
      destroyLoader: () => {},
      execHostCommand: () => false,
      listPluginData: async () => [],
      log: () => {},
      notify: () => {},
      onCommandRegistered: (pluginId, command) =>
        commands.register(pluginId, command),
      onCommandRemoved: (pluginId, name) => commands.remove(pluginId, name),
      openNewFile: async (_pluginId, filename) => filename,
      operateLoader: () => {},
      pickFiles: async () => [],
      readActiveEditor: () => null,
      readPackageFile: async () => null,
      readPluginData: async () => ({}),
      requestPluginInstall: async () => {},
      setPluginSetting: async () => {},
      showDialog: async () => null,
      toast: () => {},
      writeActiveEditor: () => false,
      writePluginData: async () => {},
      writePluginFile: async () => {},
    });
    runtime.setExecutionHost(host);
    doc = mountDocument(host);
    await host.waitForReady(10_000);
    const manager = createExtensionManager({ deps, runtime });

    const refused = await manager.install({ kind: "file", uri });
    if (refused.status === "needs-permissions") {
      const outcome = await manager.install(
        { kind: "file", uri },
        { acceptedPermissions: refused.pending },
      );
      if (outcome.status !== "installed") {
        throw new Error(`install resolved to ${outcome.status}`);
      }
    } else if (refused.status !== "installed") {
      throw new Error(`install resolved to ${refused.status}`);
    }
    verdict.installedOk = true;

    const { loadInstalledRecords } = await import("../installer");
    const records = await loadInstalledRecords(deps);
    const record = records.find((item) => item.id === entry.id);
    if (record) {
      verdict.compatibility = record.compatibility.level;
    }
    await manager.enable(entry.id).catch(() => {});
    const live = await loadInstalledRecords(deps);
    const enabledRecord = live.find((item) => item.id === entry.id);
    verdict.activationError = enabledRecord?.runtimeError ?? null;
    verdict.hasEntry =
      typeof enabledRecord?.manifest.main === "string" &&
      enabledRecord.manifest.main !== "";
    verdict.activatedOk =
      enabledRecord?.enabled === true &&
      runtime.getState(entry.id) === "loaded";
    // Entry-less packages (pure themes/data) have nothing to execute:
    // installed + compatible is the complete verdict, not a failure.
    verdict.requiresDevice = verdict.hasEntry && !verdict.activatedOk;
    if (!verdict.hasEntry) {
      verdict.activatedOk = true;
    }
    verdict.features.commands = commands
      .list()
      .filter((command) => command.pluginId === entry.id).length;
    verdict.features.formatters = host
      .listFormatters()
      .filter((formatter) => formatter.pluginId === entry.id).length;
    verdict.features.pages = host
      .listPages()
      .filter((page) => page.pluginId === entry.id).length;
    verdict.features.snippets = listPluginSnippets().filter((item) =>
      item.id.startsWith(`${entry.id}:`),
    ).length;
    if (!verdict.activatedOk && !verdict.error) {
      verdict.error = "entry script did not reach loaded state in harness";
    }
    await manager.uninstall(entry.id).catch(() => {});
    clearPluginSnippets(entry.id);
  } catch (error) {
    verdict.error =
      verdict.error ?? (error instanceof Error ? error.message : String(error));
  } finally {
    doc?.close();
  }
  return verdict;
}

describe.runIf(RUN)("live catalog verification", () => {
  it(
    "verifies every free plugin end to end",
    async () => {
      const provider = new AcodeRegistryProvider(fetch);
      const { entries } = await provider.fetchCatalog({ limit: 100 });
      const paidCount = entries.filter((entry) => !isFreeEntry(entry)).length;
      const free = entries.filter(isFreeEntry).slice(0, LIMIT);
      console.log(
        `catalog: ${entries.length} entries (${free.length} free verifying, ${paidCount} paid/excluded)`,
      );

      const verdicts: PluginVerdict[] = [];
      let cursor = 0;
      // Bounded parallelism: each plugin gets an isolated platform,
      // document, and manager, so workers never share plugin state.
      const workers = Array.from({ length: 4 }, async () => {
        for (;;) {
          const index = cursor;
          cursor += 1;
          if (index >= free.length) return;
          const entry = free[index];
          console.log(`[${index + 1}/${free.length}] ${entry.id}`);
          verdicts.push(await verifyEntry(entry));
        }
      });
      await Promise.all(workers);
      verdicts.sort((left, right) => left.id.localeCompare(right.id));

      const root = join(
        dirname(fileURLToPath(import.meta.url)),
        "..",
        "..",
        "..",
        "..",
      );
      const reportPath = join(root, "docs", "catalog-verification.json");
      // Baseline is read BEFORE overwriting the report with this run.
      let baseline: {
        verdicts?: { id: string; installedOk: boolean; activatedOk: boolean }[];
      } | null = null;
      try {
        baseline = JSON.parse(readFileSync(reportPath, "utf8")) as {
          verdicts?: { id: string; installedOk: boolean; activatedOk: boolean }[];
        };
      } catch {
        baseline = null;
      }
      writeFileSync(
        reportPath,
        JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            paidExcluded: paidCount,
            total: entries.length,
            verdicts,
          },
          null,
          2,
        ),
      );

      // Regression gate (not an absolute bar): a plugin that verified
      // before must keep verifying. Absolute per-plugin status lives in
      // the report itself — including activation errors that name the
      // missing capability and size the next engine work.
      if (baseline?.verdicts) {
        const before = new Map(
          baseline.verdicts.map((entry) => [entry.id, entry]),
        );
        const regressions: string[] = [];
        for (const verdict of verdicts) {
          if (verdict.paidExcluded || !verdict.downloadOk) continue;
          const previous = before.get(verdict.id);
          if (!previous) continue;
          if (previous.installedOk && !verdict.installedOk) {
            regressions.push(`${verdict.id}: installed before, broken now`);
          }
          if (previous.activatedOk && !verdict.activatedOk) {
            regressions.push(`${verdict.id}: activated before, broken now`);
          }
        }
        expect(regressions).toEqual([]);
      }
    },
    30 * 60_000,
  );
});
