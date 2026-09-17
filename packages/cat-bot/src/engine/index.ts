/**
 * Built-in bot engine barrel — Ajiro Agent's port of Persian-Bot's
 * `engine/controllers/index.ts` + `engine/app.ts loadCommands()` pattern.
 *
 * Loads every persisted MD config for a bot at startup (and on add/remove),
 * compiles each into the real command module format, and registers it into
 * the same `commandRegistry` hand-written files use. Keyed by `meta.name`;
 * no alias-registration step (this meta has no aliases).
 */
export { commandRegistry } from "./lib/command-registry";
export type { BotCommandModule, BotHandlerCtx } from "./lib/command-registry";
export {
  checkCooldown,
  recordCooldown,
  markCooldownNotified,
  clearCooldowns,
  OptionsMap,
  parseTextOptions,
} from "./lib/pipeline";
export { routeMessage } from "./handlers/message-router";
export type { BotMode, RouteOutcome } from "./handlers/message-router";
export {
  CODELESS_AUTHOR,
  normalizeCodelessConfig,
  validateCodelessConfig,
  assertValidCodelessConfig,
} from "./modules/codeless/command-config.types";
export type {
  CodelessCommandConfig,
  NormalizedCodelessConfig,
} from "./modules/codeless/command-config.types";
export { serializeCommandMarkdown, parseCommandMarkdown } from "./modules/codeless/command-markdown";
export { compileCommandModule, compileNormalizedCommandModule, buildCaptionExpression } from "./modules/codeless/command-compile";
export { matchesOnChatMessage } from "./modules/codeless/onchat-match";
export { scanRepositoryFiles } from "./modules/codeless/repo-import";
export { detectEndpoint, extractInputs, classifyResponse } from "./modules/codeless/fetch-detect";
export {
  createCommand,
  deleteCommand,
  setCommandEnabled,
  addRepository,
  removeRepository,
  removeAllImported,
  removeAllManual,
  resetCommands,
  downloadManualPairs,
  buildManualDownloadZip,
  registerCompiledCommand,
} from "./modules/codeless/command-service";
export { listApis, formatApiList } from "./lib/api-registry";
export { createBotCommandTools, canUseBotCommandTools } from "./agent/bot-command-tools";

import { parseCommandMarkdown } from "./modules/codeless/command-markdown";
import { normalizeCodelessConfig } from "./modules/codeless/command-config.types";
import { registerCompiledCommand, type CommandStore } from "./modules/codeless/command-service";
import { commandRegistry } from "./lib/command-registry";

/** Load (or reload) every stored command for a bot into the registry. */
export async function loadBotCommands(store: CommandStore, botId: string): Promise<string[]> {
  const rows = await store.listCommands(botId);
  const names: string[] = [];
  for (const row of rows) {
    try {
      const config = normalizeCodelessConfig(parseCommandMarkdown(row.mdText));
      registerCompiledCommand(botId, config, row.source, row.enabled);
      names.push(config.name);
    } catch {
      // Skip corrupt rows without breaking the whole load.
    }
  }
  return names;
}

/** Remove every command belonging to a bot from the in-memory registry. */
export async function unloadBotCommands(store: CommandStore, botId: string): Promise<void> {
  const rows = await store.listCommands(botId);
  for (const row of rows) commandRegistry.unregister(row.name);
}
