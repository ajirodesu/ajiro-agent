/**
 * Bot command authoring tools — Ajiro Agent's port of Persian-Bot's
 * `engine/agent/tools/admin-{generate,add,edit,remove}-command.ts`
 * (reference only for the four tool-call shape).
 *
 * Reimplemented against Ajiro Agent's own agent + command store. The guard
 * extends "system admin only" with an owner-of-this-bot-with-Agent-Mode-
 * enabled check: Agent Mode additionally exposes these tools to the
 * enabling bot's owner, scoped to their own bot only — every other bot
 * still requires the system-admin gate.
 */
import { z } from "zod";
import type { CodelessCommandConfig } from "../modules/codeless/command-config.types";
import { normalizeCodelessConfig, assertValidCodelessConfig } from "../modules/codeless/command-config.types";
import { compileNormalizedCommandModule } from "../modules/codeless/command-compile";
import { serializeCommandMarkdown, parseCommandMarkdown } from "../modules/codeless/command-markdown";
import type { CommandStore } from "../modules/codeless/command-service";
import { createCommand, deleteCommand } from "../modules/codeless/command-service";

export type BotToolGuard = {
  isSystemAdmin: (callerId: string) => Promise<boolean> | boolean;
  isBotOwner: (callerId: string, botId: string) => Promise<boolean> | boolean;
  getBotMode: (botId: string) => Promise<"bot" | "agent"> | "bot" | "agent";
};

export async function canUseBotCommandTools(
  guard: BotToolGuard,
  callerId: string,
  botId: string,
): Promise<boolean> {
  if (await guard.isSystemAdmin(callerId)) return true;
  const [owner, mode] = await Promise.all([
    guard.isBotOwner(callerId, botId),
    guard.getBotMode(botId),
  ]);
  return owner === true && mode === "agent";
}

export async function requireBotCommandAccess(
  guard: BotToolGuard,
  callerId: string,
  botId: string,
): Promise<string | null> {
  const allowed = await canUseBotCommandTools(guard, callerId, botId);
  return allowed ? null : "Access denied: bot command tools require system-admin rights, or bot ownership with Agent Mode enabled.";
}

const codelessConfigSchema = z.object({
  name: z.string(),
  description: z.string().optional().default(""),
  category: z.string().optional().default("Utility"),
  usage: z.string().optional().default(""),
  cooldown: z.number().optional().default(5),
  handlers: z.array(z.enum(["onCommand", "onReply", "onButton", "onChat"])).optional().default(["onCommand"]),
  responseMedia: z.enum(["text", "image", "video", "audio", "file"]).optional().default("text"),
  caption: z.string(),
  displayCommandName: z.boolean().optional().default(false),
  lineSeparator: z.boolean().optional().default(false),
  buttonLabel: z.string().optional().default("🔄 Action"),
  onChatKeyword: z.string().optional().default(""),
  onChatDetection: z.enum(["exact", "contains", "startsWith", "regex"]).optional().default("contains"),
  onChatCaseSensitive: z.boolean().optional().default(false),
});

function toConfig(input: z.infer<typeof codelessConfigSchema>): CodelessCommandConfig {
  // Defensive defaults: direct execute() calls (and some SDK paths) can
  // bypass zod's .default() application, so never trust optional fields.
  const handlers = input.handlers ?? ["onCommand"];
  return {
    name: input.name,
    description: input.description ?? "",
    category: input.category ?? "Utility",
    usage: input.usage ?? "",
    cooldown: input.cooldown ?? 5,
    handlers,
    responseMedia: input.responseMedia ?? "text",
    caption: input.caption,
    displayCommandName: input.displayCommandName ?? false,
    lineSeparator: input.lineSeparator ?? false,
    button: { enabled: handlers.includes("onButton"), label: input.buttonLabel ?? "🔄 Action" },
    onChat: handlers.includes("onChat")
      ? { detectionMode: input.onChatDetection ?? "contains", keyword: input.onChatKeyword ?? "", caseSensitive: input.onChatCaseSensitive ?? false }
      : null,
    api: null,
  };
}

