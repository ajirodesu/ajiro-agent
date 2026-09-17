/**
 * Codeless Compiler — config → genuine `.ts` command module source.
 *
 * The emitted source is a real Ajiro Agent command module in the exact
 * shape of the hand-written examples (same imports, same `meta` shape,
 * same `onCommand` / `onReply` / `button` / `onChat` exports): it can be
 * saved as `<name>.ts`, downloaded in the manual-commands zip, or written
 * by the agent tools, and it runs through the identical loader + middleware
 * pipeline as hand-written commands.
 *
 * The emitted `meta` NEVER contains version/role/aliases/platform/hasPrefix
 * — author is always the hardcoded constant. `onCommand` is generated when
 * selected (the loader requires onCommand or onChat); `onChat` matches by
 * content instead of by command name and produces the same styled output.
 */
import type {
  CodelessApiConfig,
  CodelessCommandConfig,
  NormalizedCodelessConfig,
} from "./command-config.types";
import {
  CODELESS_AUTHOR,
  normalizeCodelessConfig,
  assertValidCodelessConfig,
} from "./command-config.types";

function js(value: string): string {
  return JSON.stringify(value);
}

export function buildCaptionExpression(
  config: NormalizedCodelessConfig,
): string {
  const parts: string[] = [];
  if (config.displayCommandName) {
    parts.push(`"**/${config.name}**"`);
  }
  if (config.displayCommandName && config.lineSeparator) {
    parts.push(`"────────────"`);
  } else if (!config.displayCommandName && config.lineSeparator) {
    parts.push(`"────────────"`);
  }
  parts.push(js(config.caption));
  if (parts.length === 1) return parts[0] as string;
  return `[${parts.join(", ")}].join("\\n")`;
}

