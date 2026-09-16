/**
 * React Native implementation of the plugin host services (prompt §45-§47,
 * §50). Everything a plugin can touch is mapped here onto Ajiro's existing
 * platform adapter:
 *
 * - package reads: `<installed>/<plugin-id>/<path>` (read-only)
 * - plugin writes: `<data>/<plugin-id>/files/<path>` (never the package)
 * - settings:      `<data>/<plugin-id>/settings/settings.json`
 * - storage:       `<data>/<plugin-id>/storage/storage.json`
 * - cache:         `<data>/<plugin-id>/cache/cache.json`
 *
 * Plugin settings are namespaced as `extensions.<pluginId>.<key>`, so they can
 * never collide with Ajiro's own settings, and uninstalling a plugin removes
 * exactly its own directories (§47).
 */
import { createDiagnosticRecorder, type DiagnosticRecorder } from "../diagnostics";
import type { ExtensionPlatform, InstallDeps } from "../installer";
import { pluginDataDir, pluginDir, sanitizePluginId } from "../storage";
import type { PluginCommandRegistration } from "./bridge-protocol";
import { getActiveEditorAccess } from "./editor-access";
import type { PluginHostServices } from "./plugin-host";

export type HostServiceCallbacks = {
  /** Called for every plugin log line and bridged console message. */
  log(pluginId: string, level: "error" | "info" | "warning", message: string): void;
  /** Plugin commands, mirrored from the document (§45). */
  onCommandRegistered(pluginId: string, command: PluginCommandRegistration): void;
  onCommandRemoved(pluginId: string, name: string): void;
  /** `acode.pushNotification` — only reached with the notifications grant. */
  notify(pluginId: string, level: string, text: string): void;
  /** Consent-gated `acode.installPlugin` request (§42). */
  requestPluginInstall(pluginId: string, targetId: string): Promise<void>;
};

const DATA_KIND_FILE: Record<"cache" | "settings" | "storage", string> = {
  cache: "cache/cache.json",
  settings: "settings/settings.json",
  storage: "storage/storage.json",
};

function dataFile(
  deps: InstallDeps,
  pluginId: string,
  kind: "cache" | "settings" | "storage",
): string {
  return `${pluginDataDir(deps.paths, pluginId, kind)}/${DATA_KIND_FILE[kind].split("/")[1]}`;
}

async function readJson(
  platform: ExtensionPlatform,
  file: string,
): Promise<Record<string, unknown>> {
  const raw = await platform.readText(file);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

export function createPluginHostServices(input: {
  callbacks: HostServiceCallbacks;
  deps: InstallDeps;
  diagnostics?: DiagnosticRecorder;
}): PluginHostServices & { diagnostics: DiagnosticRecorder } {
  const { callbacks, deps } = input;
  const platform = deps.platform;
  const diagnostics = input.diagnostics ?? createDiagnosticRecorder(deps);

  return {
    diagnostics,

    execHostCommand(name, _value) {
      // Built-in host commands; plugin-registered ones are executed inside
      // the document by the shim before this is ever reached.
      if (name === "console") {
        callbacks.log("runtime", "info", "acode.exec('console') is not mapped yet.");
        return false;
      }
      callbacks.log("runtime", "warning", `Unknown command "${name}".`);
      return false;
    },

    log(pluginId, level, message) {
      callbacks.log(pluginId, level, message);
      void diagnostics.record(pluginId, level, message).catch(() => {});
    },

    notify(pluginId, level, text) {
      callbacks.notify(pluginId, level, text);
      void diagnostics.record(pluginId, "info", `Notification: ${text}`).catch(() => {});
    },

    onCommandRegistered(pluginId, command) {
      callbacks.onCommandRegistered(pluginId, command);
    },

    onCommandRemoved(pluginId, name) {
      callbacks.onCommandRemoved(pluginId, name);
    },

    readActiveEditor() {
      // The registry holds whatever the editor screen has open right now; a
      // null registry means no document is open, never a stale snapshot.
      const access = getActiveEditorAccess();
      if (!access) return null;
      try {
        return access.read();
      } catch {
        return null;
      }
    },

    writeActiveEditor(text) {
      const access = getActiveEditorAccess();
      if (!access) return false;
      try {
        return access.replaceAll(text);
      } catch {
        return false;
      }
    },

    async readPackageFile(pluginId, path) {
      const base = pluginDir(deps.paths, sanitizePluginId(pluginId));
      return platform.readText(`${base}/${path}`);
    },

    async readPluginData(pluginId, kind) {
      return readJson(platform, dataFile(deps, pluginId, kind));
    },

    async requestPluginInstall(pluginId, targetId) {
      return callbacks.requestPluginInstall(pluginId, targetId);
    },

    async setPluginSetting(pluginId, key, value) {
      const current = await readJson(platform, dataFile(deps, pluginId, "settings"));
      current[key] = value;
      await platform.writeText(dataFile(deps, pluginId, "settings"), JSON.stringify(current));
      callbacks.log(pluginId, "info", `Setting extensions.${pluginId}.${key} updated.`);
    },

    async listPluginData(pluginId, path) {
      const base = pluginDataDir(deps.paths, sanitizePluginId(pluginId), "storage");
      const target = path ? `${base}/${path}` : base;
      const entries = await platform.listDirectory(target);
      return entries.map((entry) => (entry.isDirectory ? `${entry.name}/` : entry.name));
    },

    async writePluginData(pluginId, kind, value) {
      await platform.writeText(dataFile(deps, pluginId, kind), JSON.stringify(value));
    },

    async writePluginFile(pluginId, path, text) {
      // Writes land in the plugin's private data tree, never in its package:
      // a plugin cannot rewrite its own manifest or entry script.
      const base = pluginDataDir(deps.paths, sanitizePluginId(pluginId), "storage");
      const target = `${base}/files/${path}`;
      const lastSlash = target.lastIndexOf("/");
      if (lastSlash > 0) await platform.makeDirectory(target.slice(0, lastSlash));
      await platform.writeText(target, text);
    },
  };
}
