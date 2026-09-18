/**
 * Search Settings index: every settings destination flattened into one
 * searchable list (no categories, per spec). Page entries navigate to real
 * routes; drawer entries deep-link into /settings with a drawer param that
 * the Settings screen opens directly.
 *
 * Pure data + pure matching so the search behavior unit-tests on node; the
 * screen maps `icon` keys onto lucide components.
 */
export type SettingsSearchTarget =
  | { drawer: string; kind: "drawer" }
  | { kind: "route"; route: string };

export type SettingsSearchEntry = {
  description?: string;
  icon: string;
  id: string;
  keywords: string[];
  label: string;
  target: SettingsSearchTarget;
};

export const SETTINGS_SEARCH_ENTRIES: SettingsSearchEntry[] = [
  {
    description: "LLM provider keys, models, and connection testing",
    icon: "key",
    id: "providers",
    keywords: ["provider", "model", "api", "key", "openai", "anthropic", "llm"],
    label: "Providers",
    target: { kind: "route", route: "/settings/providers" },
  },
  {
    description: "Built-in file-tool toggles and step limits",
    icon: "briefcase",
    id: "tools",
    keywords: ["tools", "builtin", "file", "steps"],
    label: "Built-in tools",
    target: { kind: "route", route: "/settings/tools" },
  },
  {
    description: "Exec, git, verify loop, and sandbox harness",
    icon: "code",
    id: "coding",
    keywords: ["coding", "exec", "git", "sandbox", "terminal", "project"],
    label: "Coding",
    target: { kind: "route", route: "/settings/coding" },
  },
  {
    description: "Custom and native agents",
    icon: "bot",
    id: "agents",
    keywords: ["agents", "bot", "assistant", "custom"],
    label: "Agents",
    target: { kind: "route", route: "/settings/agents" },
  },
  {
    description: "Browse and install agent skills",
    icon: "sparkles",
    id: "skill-store",
    keywords: ["skills", "store", "install", "catalog"],
    label: "Skill Store",
    target: { kind: "route", route: "/settings/skill-store" },
  },
  {
    description: "Installed skills and per-skill settings",
    icon: "sparkles",
    id: "skills",
    keywords: ["skills", "installed", "manage"],
    label: "Skills",
    target: { kind: "route", route: "/settings/skills" },
  },
  {
    description: "Scheduled jobs and automation",
    icon: "clock",
    id: "jobs",
    keywords: ["jobs", "schedule", "cron", "automation"],
    label: "Jobs",
    target: { kind: "route", route: "/settings/jobs" },
  },
  {
    description: "Saved prompt templates",
    icon: "file",
    id: "prompts",
    keywords: ["prompts", "templates", "saved"],
    label: "Saved prompts",
    target: { kind: "route", route: "/settings/prompts" },
  },
  {
    description: "Memory hub and local memory file",
    icon: "brain",
    id: "memory",
    keywords: ["memory", "recall", "notes"],
    label: "Memory",
    target: { kind: "route", route: "/settings/memory" },
  },
  {
    description: "Edit the local MEMORY.md file",
    icon: "file",
    id: "memory-local",
    keywords: ["memory", "local", "edit", "markdown"],
    label: "Local memory",
    target: { kind: "route", route: "/settings/memory/local" },
  },
  {
    description: "Connect and manage MCP servers",
    icon: "server",
    id: "mcp",
    keywords: ["mcp", "servers", "tools", "connect", "model", "context", "protocol"],
    label: "MCP servers",
    target: { kind: "route", route: "/settings/mcp" },
  },
  {
    description: "Browse the MCP server catalog",
    icon: "server",
    id: "mcp-list",
    keywords: ["mcp", "catalog", "browse", "add"],
    label: "MCP catalog",
    target: { kind: "route", route: "/settings/mcp/list" },
  },
  {
    description: "Manually add an MCP server",
    icon: "plus",
    id: "mcp-add",
    keywords: ["mcp", "add", "custom", "manual", "url"],
    label: "Add MCP server",
    target: { kind: "route", route: "/settings/mcp/add" },
  },
  {
    description: "App version, device info, links, license",
    icon: "info",
    id: "about",
    keywords: ["about", "version", "device", "license", "github", "info"],
    label: "About",
    target: { kind: "route", route: "/settings/about" },
  },
  {
    description: "Check for app updates",
    icon: "upload",
    id: "app-update",
    keywords: ["update", "upgrade", "version", "apk", "ota"],
    label: "App update",
    target: { kind: "route", route: "/settings" },
  },
  {
    description: "Reload remote configuration",
    icon: "refresh",
    id: "refresh-config",
    keywords: ["refresh", "reload", "config", "sync"],
    label: "Refresh config",
    target: { kind: "route", route: "/settings" },
  },
  {
    description: "Share the latest release",
    icon: "share",
    id: "share",
    keywords: ["share", "send", "release", "invite"],
    label: "Share",
    target: { kind: "route", route: "/settings" },
  },
  {
    description: "Appearance and color theme",
    icon: "contrast",
    id: "theme",
    keywords: ["theme", "appearance", "dark", "light", "color", "mode"],
    label: "Theme",
    target: { drawer: "theme", kind: "drawer" },
  },
  {
    description: "Accent color",
    icon: "palette",
    id: "accent",
    keywords: ["accent", "color", "highlight"],
    label: "Accent color",
    target: { drawer: "accent", kind: "drawer" },
  },
  {
    description: "Push notification preferences",
    icon: "bell",
    id: "notifications",
    keywords: ["notifications", "push", "alerts", "notify"],
    label: "Notifications",
    target: { drawer: "notifications", kind: "drawer" },
  },
  {
    description: "Active chat model",
    icon: "cpu",
    id: "current-model",
    keywords: ["model", "current", "chat", "default"],
    label: "Current model",
    target: { drawer: "current-model", kind: "drawer" },
  },
  {
    description: "Local database and remote sync",
    icon: "database",
    id: "database",
    keywords: ["database", "storage", "sync", "remote", "backup"],
    label: "Database",
    target: { drawer: "db", kind: "drawer" },
  },
  {
    description: "Background agent and battery settings",
    icon: "play",
    id: "background-agent",
    keywords: ["background", "agent", "battery", "service"],
    label: "Background agent",
    target: { drawer: "background", kind: "drawer" },
  },
];

export function searchSettingsEntries(query: string): SettingsSearchEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...SETTINGS_SEARCH_ENTRIES];
  return SETTINGS_SEARCH_ENTRIES.filter((entry) => {
    const haystack = [
      entry.id,
      entry.label,
      entry.description ?? "",
      ...entry.keywords,
    ]
      .join(" ")
      .toLowerCase();
    return needle
      .split(/\s+/)
      .every((word) => word === "" || haystack.includes(word));
  });
}
