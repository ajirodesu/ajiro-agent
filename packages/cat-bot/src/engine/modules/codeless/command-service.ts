/**
 * Command service — Ajiro Agent's port of Persian-Bot's bot command
 * routes/controller (server/routes/v1/bot.routes.ts +
 * server/controllers/v1/bot.controller.ts, reference only).
 *
 * Ajiro Agent has no Express backend, so each endpoint from section 8 is a
 * local async function here over an injected store (SQLite in the app,
 * in-memory in tests):
 *
 * - POST   /bots/:id/commands                    → createCommand
 * - DELETE /bots/:id/commands/:name              → deleteCommand
 * - POST   /bots/:id/commands/fetch-endpoint     → fetchEndpointDetection
 * - POST   /bots/:id/command-repositories        → addRepository
 * - DELETE /bots/:id/command-repositories/:repo  → removeRepository
 * - DELETE /bots/:id/commands/imported           → removeAllImported
 * - DELETE /bots/:id/commands/manual             → removeAllManual
 * - DELETE /bots/:id/commands/reset              → resetCommands
 * - GET    /bots/:id/commands/manual/download    → downloadManualPairs
 */
import type { CodelessCommandConfig, NormalizedCodelessConfig } from "./command-config.types";
import { normalizeCodelessConfig, assertValidCodelessConfig } from "./command-config.types";
import { serializeCommandMarkdown } from "./command-markdown";
import { compileNormalizedCommandModule } from "./command-compile";
import { scanRepositoryFiles, type RepoFile } from "./repo-import";
import { detectEndpoint, type FetchDetectInput } from "./fetch-detect";
import { registerCommandApi, unregisterCommandApi } from "../../lib/api-registry";
import { commandRegistry } from "../../lib/command-registry";
import { matchesOnChatMessage } from "./onchat-match";

export type CommandSource =
  | { kind: "manual" }
  | { kind: "imported"; repositoryId: string };

export type StoredCommandConfig = {
  botId: string;
  name: string;
  source: CommandSource;
  mdText: string;
  enabled: boolean;
  updatedAt: string;
};

export type StoredRepository = {
  id: string;
  botId: string;
  url: string;
  lastSyncedAt: string;
};

export interface CommandStore {
  listCommands(botId: string): Promise<StoredCommandConfig[]>;
  upsertCommand(row: StoredCommandConfig): Promise<void>;
  deleteCommand(botId: string, name: string): Promise<void>;
  deleteBySource(botId: string, source: "manual" | "imported"): Promise<void>;
  deleteImportedFromRepo(botId: string, repositoryId: string): Promise<void>;
  setCommandEnabled(botId: string, name: string, enabled: boolean): Promise<void>;
  listRepositories(botId: string): Promise<StoredRepository[]>;
  upsertRepository(row: StoredRepository): Promise<void>;
  deleteRepository(botId: string, repositoryId: string): Promise<void>;
  clearRepositories(botId: string): Promise<void>;
}

export interface BotModeStore {
  getMode(botId: string): Promise<"bot" | "agent">;
  setMode(botId: string, mode: "bot" | "agent"): Promise<void>;
}

export function parseSourceTag(tag: string): CommandSource {
  if (tag === "manual") return { kind: "manual" };
  if (tag.startsWith("imported:")) {
    return { kind: "imported", repositoryId: tag.slice("imported:".length) };
  }
  return { kind: "manual" };
}

