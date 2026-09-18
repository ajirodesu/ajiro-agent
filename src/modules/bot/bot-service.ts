/**
 * Bot console service — Ajiro Agent's equivalent of Persian-Bot's bot
 * command routes/controller (section 8). Local async functions over the
 * SQLite BotCommandRepository + SecureStore secrets + engine compiler.
 *
 * API key secrecy: values live only in SecureStore
 * (`bot_<botId>_cmd_<name>_apiKey`); the MD config, generated `.ts`, repo
 * imports, and download zip carry only `${API_KEY}` + Send As.
 */
import * as SecureStore from "@/core/services/secure-store";

import type { BotCommandRepository } from "@/core/db/repositories/bot-command-repository";
import { fetchWithTimeout } from "@/core/fetch-with-timeout";
import type {
  CodelessCommandConfig,
  NormalizedCodelessConfig,
} from "../../../packages/cat-bot/src/engine/modules/codeless/command-config.types";
import {
  normalizeCodelessConfig,
  assertValidCodelessConfig,
} from "../../../packages/cat-bot/src/engine/modules/codeless/command-config.types";
import { serializeCommandMarkdown, parseCommandMarkdown } from "../../../packages/cat-bot/src/engine/modules/codeless/command-markdown";
import { compileNormalizedCommandModule } from "../../../packages/cat-bot/src/engine/modules/codeless/command-compile";
import { detectEndpoint } from "../../../packages/cat-bot/src/engine/modules/codeless/fetch-detect";
import {
  addRepository as engineAddRepository,
  removeRepository as engineRemoveRepository,
  removeAllImported as engineRemoveAllImported,
  removeAllManual as engineRemoveAllManual,
  resetCommands as engineResetCommands,
  buildManualDownloadZip,
} from "../../../packages/cat-bot/src/engine/modules/codeless/command-service";
import { commandRegistry } from "../../../packages/cat-bot/src/engine/lib/command-registry";
import { fetchRepositoryMdFiles } from "@/modules/bot/repo-fetch";

import { DEFAULT_BOT_ID } from "@/modules/bot/bot-constants";

export { DEFAULT_BOT_ID };

export type BotCommandItem = {
  name: string;
  description: string;
  category: string;
  cooldown: number;
  enabled: boolean;
  source: "manual" | "imported";
  repositoryId: string | null;
  hasApiKey: boolean;
  requiresApiKey: boolean;
};

export function toItem(
  row: { name: string; source: { kind: string; repositoryId?: string }; mdText: string; enabled: boolean },
  hasApiKey: boolean,
): BotCommandItem {
  let description = "";
  let category = "Utility";
  let cooldown = 5;
  let requiresApiKey = false;
  try {
    const config = parseCommandMarkdown(row.mdText);
    description = config.description;
    category = config.category;
    cooldown = config.cooldown;
    requiresApiKey = config.api?.requiresApiKey === true;
  } catch {
    // Keep defaults for corrupt rows.
  }
  return {
    name: row.name,
    description,
    category,
    cooldown,
    enabled: row.enabled,
    source: row.source.kind === "imported" ? "imported" : "manual",
    repositoryId:
      row.source.kind === "imported"
        ? ((row.source as { repositoryId?: string }).repositoryId ?? null)
        : null,
    hasApiKey,
    requiresApiKey,
  };
}

function apiKeyStoreKey(botId: string, commandName: string): string {
  return `bot_${botId}_cmd_${String(commandName).toLowerCase()}_apiKey`;
}

export async function getCommandApiKey(botId: string, commandName: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(apiKeyStoreKey(botId, commandName));
  } catch {
    return null;
  }
}

export async function setCommandApiKey(
  repo: BotCommandRepository,
  botId: string,
  commandName: string,
  value: string | null,
): Promise<void> {
  const name = String(commandName).toLowerCase();
  if (value) {
    await SecureStore.setItemAsync(apiKeyStoreKey(botId, name), value);
    await repo.setHasApiKey(botId, name, true);
  } else {
    await SecureStore.deleteItemAsync(apiKeyStoreKey(botId, name));
    await repo.setHasApiKey(botId, name, false);
  }
}

