/**
 * Persisted extension diagnostics (prompt §52/§57): plugin initialization
 * failures, plugin console output, and refused bridge operations are written
 * to their own store so they survive a restart and can be shown in the Store
 * without inflating the installed-extension records.
 *
 * The log is a bounded ring: an extension that logs in a loop can never grow
 * the file without limit.
 */
import { isRecord, type ExtensionDiagnostic } from "./models";
import type { ExtensionPathPlan } from "./storage";
import type { ExtensionPlatform } from "./installer";

export const MAX_DIAGNOSTIC_ENTRIES = 400;

export type DiagnosticRecorder = {
  /** Drop the whole log, or only one plugin's entries when given an id. */
  clear(pluginId?: string): Promise<void>;
  list(pluginId?: string): Promise<ExtensionDiagnostic[]>;
  record(
    pluginId: string,
    level: ExtensionDiagnostic["level"],
    message: string,
  ): Promise<void>;
};

export function parseDiagnostics(raw: string | null): ExtensionDiagnostic[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    const entries = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed) && Array.isArray(parsed.entries)
        ? (parsed.entries as unknown[])
        : [];
    return entries.filter(
      (entry): entry is ExtensionDiagnostic =>
        isRecord(entry) &&
        typeof entry.message === "string" &&
        typeof entry.pluginId === "string" &&
        (entry.level === "error" || entry.level === "info" || entry.level === "warning"),
    );
  } catch {
    return [];
  }
}

type RecorderDeps = {
  paths: ExtensionPathPlan;
  platform: ExtensionPlatform;
};

export function createDiagnosticRecorder({ paths, platform }: RecorderDeps): DiagnosticRecorder {
  let cache: ExtensionDiagnostic[] | null = null;
  let loading: Promise<ExtensionDiagnostic[]> | null = null;
  let writing: Promise<void> = Promise.resolve();

  /**
   * Load once per instance, and share that single array. Concurrent first
   * reads used to build separate arrays, so an entry recorded against one of
   * them could be silently dropped when the other won the cache race.
   */
  function load(): Promise<ExtensionDiagnostic[]> {
    if (cache) return Promise.resolve(cache);
    if (!loading) {
      loading = platform
        .readText(paths.diagnosticsFile)
        .then((raw) => parseDiagnostics(raw))
        .then((entries) => {
          cache = cache ?? entries;
          loading = null;
          return cache;
        });
    }
    return loading;
  }

  return {
    async clear(pluginId) {
      const entries = pluginId
        ? (await load()).filter((entry) => entry.pluginId !== pluginId)
        : [];
      cache = entries;
      await platform.writeText(paths.diagnosticsFile, JSON.stringify({ entries }));
    },

    async list(pluginId) {
      const entries = await load();
      return pluginId ? entries.filter((entry) => entry.pluginId === pluginId) : [...entries];
    },

    async record(pluginId, level, message) {
      const entries = await load();
      entries.push({ at: platform.nowIso(), level, message, pluginId });
      while (entries.length > MAX_DIAGNOSTIC_ENTRIES) entries.shift();
      // Serialize writes: plugin console output can be bursty.
      writing = writing
        .catch(() => {})
        .then(() =>
          platform.writeText(paths.diagnosticsFile, JSON.stringify({ entries })),
        );
      await writing;
    },
  };
}
