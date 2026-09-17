/**
 * Compatibility evaluation (prompt §54-§56, §82): every extension gets an
 * honest compatibility report with concrete reasons — never an invented
 * score.
 *
 * What changed with the DOM runtime: Acode loads plugin entry scripts into a
 * browser/webview document, and Ajiro now does the same through the plugin
 * host document (`dom/`), so an entry script that uses `window`, `document`,
 * `HTMLElement`, `CustomEvent`, `fetch`, or `URL` is *supported* rather than
 * merely tolerated. What remains out of reach is Ajiro's missing native
 * surface: Acode core modules the host document does not implement
 * (`editorManager`, `app`, `project`, …) and direct editor DOM access.
 * `editor` itself is provided in a scoped form — read and replace the active
 * document — `newEditorFile` creates through the app's file service, and the
 * native dialogs render through the app surface, so all three are supported
 * rather than flagged.
 *
 * Levels:
 * - `compatible`  — the manifest, package, and entry script run as written.
 * - `partial`     — installs and runs, but touches APIs Ajiro does not provide.
 * - `unsupported` — declares a minimum Acode version above the emulated API.
 * - `unknown`     — the manifest was too malformed to judge (installer path).
 */
import type { AcodePluginManifest } from "./manifest";
import { checkNativeRequirements } from "@/modules/updates/extension-framework";
import {
  ACODE_COMPATIBILITY_MATRIX,
  type AcodeCompatibilityVersion,
} from "./acode-matrix";
import type { CompatibilityLevel, ExtensionCompatibilityReport } from "./models";

/** The Ajiro Acode-API version code we emulate. */
export const AJIRO_ACODE_VERSION_CODE = 963;

/** APIs Ajiro deliberately supports through the compatibility runtime. */
export const SUPPORTED_ACODE_APIS = [
  "acode.setPluginInit",
  "acode.setPluginUnmount",
  "acode.define",
  "acode.require",
  "acode.waitForPlugin",
  "acode.installPlugin",
  "acode.clearBrokenPluginMark",
  "acode.unmountPlugin",
  "acode.exec",
  "acode.pushNotification",
  "acode.addIcon",
  "acode.toInternalUrl",
  "acode.registerFormatter",
  "acode.unregisterFormatter",
  "acode.format",
  "acode.formatters",
  "acode.getFormatterFor",
] as const;

/**
 * Modules the plugin host document exposes through `acode.require`, each
 * behind its permission grant: `commands`, `editor`, `filesystem`,
 * `settings`, `storage`. Verified against `dom/dom-runtime-script.ts`.
 */
export const SUPPORTED_PLUGIN_MODULES = [
  "commands",
  "editor",
  "filesystem",
  "settings",
  "storage",
] as const;

/**
 * Acode core modules Ajiro does not ship. Requiring one throws inside the
 * document, which marks the plugin broken — so the evaluator names them up
 * front instead of letting the user discover it at activation time.
 *
 * `editor` is deliberately *not* on this list: Ajiro provides a scoped
 * replacement (read and replace the active document). `editorManager` still
 * is, because it is the editor *instance*, which the scoped module does not
 * hand out.
 */
export const UNSUPPORTED_PLUGIN_MODULES = [
  "app",
  "editorManager",
  "filelist",
  "keyboard",
  "palette",
  "project",
  "sidebarapp",
  "theme",
] as const;

/**
 * `acode.require("x")` / `acode.require('x')` occurrences in an entry script.
 *
 * Names are collected as written (so diagnostics can echo the plugin's own
 * spelling) but deduplicated case-insensitively, because matching against the
 * module lists must not depend on how a plugin capitalized `editorManager`.
 */
