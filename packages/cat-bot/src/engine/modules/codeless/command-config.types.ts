/**
 * Codeless CommandMeta — Ajiro Agent's own narrowed port of Persian-Bot's
 * `CommandMeta` (packages/cat-bot/src/engine/types/module-meta.types.ts).
 *
 * Deliberately narrower: `version`, `role`, `aliases`, `platform`, and
 * `hasPrefix` do NOT exist here at all (not optional — absent). Ajiro's
 * built-in bot has no per-command restriction system; the only gate any
 * command carries is `cooldown` (enforced by the narrowed pipeline).
 *
 * `author` is always the hardcoded `CODELESS_AUTHOR` constant.
 */
export const CODELESS_AUTHOR = "AjiroDesu";

export type CodelessHandler = "onCommand" | "onReply" | "onButton" | "onChat";

export type CodelessDetectionMode =
  | "exact"
  | "contains"
  | "startsWith"
  | "regex";

export type CodelessResponseMedia =
  | "text"
  | "image"
  | "video"
  | "audio"
  | "file";

export type CodelessResponseType = "JSON" | "Text" | "Image URL" | "Buffer";

export interface CodelessCommandOption {
  type: "string";
  name: string;
  description: string;
  required: boolean;
}

/** Narrowed meta — the only shape generated `meta` objects ever use. */
export interface CodelessCommandMeta {
  name: string;
  author: typeof CODELESS_AUTHOR;
  description: string;
  category: string;
  usage: string;
  cooldown: number;
  options?: CodelessCommandOption[];
}

export interface CodelessApiInput {
  name: string;
}

export type ApiKeySendAs =
  | { kind: "header"; name: string }
  | { kind: "query"; name: string };

export interface CodelessApiConfig {
  endpoint: string;
  method: "GET" | "POST";
  inputs: CodelessApiInput[];
  headers: Record<string, string>;
  params: Record<string, string>;
  body: string;
  responsePath: string;
  responseType: CodelessResponseType;
  /** Portable placeholder location — never the secret value itself. */
  apiKeySendAs: ApiKeySendAs | null;
  /** True when the endpoint was proven to require auth (401/403 probe). */
  requiresApiKey: boolean;
}

export interface CodelessButtonConfig {
  enabled: boolean;
  label: string;
}

export interface CodelessOnChatConfig {
  detectionMode: CodelessDetectionMode;
  keyword: string;
  caseSensitive: boolean;
}

export interface CodelessCommandConfig {
  name: string;
  description: string;
  category: string;
  usage: string;
  cooldown: number;
  handlers: CodelessHandler[];
  responseMedia: CodelessResponseMedia;
  caption: string;
  displayCommandName: boolean;
  lineSeparator: boolean;
  button: CodelessButtonConfig;
  onChat: CodelessOnChatConfig | null;
  api: CodelessApiConfig | null;
}

export type NormalizedCodelessConfig = CodelessCommandConfig;

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function normalizeCodelessConfig(
  raw: CodelessCommandConfig,
): NormalizedCodelessConfig {
  const handlers = Array.from(new Set(raw.handlers ?? []));
  if (!handlers.includes("onCommand") && !handlers.includes("onChat")) {
    handlers.unshift("onCommand");
  }
  const cooldown = Number(raw.cooldown);
  return {
    name: String(raw.name ?? "").trim().toLowerCase(),
    description: String(raw.description ?? ""),
    category: String(raw.category ?? "Utility"),
    usage: String(raw.usage ?? ""),
    cooldown: Number.isFinite(cooldown) && cooldown >= 0 ? cooldown : 5,
    handlers: handlers as CodelessHandler[],
    responseMedia: raw.responseMedia ?? "text",
    caption: String(raw.caption ?? ""),
    displayCommandName: raw.displayCommandName === true,
    lineSeparator: raw.lineSeparator === true,
    button: {
      enabled:
        raw.button?.enabled === true || handlers.includes("onButton"),
      label: String(raw.button?.label ?? "🔄 Action").slice(0, 80) || "🔄 Action",
    },
    onChat: handlers.includes("onChat")
      ? {
          detectionMode: raw.onChat?.detectionMode ?? "contains",
          keyword: String(raw.onChat?.keyword ?? ""),
          caseSensitive: raw.onChat?.caseSensitive === true,
        }
      : null,
    api: raw.api
      ? {
          endpoint: String(raw.api.endpoint ?? ""),
          method: raw.api.method === "POST" ? "POST" : "GET",
          inputs: Array.isArray(raw.api.inputs) ? raw.api.inputs : [],
          headers:
            raw.api.headers && typeof raw.api.headers === "object"
              ? { ...raw.api.headers }
              : {},
          params:
            raw.api.params && typeof raw.api.params === "object"
              ? { ...raw.api.params }
              : {},
          body: String(raw.api.body ?? ""),
          responsePath: String(raw.api.responsePath ?? ""),
          responseType: raw.api.responseType ?? "Text",
          apiKeySendAs: raw.api.apiKeySendAs ?? null,
          requiresApiKey: raw.api.requiresApiKey === true,
        }
      : null,
  };
}

export function validateCodelessConfig(
  config: NormalizedCodelessConfig,
): string[] {
  const errors: string[] = [];
  if (!NAME_RE.test(config.name)) {
    errors.push(
      "name must be lowercase alphanumeric with dashes/underscores (e.g. bible).",
    );
  }
  if (!config.caption.trim() && !config.api) {
    errors.push("caption is required for commands without an API configuration.");
  }
  if (!config.handlers.includes("onCommand") && !config.handlers.includes("onChat")) {
    errors.push("at least one of onCommand or onChat is required.");
  }
  if (config.onChat && !config.onChat.keyword.trim()) {
    errors.push("onChat keyword/pattern is required when onChat is selected.");
  }
  if (config.onChat?.detectionMode === "regex") {
    try {
      // eslint-disable-next-line no-new
      new RegExp(config.onChat.keyword);
    } catch {
      errors.push("onChat regex pattern is invalid.");
    }
  }
  if (config.api && !config.api.endpoint.trim()) {
    errors.push("api endpoint is required when an API configuration is present.");
  }
  return errors;
}

export function assertValidCodelessConfig(
  config: NormalizedCodelessConfig,
): void {
  const errors = validateCodelessConfig(config);
  if (errors.length > 0) {
    throw new Error(`Invalid codeless command: ${errors.join(" ")}`);
  }
}