function emitApiHelpers(api: CodelessApiConfig): string {
  return [
    `const API_ENDPOINT = ${js(api.endpoint)};`,
    `const API_METHOD = ${js(api.method)};`,
    `const API_INPUTS = ${js(JSON.stringify(api.inputs.map((input) => input.name)))};`,
    `const API_HEADERS = ${js(JSON.stringify(api.headers))};`,
    `const API_PARAMS = ${js(JSON.stringify(api.params))};`,
    `const API_BODY = ${js(api.body)};`,
    `const API_RESPONSE_PATH = ${js(api.responsePath)};`,
    `const API_RESPONSE_TYPE = ${js(api.responseType)};`,
    `const API_KEY_SEND_AS = ${js(api.apiKeySendAs ? `${api.apiKeySendAs.kind}:${api.apiKeySendAs.name}` : "")};`,
    `const API_TIMEOUT = 10000;`,
    ``,
    `function substituteVars(template, values) {`,
    `  return String(template).replace(/\\$\\{([A-Za-z_][A-Za-z0-9_]*)\\}/g, (_, name) => values[name] ?? '');`,
    `}`,
    ``,
    `function readPath(data, path) {`,
    `  const trimmed = String(path || '').trim();`,
    `  if (!trimmed) return { found: false, value: undefined };`,
    `  let current = data;`,
    `  for (const segment of trimmed.split('.')) {`,
    `    if (current === null || current === undefined) return { found: false, value: undefined };`,
    `    if (Array.isArray(current)) {`,
    `      const index = Number(segment);`,
    `      if (!Number.isInteger(index) || index < 0 || index >= current.length) {`,
    `        return { found: false, value: undefined };`,
    `      }`,
    `      current = current[index];`,
    `      continue;`,
    `    }`,
    `    if (typeof current !== 'object') return { found: false, value: undefined };`,
    `    current = current[segment];`,
    `  }`,
    `  return { found: current !== undefined, value: current };`,
    `}`,
    ``,
    `function formatApiError(err) {`,
    `  const data = err && err.response && err.response.data;`,
    `  if (typeof data === 'string' && data.trim()) return data.trim();`,
    `  if (data && typeof data === 'object' && typeof data.error === 'string' && data.error.trim()) {`,
    `    return data.error.trim();`,
    `  }`,
    `  if (err && typeof err.message === 'string' && err.message.trim()) return err.message.trim();`,
    `  return 'Unknown error';`,
    `}`,
    ``,
    `function apiKeyTarget(inputs) {`,
    `  const raw = String(API_KEY_SEND_AS || '');`,
    `  const colon = raw.indexOf(':');`,
    `  if (colon <= 0) return null;`,
    `  const kind = raw.slice(0, colon);`,
    `  const name = raw.slice(colon + 1);`,
    `  if (!name) return null;`,
    `  const value = inputs && inputs.API_KEY !== undefined ? String(inputs.API_KEY) : '';`,
    `  if (!value) return null;`,
    `  return { kind, name, value };`,
    `}`,
    ``,
    `async function runApiFetch(inputs) {`,
    `  const withKey = { ...(inputs || {}) };`,
    `  if (withKey.API_KEY === undefined && typeof secrets !== 'undefined' && secrets && secrets.getApiKey) {`,
    `    try { withKey.API_KEY = await secrets.getApiKey(); } catch { withKey.API_KEY = ''; }`,
    `  }`,
    `  let url = substituteVars(API_ENDPOINT, withKey);`,
    `  const keyTarget = apiKeyTarget(withKey);`,
    `  const extra = Object.entries(API_PARAMS).filter(([key, value]) => key.trim() !== '' && value !== '');`,
    `  if (keyTarget && keyTarget.kind === 'query') {`,
    `    extra.push([keyTarget.name, keyTarget.value]);`,
    `  }`,
    `  if (extra.length > 0) {`,
    `    const query = extra`,
    `      .map(([key, value]) => encodeURIComponent(key.trim()) + '=' + encodeURIComponent(substituteVars(value, withKey)))`,
    `      .join('&');`,
    `    url += (url.includes('?') ? '&' : '?') + query;`,
    `  }`,
    `  const headers = {};`,
    `  for (const [key, value] of Object.entries(API_HEADERS)) {`,
    `    if (key.trim() !== '') headers[key.trim()] = substituteVars(value, withKey);`,
    `  }`,
    `  if (keyTarget && keyTarget.kind === 'header') {`,
    `    const name = String(keyTarget.name);`,
    `    const lower = name.toLowerCase();`,
    `    if (lower === 'authorization' && !/^bearer\\s+/i.test(keyTarget.value)) {`,
    `      headers[name] = 'Bearer ' + keyTarget.value;`,
    `    } else {`,
    `      headers[name] = substituteVars(keyTarget.value, withKey);`,
    `    }`,
    `  }`,
    `  if (API_METHOD === 'POST') {`,
    `    const { data, headers: responseHeaders } = await axios.post(url, substituteVars(API_BODY, withKey), {`,
    `      headers: { ...headers, 'Content-Type': 'application/json' },`,
    `      timeout: API_TIMEOUT,`,
    `    });`,
    `    return { data, headers: responseHeaders };`,
    `  }`,
    `  const { data, headers: responseHeaders } = await axios.get(url, { headers, timeout: API_TIMEOUT });`,
    `  return { data, headers: responseHeaders };`,
    `}`,
    ``,
  ].join("\n");
}

function emitMetaBlock(config: NormalizedCodelessConfig): string {
  const options =
    config.api && config.api.inputs.length > 0
      ? `  options: [\n${config.api.inputs
          .map(
            (input) =>
              `    {\n      type: OptionType.string,\n      name: ${js(input.name)},\n      description: ${js(`Value for ${input.name}`)},\n      required: false,\n    },`,
          )
          .join("\n")}\n  ],\n`
      : "";
  return (
    `export const meta: CommandMeta = {\n` +
    `  name: ${js(config.name)},\n` +
    `  author: ${js(CODELESS_AUTHOR)},\n` +
    `  description: ${js(config.description)},\n` +
    `  category: ${js(config.category)},\n` +
    `  usage: ${js(config.usage)},\n` +
    `  cooldown: ${config.cooldown},\n` +
    options +
    `};\n`
  );
}