export async function listBotCommands(
  repo: BotCommandRepository,
  botId: string = DEFAULT_BOT_ID,
): Promise<BotCommandItem[]> {
  const rows = await repo.listCommands(botId);
  // Keep the in-memory registry (same one hand-written commands use) in sync
  // with persisted configs so dispatch + cooldown work unmodified.
  await syncBotRegistry(rows);
  const items: BotCommandItem[] = [];
  for (const row of rows) {
    items.push(toItem(row, await repo.getHasApiKey(botId, row.name)));
  }
  return items.sort((a, b) => a.name.localeCompare(b.name));
}

async function syncBotRegistry(
  rows: { name: string; source: { kind: string; repositoryId?: string }; mdText: string; enabled: boolean }[],
): Promise<void> {
  const { normalizeCodelessConfig } = await import(
    "../../../packages/cat-bot/src/engine/modules/codeless/command-config.types"
  );
  const { parseCommandMarkdown } = await import(
    "../../../packages/cat-bot/src/engine/modules/codeless/command-markdown"
  );
  const { registerCompiledCommand } = await import(
    "../../../packages/cat-bot/src/engine/modules/codeless/command-service"
  );
  for (const row of rows) {
    try {
      const config = normalizeCodelessConfig(parseCommandMarkdown(row.mdText));
      registerCompiledCommand(
        DEFAULT_BOT_ID,
        config,
        row.source.kind === "imported"
          ? { kind: "imported", repositoryId: row.source.repositoryId ?? "unknown" }
          : { kind: "manual" },
        row.enabled,
      );
    } catch {
      // Skip corrupt rows without breaking the list.
    }
  }
}

/** POST /bots/:id/commands — create a manual command from the builder form. */
export async function createBotCommand(
  repo: BotCommandRepository,
  botId: string,
  raw: CodelessCommandConfig,
  apiKeyValue?: string | null,
): Promise<NormalizedCodelessConfig> {
  const config = normalizeCodelessConfig(raw);
  assertValidCodelessConfig(config);
  const mdText = serializeCommandMarkdown(config);
  await repo.upsertCommand({
    botId,
    name: config.name,
    source: { kind: "manual" },
    mdText,
    enabled: true,
    updatedAt: new Date().toISOString(),
  });
  await syncBotRegistry([
    { name: config.name, source: { kind: "manual" }, mdText, enabled: true },
  ]);
  if (config.api?.requiresApiKey && apiKeyValue) {
    await setCommandApiKey(repo, botId, config.name, apiKeyValue);
  }
  return config;
}

/** DELETE /bots/:id/commands/:name — delete one command (manual or imported). */
export async function deleteBotCommand(
  repo: BotCommandRepository,
  botId: string,
  name: string,
): Promise<void> {
  await repo.deleteCommand(botId, String(name).toLowerCase());
  commandRegistry.unregister(name);
  await setCommandApiKey(repo, botId, name, null).catch(() => {});
}

export async function toggleBotCommand(
  repo: BotCommandRepository,
  botId: string,
  name: string,
  enabled: boolean,
): Promise<void> {
  await repo.setCommandEnabled(botId, String(name).toLowerCase(), enabled);
  commandRegistry.setEnabled(name, enabled);
}

/** POST /bots/:id/commands/fetch-endpoint — Fetch auto-detection. */
export async function fetchEndpointDetection(
  input: { endpoint: string; body?: string },
): Promise<Awaited<ReturnType<typeof detectEndpoint>>> {
  return detectEndpoint(input, (url, init) => fetchWithTimeout(url, init ?? {}, 10000));
}

