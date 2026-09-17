/**
 * commandRegistry — Ajiro Agent's port of Persian-Bot's registry pattern
 * (engine/lib/module-registry.lib.js, reference only).
 *
 * Single in-memory registry shared by hand-written files and compiled
 * codeless/imported commands. Keyed by `meta.name` (lowercase). No alias
 * registration step: this feature's meta has no `aliases` field at all.
 */
import type { NormalizedCodelessConfig } from "../modules/codeless/command-config.types";

export type BotCommandModule = {
  meta: { name: string; cooldown?: number; [key: string]: unknown };
  onCommand?: (ctx: BotHandlerCtx) => Promise<void> | void;
  onChat?: (ctx: BotHandlerCtx) => Promise<void> | void;
  onReply?: Record<string, (ctx: BotHandlerCtx) => Promise<void> | void>;
  button?: Record<string, { label: string; onClick: (ctx: BotHandlerCtx) => Promise<void> | void }>;
  matchesOnChat?: (message: string) => boolean;
  source?: { kind: "manual" | "imported"; repositoryId?: string | null };
  config?: NormalizedCodelessConfig;
  enabled?: boolean;
};

export type BotHandlerCtx = {
  args: string[];
  message: string;
  event: Record<string, unknown>;
  chat: {
    replyMessage: (input: { message: string }) => Promise<string | undefined>;
    reply: (input: { message: string }) => Promise<string | undefined>;
    editMessage: (input: { message: string; message_id_to_edit?: unknown }) => Promise<void>;
  };
  state: {
    create: (input: { id: string; state: string; context?: unknown }) => void;
    delete: (id: string) => void;
    generateID: (input: { id: string }) => string;
  };
  button?: { generateID: (input: { id: string; public?: boolean }) => string };
  options: { get: (name: string) => string | undefined };
  session: { id: string; context: Record<string, unknown> };
  native: { platform: string };
};

class CommandRegistry {
  private commands = new Map<string, BotCommandModule>();

  register(mod: BotCommandModule): void {
    const name = String(mod?.meta?.name ?? "").toLowerCase();
    if (!name) throw new Error("Cannot register a command without meta.name.");
    this.commands.set(name, { enabled: true, ...mod });
  }

  unregister(name: string): boolean {
    return this.commands.delete(String(name).toLowerCase());
  }

  clear(): void {
    this.commands.clear();
  }

  get(name: string): BotCommandModule | undefined {
    return this.commands.get(String(name).toLowerCase());
  }

  list(): BotCommandModule[] {
    return [...this.commands.values()];
  }

  setEnabled(name: string, enabled: boolean): void {
    const mod = this.commands.get(String(name).toLowerCase());
    if (mod) mod.enabled = enabled;
  }

  size(): number {
    return this.commands.size;
  }
}

export const commandRegistry = new CommandRegistry();