export function createBotCommandTools(input: {
  store: CommandStore;
  guard: BotToolGuard;
  botId: string;
  callerId: string;
}) {
  const { store, guard, botId, callerId } = input;

  return {
    admin_generate_command: {
      description: "Analyze a natural-language request and return a ready-to-fill codeless command scaffold.",
      inputSchema: z.object({
        request: z.string().describe("What the command should do."),
        interaction: z.enum(["command", "onReply", "onChat", "buttons"]).optional(),
        filename: z.string().optional(),
      }),
      async execute(args: { request: string; interaction?: string; filename?: string }) {
        const denial = await requireBotCommandAccess(guard, callerId, botId);
        if (denial) return denial;
        const request = String(args.request ?? "").trim();
        if (!request) return "No request provided — describe the command to build.";
        const slug = (args.filename ?? request)
          .toLowerCase()
          .replace(/[^a-z0-9\s-]/g, " ")
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 4)
          .join("-") || "new-command";
        const existing = await store.listCommands(botId);
        const collision = existing.some((c) => c.name === slug);
        const scaffold: CodelessCommandConfig = {
          name: slug,
          description: request.slice(0, 140),
          category: "Utility",
          usage: "",
          cooldown: 5,
          handlers: args.interaction === "onChat" ? ["onChat"] : args.interaction === "onReply" ? ["onCommand", "onReply"] : args.interaction === "buttons" ? ["onCommand", "onButton"] : ["onCommand"],
          responseMedia: "text",
          caption: "TODO: reply text",
          displayCommandName: false,
          lineSeparator: false,
          button: { enabled: args.interaction === "buttons", label: "🔄 Action" },
          onChat: args.interaction === "onChat" ? { detectionMode: "contains", keyword: "TODO", caseSensitive: false } : null,
          api: null,
        };
        const normalized = normalizeCodelessConfig(scaffold);
        return [
          `# Command Authoring Kit — "${slug}"`,
          ``,
          `## Request`,
          request,
          ``,
          collision ? `- COLLISION: "${slug}" already exists — edit it instead.` : `- Name available (${existing.length} commands).`,
          ``,
          `## Scaffold (write with admin_add_command)`,
          "```ts",
          compileNormalizedCommandModule(normalized).slice(0, 4000),
          "```",
        ].join("\n");
      },
    },
    admin_add_command: {
      description: "Validate and write a finished codeless command.",
      inputSchema: codelessConfigSchema,
      async execute(args: z.infer<typeof codelessConfigSchema>) {
        const denial = await requireBotCommandAccess(guard, callerId, botId);
        if (denial) return { ok: false as const, message: denial };
        try {
          const config = toConfig(args);
          const created = await createCommand(store, botId, config, { kind: "manual" });
          return { ok: true as const, name: created.config.name, md: created.mdText };
        } catch (err) {
          return { ok: false as const, message: err instanceof Error ? err.message : String(err) };
        }
      },
    },
    admin_edit_command: {
      description: "Edit an existing codeless command by merging new caption/description/cooldown fields.",
      inputSchema: z.object({
        name: z.string(),
        caption: z.string().optional(),
        description: z.string().optional(),
        cooldown: z.number().optional(),
      }),
      async execute(args: { name: string; caption?: string; description?: string; cooldown?: number }) {
        const denial = await requireBotCommandAccess(guard, callerId, botId);
        if (denial) return { ok: false as const, message: denial };
        const commands = await store.listCommands(botId);
        const existing = commands.find((c) => c.name === String(args.name).toLowerCase());
        if (!existing) return { ok: false as const, message: `No command named "${args.name}".` };
        const config = normalizeCodelessConfig(parseCommandMarkdown(existing.mdText));
        if (args.caption !== undefined) config.caption = args.caption;
        if (args.description !== undefined) config.description = args.description;
        if (args.cooldown !== undefined) config.cooldown = args.cooldown;
        assertValidCodelessConfig(config);
        await createCommand(store, botId, config, existing.source.kind === "manual" ? { kind: "manual" } : { kind: "imported", repositoryId: existing.source.repositoryId });
        return { ok: true as const, name: config.name };
      },
    },
    admin_remove_command: {
      description: "Remove a codeless command.",
      inputSchema: z.object({ name: z.string() }),
      async execute(args: { name: string }) {
        const denial = await requireBotCommandAccess(guard, callerId, botId);
        if (denial) return { ok: false as const, message: denial };
        await deleteCommand(store, botId, args.name);
        return { ok: true as const, name: args.name };
      },
    },
  };
}

export function commandScaffoldMarkdown(config: CodelessCommandConfig): string {
  return serializeCommandMarkdown(normalizeCodelessConfig(config));
}
