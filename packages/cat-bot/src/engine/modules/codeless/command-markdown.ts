/**
 * MD interchange format — human-readable, portable command config.
 *
 * One `.md` file per command. This is the storage/transport format only:
 * repositories of importable commands contain many `.md` files, and the
 * manual-commands download `.zip` pairs each `<name>.ts` with its `<name>.md`
 * in this exact schema so the zip is itself a valid importable repository.
 *
 * The secret API key VALUE is never part of this format — only the
 * `${API_KEY}` placeholder and its Send As location travel here. Values stay
 * in per-bot secure storage and are substituted at request time.
 */
import type {
  ApiKeySendAs,
  CodelessApiConfig,
  CodelessCommandConfig,
  CodelessDetectionMode,
  CodelessHandler,
  CodelessResponseMedia,
  CodelessResponseType,
  NormalizedCodelessConfig,
} from "./command-config.types";
import {
  normalizeCodelessConfig,
  assertValidCodelessConfig,
} from "./command-config.types";

function esc(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, "\\n");
}

function unesc(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch === "\\" && i + 1 < value.length) {
      const next = value[i + 1];
      if (next === "n") {
        out += "\n";
        i += 1;
        continue;
      }
      out += next;
      i += 1;
      continue;
    }
    out += ch;
  }
  return out;
}

function section(md: string, title: string): string[] {
  const lines = md.split("\n");
  const head = `## ${title}`;
  const start = lines.findIndex((l) => l.trim() === head);
  if (start === -1) return [];
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i]?.startsWith("## ")) break;
    out.push(lines[i] ?? "");
  }
  return out;
}

function kv(lines: string[]): Record<string, string> {
  const record: Record<string, string> = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("- ")) continue;
    const rest = trimmed.slice(2);
    const colon = rest.indexOf(":");
    if (colon === -1) continue;
    record[rest.slice(0, colon).trim()] = unesc(rest.slice(colon + 1).trim());
  }
  return record;
}

function parseSwitch(value: string | undefined): boolean {
  return String(value ?? "").trim().toLowerCase() === "on";
}

