/**
 * Plugin engine (§20): manifests, trust, quarantine, lifecycle.
 *
 * Combines Anthropic plugin concepts (manifest, commands, skills, agents,
 * hooks, MCP) with OpenCode-style enable/disable, under Ajiro's permission
 * model. Third-party plugins are untrusted by default and install into
 * quarantine until reviewed.
 *
 * Source provenance: manifest shape follows publicly documented plugin
 * conventions ([ANTHROPIC OPEN SOURCE] official/community plugin repos as
 * observable structure); trust/quarantine/version rules are [AJIRO ORIGINAL].
 */
export type PluginSource = "official" | "community" | "third-party" | "local";

export type PluginManifest = {
  name: string;
  version: string;
  description?: string;
  commands?: string[];
  skills?: string[];
  agents?: string[];
  hooks?: string[];
  mcpServers?: string[];
  tools?: string[];
  permissions?: string[];
};

export type PluginTrust = "trusted" | "quarantined" | "blocked";

export type InstalledPlugin = {
  manifest: PluginManifest;
  source: PluginSource;
  trust: PluginTrust;
  enabled: boolean;
  installedAt: string;
  updatedAt: string;
};

export function trustForSource(source: PluginSource): PluginTrust {
  if (source === "official" || source === "local") return "trusted";
  if (source === "community") return "quarantined";
  return "quarantined";
}

export function parsePluginManifest(raw: unknown): PluginManifest {
  if (!raw || typeof raw !== "object") {
    throw new Error("Plugin manifest must be an object.");
  }
  const record = raw as Record<string, unknown>;
  const name = record.name;
  const version = record.version;
  if (typeof name !== "string" || !/^[a-z0-9][a-z0-9-_]*$/i.test(name.trim())) {
    throw new Error("Plugin manifest needs a valid name.");
  }
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+/.test(version.trim())) {
    throw new Error("Plugin manifest needs a semver version.");
  }
  const strings = (value: unknown): string[] | undefined => {
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
      throw new Error("Plugin manifest lists must be string arrays.");
    }
    return [...(value as string[])];
  };
  return {
    name: name.trim(),
    version: version.trim(),
    ...(typeof record.description === "string"
      ? { description: record.description }
      : {}),
    ...(strings(record.commands) ? { commands: strings(record.commands) } : {}),
    ...(strings(record.skills) ? { skills: strings(record.skills) } : {}),
    ...(strings(record.agents) ? { agents: strings(record.agents) } : {}),
    ...(strings(record.hooks) ? { hooks: strings(record.hooks) } : {}),
    ...(strings(record.mcpServers) ? { mcpServers: strings(record.mcpServers) } : {}),
    ...(strings(record.tools) ? { tools: strings(record.tools) } : {}),
    ...(strings(record.permissions) ? { permissions: strings(record.permissions) } : {}),
  };
}

/** -1 / 0 / 1 semver comparison (numeric prefix only). */
export function compareVersions(left: string, right: string): number {
  const parts = (value: string) =>
    value.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const l = parts(left);
  const r = parts(right);
  for (let i = 0; i < Math.max(l.length, r.length); i += 1) {
    const diff = (l[i] ?? 0) - (r[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

export function installPlugin(
  manifest: PluginManifest,
  source: PluginSource,
): InstalledPlugin {
  const now = new Date().toISOString();
  return {
    manifest,
    source,
    trust: trustForSource(source),
    // Quarantined plugins install disabled until reviewed.
    enabled: trustForSource(source) === "trusted",
    installedAt: now,
    updatedAt: now,
  };
}

export function reviewPlugin(
  plugin: InstalledPlugin,
  verdict: "trust" | "block",
): InstalledPlugin {
  return {
    ...plugin,
    trust: verdict === "trust" ? "trusted" : "blocked",
    enabled: verdict === "trust" ? plugin.enabled : false,
    updatedAt: new Date().toISOString(),
  };
}

export function setPluginEnabled(
  plugin: InstalledPlugin,
  enabled: boolean,
): InstalledPlugin {
  if (enabled && plugin.trust !== "trusted") {
    throw new Error(
      `Plugin "${plugin.manifest.name}" is ${plugin.trust}; review it before enabling.`,
    );
  }
  return { ...plugin, enabled, updatedAt: new Date().toISOString() };
}

/** Capabilities a plugin contributes once trusted AND enabled. */
export function pluginCapabilities(plugin: InstalledPlugin): {
  commands: string[];
  skills: string[];
  agents: string[];
  hooks: string[];
  mcpServers: string[];
  tools: string[];
} {
  if (!plugin.enabled || plugin.trust !== "trusted") {
    return { commands: [], skills: [], agents: [], hooks: [], mcpServers: [], tools: [] };
  }
  return {
    commands: plugin.manifest.commands ?? [],
    skills: plugin.manifest.skills ?? [],
    agents: plugin.manifest.agents ?? [],
    hooks: plugin.manifest.hooks ?? [],
    mcpServers: plugin.manifest.mcpServers ?? [],
    tools: plugin.manifest.tools ?? [],
  };
}
