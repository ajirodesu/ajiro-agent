/**
 * Message router — Ajiro Agent's port of Persian-Bot's
 * `engine/controllers/handlers/message.handler.ts` fallthrough (+ the
 * `onChat` content-match pass from section 6).
 *
 * Order per message:
 *   1. pending onReply state match → run it (structural only, ungated)
 *   2. command-name match → onCommand lane (enforceCooldown → options → handler)
 *   3. onChat content-match pass → first matching onChat wins (cooldown only)
 *   4. fallthrough: Bot Mode → no response; Agent Mode → conversational reply
 *
 * Generated and imported commands run through this same pipeline as
 * hand-written commands — no parallel dispatch path.
 */
import { commandRegistry, type BotCommandModule } from "../lib/command-registry";
import {
  checkCooldown,
  recordCooldown,
  markCooldownNotified,
  OptionsMap,
  parseTextOptions,
} from "../lib/pipeline";
import { matchesOnChatMessage } from "../modules/codeless/onchat-match";

export type BotMode = "bot" | "agent";

export type RouteOutcome =
  | { kind: "reply-state"; command: string; stateKey: string }
  | { kind: "command"; command: string }
  | { kind: "onchat"; command: string }
  | { kind: "agent"; reason: "unmatched" }
  | { kind: "silent"; reason: "bot-mode" | "disabled" | "cooldown-notice-suppressed" | "no-match-handler" };

export type PendingReplyStore = {
  findByMessageId: (messageId: string) => { command: string; stateKey: string } | null;
};

export type RouterDeps = {
  senderId: string;
  resolveCommand: (name: string) => BotCommandModule | undefined;
  pendingReplies?: PendingReplyStore | null;
  runHandler?: (mod: BotCommandModule, lane: "onCommand" | "onChat" | "onReply", stateKey?: string) => Promise<CooldownNotice | void>;
  onAgentReply?: () => Promise<void>;
};

export type CooldownNotice = { remainingSec: number; firstNotice: boolean } | null;

function cooldownOf(mod: BotCommandModule): number {
  const raw = mod?.meta?.["cooldown"];
  return typeof raw === "number" && raw >= 0 ? raw : 0;
}

export async function routeMessage(input: {
  text: string;
  senderId: string;
  mode: BotMode;
  replyToMessageId?: string | null;
  deps: RouterDeps;
}): Promise<RouteOutcome> {
  const { text, senderId, mode, replyToMessageId, deps } = input;
  const trimmed = String(text ?? "").trim();

  // 1. onReply: pending state match first (structural, ungated).
  if (replyToMessageId && deps.pendingReplies) {
    const pending = deps.pendingReplies.findByMessageId(replyToMessageId);
    if (pending) {
      const mod = deps.resolveCommand(pending.command);
      if (mod && mod.enabled !== false && mod.onReply?.[pending.stateKey]) {
        await deps.runHandler?.(mod, "onReply", pending.stateKey);
        return { kind: "reply-state", command: pending.command, stateKey: pending.stateKey };
      }
    }
  }

  // 2. onCommand: first token match (prefix already stripped by caller).
  const firstToken = trimmed.split(/\s+/).filter(Boolean)[0]?.toLowerCase() ?? "";
  if (firstToken) {
    const mod = deps.resolveCommand(firstToken);
    if (mod && mod.enabled !== false && mod.onCommand) {
      const verdict = checkCooldown(firstToken, senderId, cooldownOf(mod));
      if (!verdict.allowed) {
        if (verdict.firstNotice) markCooldownNotified(firstToken, senderId);
        return { kind: "silent", reason: "cooldown-notice-suppressed" };
      }
      recordCooldown(firstToken, senderId, cooldownOf(mod));
      const options = new OptionsMap(
        parseTextOptions(trimmed, ((mod.meta?.["options"] as { name: string }[] | undefined) ?? [])),
      );
      void options;
      await deps.runHandler?.(mod, "onCommand");
      return { kind: "command", command: firstToken };
    }
  }

  // 3. onChat: content-match pass over every loaded command; first match wins.
  for (const mod of commandRegistry.list()) {
    if (mod.enabled === false || !mod.onChat) continue;
    const name = String(mod.meta.name).toLowerCase();
    let matched = false;
    if (typeof mod.matchesOnChat === "function") {
      try {
        matched = mod.matchesOnChat(trimmed);
      } catch {
        matched = false;
      }
    } else if (mod.config?.onChat) {
      matched = matchesOnChatMessage(trimmed, mod.config.onChat);
    }
    if (!matched) continue;
    const verdict = checkCooldown(name, senderId, cooldownOf(mod));
    if (!verdict.allowed) {
      if (verdict.firstNotice) markCooldownNotified(name, senderId);
      return { kind: "silent", reason: "cooldown-notice-suppressed" };
    }
    recordCooldown(name, senderId, cooldownOf(mod));
    await deps.runHandler?.(mod, "onChat");
    return { kind: "onchat", command: name };
  }

  // 4. Fallthrough — the Bot Mode / Agent Mode check lives here and nowhere else.
  if (mode === "agent") {
    await deps.onAgentReply?.();
    return { kind: "agent", reason: "unmatched" };
  }
  return { kind: "silent", reason: "bot-mode" };
}