function emitOnChatMatcher(config: NormalizedCodelessConfig): string[] {
  const onChat = config.onChat;
  if (!onChat) return [];
  const keyword = js(onChat.keyword);
  const mode = onChat.detectionMode;
  const fold = onChat.caseSensitive
    ? `const haystack = text; const needle = ${keyword};`
    : `const haystack = text.toLowerCase(); const needle = ${keyword}.toLowerCase();`;
  let test = "";
  if (mode === "exact") test = `if (haystack !== needle) return false;`;
  else if (mode === "startsWith") test = `if (!haystack.startsWith(needle)) return false;`;
  else if (mode === "regex")
    test = onChat.caseSensitive
      ? `try { if (!new RegExp(${keyword}).test(text)) return false; } catch { return false; }`
      : `try { if (!new RegExp(${keyword}, 'i').test(text)) return false; } catch { return false; }`;
  else test = `if (!haystack.includes(needle)) return false;`;
  return [
    `const ONCHAT_KEYWORD = ${keyword};`,
    `const ONCHAT_MODE = ${js(mode)};`,
    `const ONCHAT_CASE_SENSITIVE = ${onChat.caseSensitive ? "true" : "false"};`,
    ``,
    `export function matchesOnChat(message) {`,
    `  const text = String(message ?? '');`,
    `  if (!text || !ONCHAT_KEYWORD) return false;`,
    `  ${fold}`,
    `  void ONCHAT_MODE; void ONCHAT_CASE_SENSITIVE;`,
    `  ${test}`,
    `  return true;`,
    `}`,
    ``,
  ];
}

/**
 * Compile a config into the full `.ts` module source. Throws on invalid
 * configs (same validation as the create service).
 */
export function compileCommandModule(raw: CodelessCommandConfig): string {
  const config = normalizeCodelessConfig(raw);
  assertValidCodelessConfig(config);
  return compileNormalizedCommandModule(config);
}