function requiredModules(source: string): string[] {
  const found = new Map<string, string>();
  const pattern = /acode\s*\.\s*require\s*\(\s*["'`]([\w.@/-]+)["'`]/g;
  let match = pattern.exec(source);
  while (match) {
    const asWritten = match[1];
    const key = asWritten.toLowerCase();
    if (!found.has(key)) found.set(key, asWritten);
    match = pattern.exec(source);
  }
  return [...found.values()];
}

/**
 * Entry-script APIs with no Ajiro equivalent. The DOM itself is *not* on
 * this list any more: it is provided by the plugin host document.
 */
const UNSUPPORTED_API_PATTERNS: { label: string; pattern: RegExp }[] = [
  {
    label: "direct editor DOM access (editorManager/ace/CodeMirror)",
    pattern: /\b(editorManager|ace\s*\.\s*edit|CodeMirror)\b/,
  },
  {
    label: "Web Workers (the plugin host document provides no Worker constructor)",
    pattern: /\bnew\s+Worker\s*\(/,
  },
];

/**
 * Bare `editorManager` references *outside* `acode.require("...")` strings:
 * the real Python plugin reaches the editor this way
 * (`editorManager.activeFile`, `editorManager.on(...)`), never through the
 * module registry, so the `acode.require` scan alone would miss it. Matches
 * inside require() calls are stripped first to avoid double-reporting.
 */
export function usesBareEditorManager(source: string): boolean {
  const withoutRequires = source.replace(
    /acode\s*\.\s*require\s*\(\s*["'`][\w.@/-]+["'`]\s*\)/g,
    "",
  );
  return /\beditorManager\b/.test(withoutRequires);
}

export function compareExtensionVersions(left: string, right: string): number {
  const numeric = (value: string) =>
    value
      .split(/[-+]/)[0]
      .split(".")
      .map((part) => Number.parseInt(part, 10) || 0);
  const l = numeric(left);
  const r = numeric(right);
  for (let i = 0; i < Math.max(l.length, r.length); i += 1) {
    const diff = (l[i] ?? 0) - (r[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

/** True when the plugin declares a floor above what we emulate. */
function versionFloorFailure(manifest: AcodePluginManifest): string | null {
  const min = manifest.minVersionCode;
  if (min === null || min <= AJIRO_ACODE_VERSION_CODE) return null;
  return `Requires Acode version code ${min}, newer than the ${AJIRO_ACODE_VERSION_CODE} API surface Ajiro emulates.`;
}

/**
 * Evaluate a parsed manifest. `entrySource` (optional) enables static
 * analysis of the entry script for concrete reasons.
 */
export function evaluateCompatibility(
  manifest: AcodePluginManifest,
  entrySource: string | null = null,
): ExtensionCompatibilityReport {
  const reasons: string[] = [];
  let level: CompatibilityLevel = "compatible";
  const weaken = (to: CompatibilityLevel) => {
    if (level === "compatible") level = to;
  };

  const floor = versionFloorFailure(manifest);
  if (floor) {
    reasons.push(floor);
    level = "unsupported";
  }

  // Native capability floor (Dynamic Updates prompt §36/§42): a declared
  // requirement this install lacks is `unsupported` with an app-update
  // reason, never a silent partial.
  const native = checkNativeRequirements(manifest.nativeCapabilities);
  if (!native.satisfied) {
    reasons.push(
      `Requires an Ajiro Agent update (missing native capabilities: ${native.missing.join(", ")}).`,
    );
    level = "unsupported";
  }

  const matrixRow = pickMatrixRow(manifest.minVersionCode);
  if (matrixRow && matrixRow.unsupportedApis.length > 0) {
    reasons.push(
      `Acode ${matrixRow.notes ?? "range"}: unsupported APIs — ${matrixRow.unsupportedApis.join(", ")}.`,
    );
    weaken("partial");
  }

  if (entrySource === null) {
    reasons.push(
      "Data-only extension: no entry script, so no plugin code executes. Its files, README, and settings are fully supported.",
    );
  } else {
    reasons.push(
      "Entry script runs in the plugin host document, where window, document, HTMLElement, CustomEvent, fetch, and URL are available.",
    );
    const required = requiredModules(entrySource);
    const unsupported = required.filter((name) =>
      (UNSUPPORTED_PLUGIN_MODULES as readonly string[]).some(
        (moduleName) => moduleName.toLowerCase() === name.toLowerCase(),
      ),
    );
    if (unsupported.length > 0) {
      reasons.push(
        `Requires Acode core modules this runtime does not provide: ${unsupported.join(", ")}. Requiring one fails inside the document.`,
      );
      weaken("partial");
    }
    const gaps = UNSUPPORTED_API_PATTERNS.filter(({ pattern }) =>
      pattern.test(entrySource),
    ).map(({ label }) => label);
    if (usesBareEditorManager(entrySource) && !required.some((name) => name.toLowerCase() === "editormanager")) {
      gaps.push("bare editorManager access (the scoped `editor` module only covers the active document)");
    }
    if (gaps.length > 0) {
      reasons.push(`Uses APIs without an Ajiro equivalent: ${gaps.join(", ")}.`);
      weaken("partial");
    }
  }

  if (manifest.dependencies.length > 0) {
    reasons.push(
      `Declares ${manifest.dependencies.length} plugin dependency(ies); they must be installed and approved first.`,
    );
  }

  if (level === "compatible" && reasons.length === 0) {
    reasons.push("Manifest, package layout, and declared assets are fully supported.");
  }

  return { level, reasons };
}

function pickMatrixRow(
  minVersionCode: number | null,
): AcodeCompatibilityVersion | null {
  if (minVersionCode === null) return null;
  return (
    ACODE_COMPATIBILITY_MATRIX.find(
      (row) =>
        minVersionCode >= row.acodeVersionCodeRange.min &&
        minVersionCode <= row.acodeVersionCodeRange.max,
    ) ?? null
  );
}

/** Human label for badges. */
export function compatibilityLabel(level: CompatibilityLevel): string {
  switch (level) {
    case "compatible":
      return "Compatible";
    case "partial":
      return "Partial";
    case "unsupported":
      return "Unsupported";
    default:
      return "Unknown";
  }
}