/** POST /bots/:id/command-repositories — add a repo URL, scan, import. */
export async function addCommandRepository(
  repo: BotCommandRepository,
  botId: string,
  url: string,
): Promise<{ repositoryId: string; importedCount: number; skipped: { filePath: string; reason: string }[] }> {
  const files = await fetchRepositoryMdFiles(url.trim());
  const adapter = {
    listCommands: (b: string) => repo.listCommands(b),
    upsertCommand: (row: Parameters<Parameters<typeof engineAddRepository>[0]["upsertCommand"]>[0]) =>
      repo.upsertCommand({
        botId: row.botId,
        name: row.name,
        source: row.source.kind === "manual" ? { kind: "manual" } : { kind: "imported", repositoryId: row.source.repositoryId },
        mdText: row.mdText,
        enabled: row.enabled,
        updatedAt: row.updatedAt,
      }),
    deleteCommand: (b: string, n: string) => repo.deleteCommand(b, n),
    deleteBySource: (b: string, s: "manual" | "imported") => repo.deleteBySource(b, s),
    deleteImportedFromRepo: (b: string, r: string) => repo.deleteImportedFromRepo(b, r),
    setCommandEnabled: (b: string, n: string, e: boolean) => repo.setCommandEnabled(b, n, e),
    listRepositories: (b: string) => repo.listRepositories(b),
    upsertRepository: (r: { id: string; botId: string; url: string; lastSyncedAt: string }) => repo.upsertRepository(r),
    deleteRepository: (b: string, r: string) => repo.deleteRepository(b, r),
    clearRepositories: (b: string) => repo.clearRepositories(b),
  };
  return engineAddRepository(adapter, botId, url, files);
}

export async function removeCommandRepository(
  repo: BotCommandRepository,
  botId: string,
  repositoryId: string,
): Promise<void> {
  const adapter = {
    listCommands: (b: string) => repo.listCommands(b),
    upsertCommand: (row: { botId: string; name: string; source: { kind: "manual" } | { kind: "imported"; repositoryId: string }; mdText: string; enabled: boolean; updatedAt: string }) =>
      repo.upsertCommand({ botId: row.botId, name: row.name, source: row.source, mdText: row.mdText, enabled: row.enabled, updatedAt: row.updatedAt }),
    deleteCommand: (b: string, n: string) => repo.deleteCommand(b, n),
    deleteBySource: (b: string, s: "manual" | "imported") => repo.deleteBySource(b, s),
    deleteImportedFromRepo: (b: string, r: string) => repo.deleteImportedFromRepo(b, r),
    setCommandEnabled: (b: string, n: string, e: boolean) => repo.setCommandEnabled(b, n, e),
    listRepositories: (b: string) => repo.listRepositories(b),
    upsertRepository: (r: { id: string; botId: string; url: string; lastSyncedAt: string }) => repo.upsertRepository(r),
    deleteRepository: (b: string, r: string) => repo.deleteRepository(b, r),
    clearRepositories: (b: string) => repo.clearRepositories(b),
  };
  await engineRemoveRepository(adapter, botId, repositoryId);
}

export async function removeAllImportedCommands(repo: BotCommandRepository, botId: string): Promise<void> {
  const rows = await repo.listCommands(botId);
  for (const row of rows) {
    if (row.source.kind === "imported") commandRegistry.unregister(row.name);
  }
  await engineRemoveAllImported(
    {
      listCommands: (b: string) => repo.listCommands(b),
      upsertCommand: (row: { botId: string; name: string; source: { kind: "manual" } | { kind: "imported"; repositoryId: string }; mdText: string; enabled: boolean; updatedAt: string }) => repo.upsertCommand(row),
      deleteCommand: (b: string, n: string) => repo.deleteCommand(b, n),
      deleteBySource: (b: string, s: "manual" | "imported") => repo.deleteBySource(b, s),
      deleteImportedFromRepo: (b: string, r: string) => repo.deleteImportedFromRepo(b, r),
      setCommandEnabled: (b: string, n: string, e: boolean) => repo.setCommandEnabled(b, n, e),
      listRepositories: (b: string) => repo.listRepositories(b),
      upsertRepository: (r: { id: string; botId: string; url: string; lastSyncedAt: string }) => repo.upsertRepository(r),
      deleteRepository: (b: string, r: string) => repo.deleteRepository(b, r),
      clearRepositories: (b: string) => repo.clearRepositories(b),
    },
    botId,
  );
}