export function compileNormalizedCommandModule(
  config: NormalizedCodelessConfig,
): string {
  const hasApi = config.api !== null;
  const hasButton =
    config.button.enabled || config.handlers.includes("onButton");
  const hasReply = config.handlers.includes("onReply");
  const hasChat = config.handlers.includes("onChat");
  const hasCommand = config.handlers.includes("onCommand");
  const hasInputs = hasApi && (config.api as CodelessApiConfig).inputs.length > 0;
  const captionExpr = buildCaptionExpression(config);

  const imports = [
    `import type { AppCtx } from '@/engine/types/controller.types.js';`,
    `import { MessageStyle } from '@/engine/constants/message-style.constants.js';`,
    `import type { CommandMeta } from '@/engine/types/module-meta.types.js';`,
  ];
  if (hasButton) {
    imports.push(
      `import { ButtonStyle } from '@/engine/constants/button-style.constants.js';`,
      `import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';`,
    );
  }
  if (hasApi) {
    imports.push(`import axios from 'axios';`);
  }
  if (hasInputs) {
    imports.push(
      `import { OptionType } from '@/engine/modules/command/command-option.constants.js';`,
    );
  }

  const parts: string[] = [
    `/**`,
    ` * ${config.name} — codeless command (author: ${CODELESS_AUTHOR}).`,
    ` * Generated from the command builder interchange config; runs through`,
    ` * the standard loader + middleware pipeline like hand-written commands.`,
    ` */`,
    ``,
    ...imports,
    ``,
  ];

  if (hasApi) parts.push(emitApiHelpers(config.api as CodelessApiConfig));
  parts.push(emitMetaBlock(config));
  parts.push(...emitOnChatMatcher(config));

  const responseSender = (opts: {
    inOnChat: boolean;
    earlyReturn: boolean;
  }): string[] => {
    const out: string[] = [];
    const media = config.responseMedia;
    if (media === "text") {
      if (hasButton) {
        out.push(`  const sentId = await chat.replyMessage({`);
        out.push(`    style: MessageStyle.MARKDOWN,`);
        out.push(`    message: caption,`);
        out.push(...emitButtonAttach());
        out.push(`  });`);
      } else {
        out.push(
          `  const sentId = await chat.replyMessage({ style: MessageStyle.MARKDOWN, message: caption });`,
        );
      }
    } else {
      const attachName =
        media === "image"
          ? `${config.name}.png`
          : media === "video"
            ? `${config.name}.mp4`
            : media === "audio"
              ? `${config.name}.mp3`
              : `${config.name}.bin`;
      out.push(`  const sentId = await chat.reply({`);
      out.push(`    style: MessageStyle.MARKDOWN,`);
      out.push(`    message: caption,`);
      out.push(
        `    attachment: [{ name: ${js(attachName)}, stream: Buffer.from(caption, 'utf-8') }],`,
      );
      if (hasButton) out.push(...emitButtonAttach());
      out.push(`  });`);
    }
    if (hasReply) {
      out.push(`  if (sentId) {`);
      out.push(
        `    state.create({ id: state.generateID({ id: String(sentId) }), state: STATE.awaiting_reply, context: {} });`,
      );
      out.push(`  }`);
    }
    void opts;
    return out;
  };

  const emitHandlerBody = (inOnChat: boolean): string[] => {
    const body: string[] = [];
    if (hasInputs) {
      body.push(`  const __inputs = {};`);
      (config.api as CodelessApiConfig).inputs.forEach((input, index) => {
        body.push(
          `  __inputs[${js(input.name)}] = options.get(${js(input.name)}) ?? args[${index}] ?? '';`,
        );
      });
    }
    if (hasApi) {
      const api = config.api as CodelessApiConfig;
      body.push(
        `  const inputs = ${hasInputs ? "__inputs" : "{}"};`,
      );
      body.push(`  let caption = ${captionExpr};`);
      body.push(`  try {`);
      body.push(
        `    const { data, headers: responseHeaders } = await runApiFetch(inputs);`,
      );
      if (api.responseType === "JSON") {
        body.push(`    const { found, value } = readPath(data, API_RESPONSE_PATH);`);
        body.push(
          `    const result = found ? (typeof value === 'string' ? value : JSON.stringify(value)) : '(empty response)';`,
        );
        body.push(
          `    caption = caption.includes('\${result}') ? caption.split('\${result}').join(result) : caption + '\\n\\n' + result;`,
        );
        body.push(...responseSender({ inOnChat, earlyReturn: false }));
      } else if (api.responseType === "Text") {
        body.push(
          `    const result = typeof data === 'string' ? data : JSON.stringify(data);`,
        );
        body.push(
          `    caption = caption.includes('\${result}') ? caption.split('\${result}').join(result) : caption + '\\n\\n' + result;`,
        );
        body.push(...responseSender({ inOnChat, earlyReturn: false }));
      } else if (api.responseType === "Image URL") {
        body.push(`    const { found, value } = readPath(data, API_RESPONSE_PATH);`);
        body.push(
          `    const imageUrl = found && typeof value === 'string' ? value : (typeof data === 'string' ? data : '');`,
        );
        body.push(`    if (!imageUrl) {`);
        body.push(
          `      await chat.replyMessage({ style: MessageStyle.MARKDOWN, message: caption + '\\n\\n(empty response)' });`,
        );
        body.push(`      return;`);
        body.push(`    }`);
        body.push(
          `    const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: API_TIMEOUT });`,
        );
        body.push(
          `    const imageName = String(imageUrl.split('?')[0].split('/').pop() || '${config.name}.png');`,
        );
        body.push(`    const sentId = await chat.reply({`);
        body.push(`      style: MessageStyle.MARKDOWN,`);
        body.push(`      message: caption,`);
        body.push(
          `      attachment: [{ name: imageName, stream: Buffer.from(imageResponse.data) }],`,
        );
        if (hasButton) body.push(...emitButtonAttach());
        body.push(`    });`);
        if (hasReply) {
          body.push(`    if (sentId) {`);
          body.push(
            `      state.create({ id: state.generateID({ id: String(sentId) }), state: STATE.awaiting_reply, context: {} });`,
          );
          body.push(`    }`);
        }
        body.push(`    return;`);
      } else {
        body.push(`    const { found, value } = readPath(data, API_RESPONSE_PATH);`);
        body.push(
          `    const payload = found && value !== undefined ? (typeof value === 'string' ? value : JSON.stringify(value)) : (typeof data === 'string' ? data : JSON.stringify(data));`,
        );
        body.push(`    const sentId = await chat.reply({`);
        body.push(`      style: MessageStyle.MARKDOWN,`);
        body.push(`      message: caption,`);
        body.push(
          `      attachment: [{ name: '${config.name}.bin', stream: Buffer.from(String(payload), 'utf-8') }],`,
        );
        if (hasButton) body.push(...emitButtonAttach());
        body.push(`    });`);
        if (hasReply) {
          body.push(`    if (sentId) {`);
          body.push(
            `      state.create({ id: state.generateID({ id: String(sentId) }), state: STATE.awaiting_reply, context: {} });`,
          );
          body.push(`    }`);
        }
        body.push(`    return;`);
      }
      body.push(`  } catch (err) {`);
      body.push(
        `    await chat.replyMessage({ style: MessageStyle.MARKDOWN, message: '⚠️ **Error:** ' + formatApiError(err) });`,
      );
      body.push(`    return;`);
      body.push(`  }`);
    } else {
      body.push(`  const caption = ${captionExpr};`);
      body.push(...responseSender({ inOnChat, earlyReturn: false }));
    }
    return body;
  };

  // ── onCommand ──────────────────────────────────────────────────────
  if (hasCommand) {
    parts.push(
      `export const onCommand = async ({ args, chat, event, native, button: btn, state, options }: AppCtx) => {`,
      ...emitHandlerBody(false),
      `};`,
      ``,
    );
  }

  // ── onChat ─────────────────────────────────────────────────────────
  if (hasChat) {
    parts.push(
      `export const onChat = async ({ args, chat, event, native, button: btn, state, options }: AppCtx) => {`,
      `  if (!matchesOnChat(String(event['message'] ?? ''))) return;`,
      ...emitHandlerBody(true),
      `};`,
      ``,
    );
  }

  // ── button map ─────────────────────────────────────────────────────
  if (hasButton) {
    parts.push(
      `const BUTTON_ID = { action: 'action' };`,
      ``,
      `export const button = {`,
      `  [BUTTON_ID.action]: {`,
      `    label: ${js(config.button.label)},`,
      `    style: ButtonStyle.SECONDARY,`,
      `    onClick: async ({ chat, event }: AppCtx) => {`,
      `      await chat.editMessage({`,
      `        style: MessageStyle.MARKDOWN,`,
      `        message_id_to_edit: event['messageID'],`,
      `        message: ${captionExpr} + ' (refreshed)',`,
      `      });`,
      `    },`,
      `  },`,
      `};`,
      ``,
    );
  }

  // ── onReply (single step) ──────────────────────────────────────────
  if (hasReply) {
    parts.push(
      `const STATE = { awaiting_reply: 'awaiting_reply' };`,
      ``,
      `export const onReply = {`,
      `  [STATE.awaiting_reply]: async ({ chat, session, event, state }: AppCtx) => {`,
      `    const text = String(event['message'] ?? '');`,
      `    state.delete(session.id);`,
      `    await chat.replyMessage({ style: MessageStyle.MARKDOWN, message: '✅ Noted: ' + text });`,
      `  },`,
      `};`,
      ``,
    );
  }

  return `${parts.join("\n")}\n`;
}

function emitButtonAttach(): string[] {
  return [
    `    ...(hasNativeButtons(native.platform) ? { button: [btn.generateID({ id: BUTTON_ID.action, public: true })] } : {}),`,
  ];
}
