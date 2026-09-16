/**
 * Extension storage layout (prompt §47): installed packages, plugin data,
 * staging, and backups live in clearly separated trees under the app
 * documents directory. Uninstalling a plugin can never delete unrelated
 * Ajiro data because every path is derived from a validated plugin id.
 *
 *   <documents>/ajiro-agent/extensions/
 *     installed/<plugin-id>/          package files
 *     data/<plugin-id>/settings|cache|storage/
 *     staging/<attempt-id>/           extraction staging
 *     backups/<plugin-id>-<stamp>/    transient pre-update backup
 *     backups/<plugin-id>/            retained rollback point
 *     catalog-cache.json              registry catalog cache
 *     installed.json                  installed extension records
 *     preferences.json                extension platform preferences
 *     diagnostics.json                bounded plugin diagnostics log
 *
 * [AJIRO ORIGINAL] layout; ids validated like Acode plugin ids.
 */
import { validatePluginId } from "./manifest";

export const EXTENSIONS_ROOT_SEGMENTS = ["ajiro-agent", "extensions"] as const;

export type ExtensionPathPlan = {
  backupsRoot: string;
  catalogCacheFile: string;
  dataRoot: string;
  diagnosticsFile: string;
  installedFile: string;
  installedRoot: string;
  preferencesFile: string;
  root: string;
  stagingRoot: string;
};

/** Pure path planner: pass the documents-directory URI for the platform. */
export function planExtensionPaths(documentsUri: string): ExtensionPathPlan {
  const join = (...segments: string[]) =>
    `${documentsUri.replace(/\/+$/, "")}/${segments.filter(Boolean).join("/")}`;
  const root = join(...EXTENSIONS_ROOT_SEGMENTS);
  return {
    backupsRoot: join(root, "backups"),
    catalogCacheFile: join(root, "catalog-cache.json"),
    dataRoot: join(root, "data"),
    diagnosticsFile: join(root, "diagnostics.json"),
    installedFile: join(root, "installed.json"),
    installedRoot: join(root, "installed"),
    preferencesFile: join(root, "preferences.json"),
    root,
    stagingRoot: join(root, "staging"),
  };
}

export function pluginDir(paths: ExtensionPathPlan, pluginId: string): string {
  return `${paths.installedRoot}/${sanitizePluginId(pluginId)}`;
}

export function pluginDataDir(
  paths: ExtensionPathPlan,
  pluginId: string,
  kind: "cache" | "settings" | "storage",
): string {
  return `${paths.dataRoot}/${sanitizePluginId(pluginId)}/${kind}`;
}

export function backupDir(
  paths: ExtensionPathPlan,
  pluginId: string,
  stamp: string,
): string {
  return `${paths.backupsRoot}/${sanitizePluginId(pluginId)}-${stamp}`;
}

/**
 * One stable rollback point per plugin: the version that was replaced by
 * the most recent update, kept until the new version proves it activates
 * (§32/§33). A plugin can therefore hold at most one rollback point.
 */
export function rollbackPointDir(paths: ExtensionPathPlan, pluginId: string): string {
  return `${paths.backupsRoot}/${sanitizePluginId(pluginId)}`;
}

export function stagingDir(
  paths: ExtensionPathPlan,
  attemptId: string,
): string {
  return `${paths.stagingRoot}/${sanitizePluginId(attemptId)}`;
}

/** Ids become path segments; enforce the same rules as the manifest. */
export function sanitizePluginId(pluginId: string): string {
  return validatePluginId(pluginId);
}