export function serializeCommandMarkdown(config: CodelessCommandConfig): string {
  const c = normalizeCodelessConfig(config);
  const lines: string[] = [];
  lines.push(`# command: ${c.name}`, "");
  lines.push("## Command Meta");
  lines.push(`- name: ${esc(c.name)}`);
  lines.push(`- description: ${esc(c.description)}`);
  lines.push(`- category: ${esc(c.category)}`);
  lines.push(`- usage: ${esc(c.usage)}`);
  lines.push(`- cooldown: ${String(c.cooldown)}`);
  lines.push("");
  lines.push("## Handlers");
  lines.push(`- handlers: ${c.handlers.join(", ")}`);
  if (c.onChat) {
    lines.push(`- detectionMode: ${c.onChat.detectionMode}`);
    lines.push(`- keyword: ${esc(c.onChat.keyword)}`);
    lines.push(`- caseSensitive: ${c.onChat.caseSensitive ? "on" : "off"}`);
  }
  lines.push("");
  lines.push("## Response");
  lines.push(`- media: ${c.responseMedia}`);
  lines.push(`- displayCommandName: ${c.displayCommandName ? "on" : "off"}`);
  lines.push(`- lineSeparator: ${c.lineSeparator ? "on" : "off"}`);
  lines.push(`- caption: ${esc(c.caption)}`);
  lines.push("");
  lines.push("## Button");
  lines.push(`- enabled: ${c.button.enabled ? "on" : "off"}`);
  lines.push(`- label: ${esc(c.button.label)}`);
  lines.push("");
  lines.push("## API Configuration");
  if (!c.api) {
    lines.push("- enabled: off");
  } else {
    const a = c.api;
    lines.push("- enabled: on");
    lines.push(`- endpoint: ${esc(a.endpoint)}`);
    lines.push(`- method: ${a.method}`);
    lines.push(`- inputs: ${a.inputs.map((i) => i.name).join(", ")}`);
    for (const [k, v] of Object.entries(a.headers)) {
      lines.push(`- header.${esc(k)}: ${esc(v)}`);
    }
    for (const [k, v] of Object.entries(a.params)) {
      lines.push(`- param.${esc(k)}: ${esc(v)}`);
    }
    lines.push(`- body: ${esc(a.body)}`);
    lines.push(`- responsePath: ${esc(a.responsePath)}`);
    lines.push(`- responseType: ${a.responseType}`);
    lines.push(`- requiresApiKey: ${a.requiresApiKey ? "on" : "off"}`);
    if (a.apiKeySendAs) {
      lines.push(`- apiKeySendAs: ${a.apiKeySendAs.kind}:${esc(a.apiKeySendAs.name)}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

export function parseCommandMarkdown(md: string): NormalizedCodelessConfig {
  const title = md.split("\n").find((l) => l.startsWith("# command:"));
  const fallbackName = title?.slice("# command:".length).trim() ?? "";
  const meta = kv(section(md, "Command Meta"));
  const handlers = kv(section(md, "Handlers"));
  const response = kv(section(md, "Response"));
  const button = kv(section(md, "Button"));
  const api = kv(section(md, "API Configuration"));

  const handlerList = String(handlers["handlers"] ?? "onCommand")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean) as CodelessHandler[];

  const headers: Record<string, string> = {};
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(api)) {
    if (k.startsWith("header.")) headers[k.slice("header.".length)] = v;
    if (k.startsWith("param.")) params[k.slice("param.".length)] = v;
  }

  let apiConfig: CodelessApiConfig | null = null;
  if (parseSwitch(api["enabled"])) {
    const inputs = String(api["inputs"] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((name) => ({ name }));
    let apiKeySendAs: ApiKeySendAs | null = null;
    const rawSendAs = String(api["apiKeySendAs"] ?? "").trim();
    if (rawSendAs) {
      const colon = rawSendAs.indexOf(":");
      if (colon > 0) {
        const kind = rawSendAs.slice(0, colon);
        const name = rawSendAs.slice(colon + 1);
        if ((kind === "header" || kind === "query") && name) {
          apiKeySendAs = { kind, name } as ApiKeySendAs;
        }
      }
    }
    apiConfig = {
      endpoint: api["endpoint"] ?? "",
      method: String(api["method"] ?? "GET").toUpperCase() === "POST" ? "POST" : "GET",
      inputs,
      headers,
      params,
      body: api["body"] ?? "",
      responsePath: api["responsePath"] ?? "",
      responseType: (String(api["responseType"] ?? "Text") as CodelessResponseType) ?? "Text",
      apiKeySendAs,
      requiresApiKey: parseSwitch(api["requiresApiKey"]),
    };
  }

  const raw: CodelessCommandConfig = {
    name: meta["name"] || fallbackName,
    description: meta["description"] ?? "",
    category: meta["category"] ?? "Utility",
    usage: meta["usage"] ?? "",
    cooldown: Number(meta["cooldown"] ?? 5),
    handlers: handlerList.length > 0 ? handlerList : ["onCommand"],
    responseMedia: (String(response["media"] ?? "text") as CodelessResponseMedia) ?? "text",
    caption: response["caption"] ?? "",
    displayCommandName: parseSwitch(response["displayCommandName"]),
    lineSeparator: parseSwitch(response["lineSeparator"]),
    button: {
      enabled: parseSwitch(button["enabled"]),
      label: button["label"] ?? "🔄 Action",
    },
    onChat: handlerList.includes("onChat")
      ? {
          detectionMode: (String(handlers["detectionMode"] ?? "contains") as CodelessDetectionMode) ?? "contains",
          keyword: handlers["keyword"] ?? "",
          caseSensitive: parseSwitch(handlers["caseSensitive"]),
        }
      : null,
    api: apiConfig,
  };
  const normalized = normalizeCodelessConfig(raw);
  assertValidCodelessConfig(normalized);
  return normalized;
}