export function formatSourceTag(source: CommandSource): string {
  return source.kind === "manual" ? "manual" : `imported:${source.repositoryId}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function slugifyRepoId(url: string): string {
  const slug = url
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "repo";
}

export function registerCompiledCommand(
  botId: string,
  config: NormalizedCodelessConfig,
  source: CommandSource,
  enabled: boolean,
): void {
  void botId;
  commandRegistry.register({
    meta: {
      name: config.name,
      description: config.description,
      category: config.category,
      usage: config.usage,
      cooldown: config.cooldown,
    },
    onCommand: config.handlers.includes("onCommand")
      ? (() => {}) as unknown as NonNullable<Parameters<typeof commandRegistry.register>[0]["onCommand"]>
      : undefined,
    onChat: config.handlers.includes("onChat")
      ? (() => {}) as unknown as NonNullable<Parameters<typeof commandRegistry.register>[0]["onChat"]>
      : undefined,
    matchesOnChat: config.onChat ? (message: string) => matchesOnChatMessage(message, config.onChat as NonNullable<NormalizedCodelessConfig["onChat"]>) : undefined,
    source: source.kind === "manual" ? { kind: "manual" } : { kind: "imported", repositoryId: source.repositoryId },
    config,
    enabled,
  });
  if (config.api) {
    registerCommandApi({
      commandName: config.name,
      endpoint: config.api.endpoint,
      method: config.api.method,
      requiresKey: config.api.requiresApiKey,
      updatedAt: nowIso(),
    });
  }
}

export async function createCommand(
  store: CommandStore,
  botId: string,
  raw: CodelessCommandConfig,
  source: CommandSource = { kind: "manual" },
): Promise<{ config: NormalizedCodelessConfig; moduleSource: string; mdText: string }> {
  const config = normalizeCodelessConfig(raw);
  assertValidCodelessConfig(config);
  const mdText = serializeCommandMarkdown(config);
  const moduleSource = compileNormalizedCommandModule(config);
  await store.upsertCommand({
    botId,
    name: config.name,
    source,
    mdText,
    enabled: true,
    updatedAt: nowIso(),
  });
  registerCompiledCommand(botId, config, source, true);
  return { config, moduleSource, mdText };
}

export async function deleteCommand(
  store: CommandStore,
  botId: string,
  name: string,
): Promise<void> {
  await store.deleteCommand(botId, String(name).toLowerCase());
  commandRegistry.unregister(name);
  unregisterCommandApi(name);
}

export async function setCommandEnabled(
  store: CommandStore,
  botId: string,
  name: string,
  enabled: boolean,
): Promise<void> {
  await store.setCommandEnabled(botId, String(name).toLowerCase(), enabled);
  commandRegistry.setEnabled(name, enabled);
}

export async function fetchEndpointDetection(
  input: FetchDetectInput,
  fetcher?: typeof fetch,
): Promise<ReturnType<typeof detectEndpoint>> {
  return detectEndpoint(input, fetcher);
}

export async function addRepository(
  store: CommandStore,
  botId: string,
  url: string,
  files: RepoFile[],
): Promise<{ repositoryId: string; importedCount: number; skipped: { filePath: string; reason: string }[] }> {
  const repositoryId = `${slugifyRepoId(url)}-${Date.now().toString(36)}`;
  const { imported, skipped } = scanRepositoryFiles(files);
  await store.upsertRepository({ id: repositoryId, botId, url, lastSyncedAt: nowIso() });
  for (const item of imported) {
    await createCommand(store, botId, item.config, { kind: "imported", repositoryId });
  }
  return { repositoryId, importedCount: imported.length, skipped };
}

export async function removeRepository(
  store: CommandStore,
  botId: string,
  repositoryId: string,
): Promise<void> {
  const commands = await store.listCommands(botId);
  for (const cmd of commands) {
    if (cmd.source.kind === "imported" && cmd.source.repositoryId === repositoryId) {
      commandRegistry.unregister(cmd.name);
      unregisterCommandApi(cmd.name);
    }
  }
  await store.deleteImportedFromRepo(botId, repositoryId);
  await store.deleteRepository(botId, repositoryId);
}

export async function removeAllImported(store: CommandStore, botId: string): Promise<void> {
  const commands = await store.listCommands(botId);
  for (const cmd of commands) {
    if (cmd.source.kind === "imported") {
      commandRegistry.unregister(cmd.name);
      unregisterCommandApi(cmd.name);
    }
  }
  await store.deleteBySource(botId, "imported");
  await store.clearRepositories(botId);
}

export async function removeAllManual(store: CommandStore, botId: string): Promise<void> {
  const commands = await store.listCommands(botId);
  for (const cmd of commands) {
    if (cmd.source.kind === "manual") {
      commandRegistry.unregister(cmd.name);
      unregisterCommandApi(cmd.name);
    }
  }
  await store.deleteBySource(botId, "manual");
}

export async function resetCommands(store: CommandStore, botId: string): Promise<void> {
  const commands = await store.listCommands(botId);
  for (const cmd of commands) {
    commandRegistry.unregister(cmd.name);
    unregisterCommandApi(cmd.name);
  }
  await store.deleteBySource(botId, "manual");
  await store.deleteBySource(botId, "imported");
  await store.clearRepositories(botId);
}

/**
 * Manual-commands download pairs: per manual command both its `.ts` module
 * and its `.md` interchange config (same schema the import scanner reads),
 * so the zip is itself a valid importable repository.
 */
export async function downloadManualPairs(
  store: CommandStore,
  botId: string,
): Promise<{ name: string; ts: string; md: string }[]> {
  const commands = await store.listCommands(botId);
  const { parseCommandMarkdown } = await import("./command-markdown");
  const out: { name: string; ts: string; md: string }[] = [];
  for (const cmd of commands.filter((c) => c.source.kind === "manual")) {
    const config = parseCommandMarkdown(cmd.mdText);
    out.push({
      name: cmd.name,
      ts: compileNormalizedCommandModule(config),
      md: cmd.mdText,
    });
  }
  return out;
}

/** Minimal STORE-method zip writer (no deflate) for the manual download. */
export function buildZipStore(files: { name: string; content: string }[]): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();
  const crcOf = (data: Uint8Array): number => {
    let crc = 0xffffffff;
    for (const b of data) crc = crcTable[(crc ^ b) & 0xff] as number ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  };
  const u16 = (v: number): Uint8Array => new Uint8Array([v & 0xff, (v >> 8) & 0xff]);
  const u32 = (v: number): Uint8Array => new Uint8Array([v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff]);
  const concat = (...parts: Uint8Array[]): Uint8Array => {
    const total = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  };
  let centralSize = 0;
  let centralOffset = 0;
  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const dataBytes = encoder.encode(file.content);
    const crc = crcOf(dataBytes);
    const local = concat(
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(dataBytes.length), u32(dataBytes.length), u16(nameBytes.length), u16(0),
      nameBytes, dataBytes,
    );
    chunks.push(local);
    const centralEntry = concat(
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(dataBytes.length), u32(dataBytes.length), u16(nameBytes.length),
      u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBytes,
    );
    central.push(centralEntry);
    centralSize += centralEntry.length;
    offset += local.length;
  }
  centralOffset = offset;
  const body = concat(...chunks, ...central);
  const end = concat(
    u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(centralSize), u32(centralOffset), u16(0),
  );
  return concat(body, end);
}

export function buildManualDownloadZip(pairs: { name: string; ts: string; md: string }[]): Uint8Array {
  const files: { name: string; content: string }[] = [];
  for (const pair of pairs) {
    files.push({ name: `${pair.name}.ts`, content: pair.ts });
    files.push({ name: `${pair.name}.md`, content: pair.md });
  }
  return buildZipStore(files);
}
