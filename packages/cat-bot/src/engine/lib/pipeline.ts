/**
 * Narrowed middleware pipeline — Ajiro Agent's own port of Persian-Bot's
 * `engine/middleware/index.ts` + `on-command.middleware.ts` (reference only).
 *
 * Deliberately narrower: the ONLY gate is `enforceCooldown`, read from the
 * command's own `meta.cooldown`. `enforceNotBanned`, `enforcePermission`,
 * `enforceMaintenanceMode`, `enforceAdminOnly`, and `enforcePayment` (or any
 * equivalent) do not exist in either lane.
 *
 * - onCommand: enforceCooldown → validateCommandOptions → onCommand handler
 * - onChat:    enforceCooldown → onChat handler (content match, no options)
 * - onReply:   replyStateValidation (structural: pending state match only)
 * - onButton:  enforceButtonScope (structural: button id match only)
 */

export type CooldownVerdict =
  | { allowed: true }
  | { allowed: false; remainingSec: number; firstNotice: boolean };

type CooldownEntry = { expiry: number; notified: boolean };

const store = new Map<string, CooldownEntry>();
const MAX_ENTRIES = 2000;

export function cooldownKey(commandName: string, senderId: string): string {
  return `${String(commandName).toLowerCase()}:${String(senderId || "unknown")}`;
}

export function pruneCooldowns(now = Date.now()): void {
  if (store.size < MAX_ENTRIES) {
    for (const [key, entry] of store) {
      if (entry.expiry <= now) store.delete(key);
    }
    return;
  }
  const sorted = [...store.entries()].sort((a, b) => a[1].expiry - b[1].expiry);
  const drop = sorted.length - Math.floor(MAX_ENTRIES * 0.8);
  for (let i = 0; i < drop; i += 1) store.delete(sorted[i]?.[0] as string);
}

export function checkCooldown(
  commandName: string,
  senderId: string,
  cooldownSec: number,
  now = Date.now(),
): CooldownVerdict {
  if (!Number.isFinite(cooldownSec) || cooldownSec <= 0) return { allowed: true };
  pruneCooldowns(now);
  const key = cooldownKey(commandName, senderId);
  const entry = store.get(key);
  if (entry && entry.expiry > now) {
    return {
      allowed: false,
      remainingSec: Math.max(1, Math.ceil((entry.expiry - now) / 1000)),
      firstNotice: !entry.notified,
    };
  }
  if (entry) store.delete(key);
  return { allowed: true };
}

export function recordCooldown(
  commandName: string,
  senderId: string,
  cooldownSec: number,
  now = Date.now(),
): void {
  if (!Number.isFinite(cooldownSec) || cooldownSec <= 0) return;
  const key = cooldownKey(commandName, senderId);
  store.set(key, { expiry: now + cooldownSec * 1000, notified: false });
}

export function markCooldownNotified(commandName: string, senderId: string): void {
  const entry = store.get(cooldownKey(commandName, senderId));
  if (entry) entry.notified = true;
}

export function clearCooldowns(): void {
  store.clear();
}

/** Minimal OptionsMap port (validateCommandOptions reads meta.options). */
export class OptionsMap {
  private values: Record<string, string>;
  constructor(values: Record<string, string> = {}) {
    this.values = { ...values };
  }
  static empty(): OptionsMap {
    return new OptionsMap({});
  }
  get(name: string): string | undefined {
    return this.values[name];
  }
  toRecord(): Record<string, string> {
    return { ...this.values };
  }
}

export function parseTextOptions(
  message: string,
  defs: { name: string }[],
): Record<string, string> {
  const out: Record<string, string> = {};
  const text = String(message ?? "");
  for (const def of defs) {
    const re = new RegExp(`--${def.name}=(\\S+)|--${def.name}\\s+(\\S+)`, "i");
    const m = text.match(re);
    const value = m?.[1] ?? m?.[2];
    if (value !== undefined) out[def.name] = value;
  }
  return out;
}
