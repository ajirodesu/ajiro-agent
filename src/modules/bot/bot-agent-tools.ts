/**
 * Bot command agent tools — wires the built-in bot's four command-authoring
 * tools (`admin_generate_command`, `admin_add_command`,
 * `admin_edit_command`, `admin_remove_command`) into Ajiro Agent's own agent
 * runtime as `ai`-SDK tools.
 *
 * Access follows the engine guard (`canUseBotCommandTools`): system admins
 * pass, otherwise only the bot's owner with Agent Mode enabled passes.
 * Adaptation note: Ajiro Agent is single-user on-device, so there is no
 * system-admin identity (`isSystemAdmin` is always false) and the local
 * device user is the default bot's owner. Net effect — exactly the spec's
 * observable rule: the tools are available if and only if this bot's mode
 * is Agent Mode (the default). In Bot Mode they are not registered at all.
 */
import { tool } from "ai";

import type { BotCommandRepository } from "@/core/db/repositories/bot-command-repository";
import type { ToolExecutionRecord } from "@/core/types/app-state";
import { DEFAULT_BOT_ID } from "@/modules/bot/bot-constants";
import { createRecord, summarizeValue } from "@/modules/tools/built-in/shared";
import { createBotCommandTools } from "../../../packages/cat-bot/src/engine/agent/bot-command-tools";

/** Agent Mode is the default — fail open so an unreadable mode never locks out authoring. */
export async function isBotAgentMode(
  repository: Pick<BotCommandRepository, "getMode">,
  botId: string = DEFAULT_BOT_ID,
): Promise<boolean> {
  try {
    return (await repository.getMode(botId)) === "agent";
  } catch {
    return true;
  }
}

export function createBotCommandAgentTools(input: {
  botId?: string;
  callerId?: string;
  onRecord?: (record: ToolExecutionRecord) => void;
  repository: BotCommandRepository;
}) {
  const {
    botId = DEFAULT_BOT_ID,
    callerId = "local",
    onRecord,
    repository,
  } = input;

  const raw = createBotCommandTools({
    store: repository,
    guard: {
      isSystemAdmin: () => false,
      isBotOwner: (caller, bot) => caller === callerId && bot === botId,
      getBotMode: async (bot) => {
        try {
          return await repository.getMode(bot);
        } catch {
          return "agent";
        }
      },
    },
    botId,
    callerId,
  });

  type EngineTools = ReturnType<typeof createBotCommandTools>;

  const wrap = <K extends keyof EngineTools & string>(
    toolName: K,
    definition: EngineTools[K],
  ) =>
    tool({
      description: definition.description,
      // oxlint-disable-next-line no-explicit-any
      inputSchema: definition.inputSchema as any,
      // oxlint-disable-next-line no-explicit-any
      execute: async (args: any) => {
        const inputSummary = summarizeValue(args);
        try {
          const result = await (
            // oxlint-disable-next-line no-explicit-any
            definition.execute as (input: any) => Promise<unknown>
          )(args);
          onRecord?.(
            createRecord({
              toolName,
              status: "completed",
              inputSummary,
              outputSummary: summarizeValue(result),
            }),
          );
          return result;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          onRecord?.(
            createRecord({
              toolName,
              status: "failed",
              inputSummary,
              error: message,
            }),
          );
          throw err;
        }
      },
    });

  return {
    tools: {
      admin_generate_command: wrap("admin_generate_command", raw.admin_generate_command),
      admin_add_command: wrap("admin_add_command", raw.admin_add_command),
      admin_edit_command: wrap("admin_edit_command", raw.admin_edit_command),
      admin_remove_command: wrap("admin_remove_command", raw.admin_remove_command),
    },
  };
}