export async function removeAllManualCommands(repo: BotCommandRepository, botId: string): Promise<void> {
  const rows = await repo.listCommands(botId);
  for (const row of rows) {
    if (row.source.kind === "manual") commandRegistry.unregister(row.name);
  }
  await engineRemoveAllManual(
    {
      listCommands: (b: string) => repo.listCommands(b),
      upsertCommand: (row: { botId: string; name: string; source: { kind: "manual" } | { kind: "imported"; repositoryId: string }; mdText: string; enabled: boolean; updatedAt: string }) => repo.upsertCommand(row),
      deleteCommand: (b: string, n: string) => repo.deleteCommand(b, n),
      deleteBySource: (b: string, s: "manual" | "imported") => repo.deleteBySource(b, s),
      deleteImportedFromRepo: (b: string, r: string) => repo.deleteImportedFromRepo(b, r),
      setCommandEnabled: (b: string, n: string, e: boolean) => repo.setCommandEnabled(b, n, e),
      listRepositories: (b: string) => repo.listRepositories(b),
      upsertRepository: (r: { id: string; botId: string; url: string; lastSyncedAt: string }) => repo.upsertRepository(r),
      deleteRepository: (b: string, r: string) => repo.deleteRepository(b, r),
      clearRepositories: (b: string) => repo.clearRepositories(b),
    },
    botId,
  );
}

export async function resetBotCommands(repo: BotCommandRepository, botId: string): Promise<void> {
  const rows = await repo.listCommands(botId);
  for (const row of rows) commandRegistry.unregister(row.name);
  await engineResetCommands(
    {
      listCommands: (b: string) => repo.listCommands(b),
      upsertCommand: (row: { botId: string; name: string; source: { kind: "manual" } | { kind: "imported"; repositoryId: string }; mdText: string; enabled: boolean; updatedAt: string }) => repo.upsertCommand(row),
      deleteCommand: (b: string, n: string) => repo.deleteCommand(b, n),
      deleteBySource: (b: string, s: "manual" | "imported") => repo.deleteBySource(b, s),
      deleteImportedFromRepo: (b: string, r: string) => repo.deleteImportedFromRepo(b, r),
      setCommandEnabled: (b: string, n: string, e: boolean) => repo.setCommandEnabled(b, n, e),
      listRepositories: (b: string) => repo.listRepositories(b),
      upsertRepository: (r: { id: string; botId: string; url: string; lastSyncedAt: string }) => repo.upsertRepository(r),
      deleteRepository: (b: string, r: string) => repo.deleteRepository(b, r),
      clearRepositories: (b: string) => repo.clearRepositories(b),
    },
    botId,
  );
}

/** GET /bots/:id/commands/manual/download — zip bytes (STORE method). */
export async function downloadManualZip(repo: BotCommandRepository, botId: string): Promise<Uint8Array> {
  const rows = (await repo.listCommands(botId)).filter((r) => r.source.kind === "manual");
  const pairs = rows.map((row) => {
    const config = parseCommandMarkdown(row.mdText);
    return { name: row.name, ts: compileNormalizedCommandModule(config), md: row.mdText };
  });
  return buildManualDownloadZip(pairs);
}

export async function getBotMode(repo: BotCommandRepository, botId: string): Promise<"bot" | "agent"> {
  return repo.getMode(botId);
}

export async function setBotMode(repo: BotCommandRepository, botId: string, mode: "bot" | "agent"): Promise<void> {
  await repo.setMode(botId, mode);
}
