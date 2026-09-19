/**
 * Plugin snippet contributions: parsed `.snippets` data files keyed by
 * plugin id. The intel engine merges these into completions with
 * `origin: "plugin"` (see `useIntelBridge`); the extension runtime owns
 * the lifecycle — populated on activation, cleared on deactivation — so
 * uninstall/disable/update remove stale snippets with no extra step.
 *
 * The contribution shape intentionally mirrors `IntelSnippet` without
 * importing it (keeps extensions → intel dependency one-directional).
 */

export type PluginSnippetContribution = {
  id: string;
  prefix: string;
  body: string;
  description: string;
  languageIds: string[];
};

const contributions = new Map<string, PluginSnippetContribution[]>();

export function setPluginSnippets(
  pluginId: string,
  snippets: PluginSnippetContribution[],
): void {
  contributions.set(pluginId, snippets);
}

export function clearPluginSnippets(pluginId: string): void {
  contributions.delete(pluginId);
}

export function listPluginSnippets(): PluginSnippetContribution[] {
  return [...contributions.values()].flat();
}
