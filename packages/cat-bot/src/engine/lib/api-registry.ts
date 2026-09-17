/**
 * API registry — Ajiro Agent's port of Persian-Bot's `apilist.ts` pattern
 * (src/app/commands/apilist.ts, reference only).
 *
 * Catalogs external API usage so the bot can list which third-party APIs
 * its codeless commands depend on. Updated whenever a command with an API
 * Configuration is created or imported.
 */
export type ApiRegistryEntry = {
  commandName: string;
  endpoint: string;
  method: "GET" | "POST";
  requiresKey: boolean;
  updatedAt: string;
};

const entries = new Map<string, ApiRegistryEntry>();

export function registerCommandApi(entry: ApiRegistryEntry): void {
  entries.set(entry.commandName.toLowerCase(), entry);
}

export function unregisterCommandApi(commandName: string): void {
  entries.delete(String(commandName).toLowerCase());
}

export function listApis(): ApiRegistryEntry[] {
  return [...entries.values()].sort((a, b) => a.commandName.localeCompare(b.commandName));
}

export function clearApis(): void {
  entries.clear();
}

export function formatApiList(): string {
  const all = listApis();
  if (all.length === 0) return "🌐 **Registered Free API Providers** (0)\n\n_No external APIs registered._";
  const list = all
    .map((e, i) => ` • ${i + 1}. **${e.commandName}** — \`${e.endpoint}\` (${e.requiresKey ? "🔑 requires key" : "🔓 no key needed"})`)
    .join("\n");
  return `🌐 **Registered Free API Providers** (${all.length})\n\n${list}`;
}
