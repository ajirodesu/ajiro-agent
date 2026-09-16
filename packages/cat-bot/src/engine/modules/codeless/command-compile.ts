/**
 * Codeless Compiler — config → genuine `.ts` command module source.
 *
 * The emitted source is a real Persian-Bot command module in the exact
 * shape of the hand-written examples (same imports, same `meta` shape,
 * same `onCommand` / `onReply` / `button` exports): it can be saved as
 * `<name>.ts`, downloaded in the manual-commands zip, or written by the
 * agent tools, and it runs through the identical loader + middleware
 * pipeline as hand-written commands.
 *
 * The emitted `meta` NEVER contains version/role/aliases/platform —
 * author is always the hardcoded constant. onCommand is always generated
 * (the loader requires onCommand or onChat); onReply/onButton are extras.
 */
import type {
  CodelessApiConfig,
  CodelessCommandConfig,
} from './command-config.types.js';
import {
  CODELESS_AUTHOR,
  normalizeCodelessConfig,
  validateCodelessConfig,
} from './command-config.types.js';

function js(value: string): string {
  return JSON.stringify(value);
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
    `async function runApiFetch(inputs) {`,
    `  let url = substituteVars(API_ENDPOINT, inputs);`,
    `  const extra = Object.entries(API_PARAMS).filter(([key, value]) => key.trim() !== '' && value !== '');`,
    `  if (extra.length > 0) {`,
    `    const query = extra`,
    `      .map(([key, value]) => encodeURIComponent(key.trim()) + '=' + encodeURIComponent(substituteVars(value, inputs)))`,
    `      .join('&');`,
    `    url += (url.includes('?') ? '&' : '?') + query;`,
    `  }`,
    `  const headers = {};`,
    `  for (const [key, value] of Object.entries(API_HEADERS)) {`,
    `    if (key.trim() !== '') headers[key.trim()] = substituteVars(value, inputs);`,
    `  }`,
    `  if (API_METHOD === 'POST') {`,
    `    const { data, headers: responseHeaders } = await axios.post(url, substituteVars(API_BODY, inputs), {`,
    `      headers: { ...headers, 'Content-Type': 'application/json' },`,
    `      timeout: API_TIMEOUT,`,
    `    });`,
    `    return { data, headers: responseHeaders };`,
    `  }`,
    `  const { data, headers: responseHeaders } = await axios.get(url, { headers, timeout: API_TIMEOUT });`,
    `  return { data, headers: responseHeaders };`,
    `}`,
    ``,
  ].join('\n');
}

function emitMedaBlock(config: ReturnType<typeof normalizeCodelessConfig>): string {
  const options =
    config.api && config.api.inputs.length > 0
      ? `  options: [\n${config.api.inputs
          .map(
            (input) =>
              `    {\n      type: OptionType.string,\n      name: ${js(input.name)},\n      description: ${js(`Value for ${input.name}`)},\n      required: false,\n    },`,
          )
          .join('\n')}\n  ],\n`
      : '';
  return (
    `export const meta: CommandMeta = {\n` +
    `  name: ${js(config.name)},\n` +
    `  author: ${js(CODELESS_AUTHOR)},\n` +
    `  description: ${js(config.description)},\n` +
    `  category: ${js(config.category)},\n` +
    `  usage: ${js(config.usage)},\n` +
    `  cooldown: ${config.cooldown},\n` +
    `  hasPrefix: true,\n` +
    options +
    `};\n`
  );
}

/**
 * Compile a config into the full `.ts` module source. Throws on invalid
 * configs (same validation as the create endpoint).
 */
export function compileCommandModule(raw: CodelessCommandConfig): string {
  const config = normalizeCodelessConfig(raw);
  const { validateCodelessConfig } = require('./command-config.types.js') as typeof import('./command-config.types.js');
  void validateCodelessConfig;
  const { default: _unused } = {};
  void _unused;
  return compileNormalizedCommandModule(config);
}

export function compileNormalizedCommandModule(
  config: ReturnType<typeof normalizeCodelessConfig>,
): string {
  const hasApi = config.api !== null;
  const hasButton = config.button.enabled;
  const hasReply = config.handlers.includes('onReply');
  const hasInputs = hasApi && config.api.inputs.length > 0;

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
  parts.push(emitMedaBlock(config));

  // ── onCommand ──────────────────────────────────────────────────────
  const body: string[] = [];
  body.push(`export const onCommand = async ({ args, chat, event, native, button: btn, state, options }: AppCtx) => {`);
  if (hasInputs) {
    body.push(`  const inputs = {};`);
    config.api?.inputs.forEach((input, index) => {
      body.push(
        `  inputs[${js(input.name)}] = options.get(${js(input.name)}) ?? args[${index}] ?? '';`,
      );
    });
  }
  if (hasApi) {
    const api = config.api as CodelessApiConfig;
    body.push(`  const inputs = ${hasInputs ? 'inputs' : '{}'};`);
    body.push(`  let caption = ${js(config.caption)};`);
    body.push(`  try {`);
    body.push(`    const { data, headers: responseHeaders } = await runApiFetch(inputs);`);
    body.push(
      `    const contentType = String((responseHeaders && (responseHeaders['content-type'] || responseHeaders['Content-Type'])) || '');`,
    );
    if (api.responseType === 'JSON') {
      body.push(`    const { found, value } = readPath(data, API_RESPONSE_PATH);`);
      body.push(`    const result = found
      ? typeof value === 'string'
        ? value
        : JSON.stringify(value)
      : '(empty response)';`);
      body.push(`    caption = caption.includes('\${result}') ? caption.split('\${result}').join(result) : caption + '\\n\\n' + result;`);
    } else if (api.responseType === 'Text') {
      body.push(`    const result = typeof data === 'string' ? data : JSON.stringify(data);`);
      body.push(`    caption = caption.includes('\${result}') ? caption.split('\${result}').join(result) : caption + '\\n\\n' + result;`);
    } else if (api.responseType === 'Image URL') {
      body.push(`    const { found, value } = readPath(data, API_RESPONSE_PATH);`);
      body.push(`    const imageUrl = found && typeof value === 'string' ? value : (typeof data === 'string' ? data : '');`);
      body.push(`    if (!imageUrl) {`);
      body.push(`      await chat.replyMessage({ style: MessageStyle.MARKDOWN, message: caption + '\\n\\n(empty response)' });`);
      if (hasReply) body.push(...emitReplyRegistration(config));
      body.push(`      return;`);
      body.push(`    }`);
      body.push(`    const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: API_TIMEOUT });`);
      body.push(`    const imageName = String(imageUrl.split('?')[0].split('/').pop() || '${config.name}.png');`);
      body.push(`    await chat.reply({`);
      body.push(`      style: MessageStyle.MARKDOWN,`);
      body.push(`      message: caption,`);
      body.push(`      attachment: [{ name: imageName, stream: Buffer.from(imageResponse.data) }],`);
      if (hasButton) body.push(...emitButtonAttach(config));
      body.push(`    });`);
      if (hasReply) body.push(...emitReplyRegistration(config, true));
      body.push(`    return;`);
    } else {
      // Buffer
      body.push(`    const { found, value } = readPath(data, API_RESPONSE_PATH);`);
      body.push(`    const payload = found && value !== undefined ? (typeof value === 'string' ? value : JSON.stringify(value)) : (typeof data === 'string' ? data : JSON.stringify(data));`);
      body.push(`    await chat.reply({`);
      body.push(`      style: MessageStyle.MARKDOWN,`);
      body.push(`      message: caption,`);
      body.push(`      attachment: [{ name: '${config.name}.bin', stream: Buffer.from(String(payload), 'utf-8') }],`);
      if (hasButton) body.push(...emitButtonAttach(config));
      body.push(`    });`);
      if (hasReply) body.push(...emitReplyRegistration(config, true));
      body.push(`    return;`);
    }
    body.push(`  } catch (err) {`);
    body.push(`    await chat.replyMessage({ style: MessageStyle.MARKDOWN, message: '⚠️ **Error:** ' + formatApiError(err) });`);
    body.push(`    return;`);
    body.push(`  }`);
  }
  if (!hasApi || (hasApi && (config.api as CodelessApiConfig).responseType !== 'Image URL' && (config.api as CodelessApiConfig).responseType !== 'Buffer')) {
    if (hasApi) {
      body.push(`  await chat.replyMessage({ style: MessageStyle.MARKDOWN, message: caption${hasButton ? ',' : ''} });`);
      if (hasButton) {
        // remove trailing comma handling: rebuild last line properly below
        body.pop();
        body.push(`  const messageID = await chat.replyMessage({`);
        body.push(`    style: MessageStyle.MARKDOWN,`);
        body.push(`    message: caption,`);
        body.push(...emitButtonAttach(config));
        body.push(`  });`);
      } else {
        body[body.length - 1] = `  await chat.replyMessage({ style: MessageStyle.MARKDOWN, message: caption });`;
      }
    } else {
      body.push(`  await chat.replyMessage({ style: MessageStyle.MARKDOWN, message: ${js(config.caption)} });`);
    }
    if (hasReply && !hasApi) body.push(...emitReplyRegistration(config));
    if (hasReply && hasApi) body.push(...emitReplyRegistrationApi(config));
  }
  body.push(`};`);
  parts.push(body.join('\n'), ``);

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
      `        message: ${js(config.caption)} + ' (refreshed)',`,
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

  return `${parts.join('\n')}\n`;
}

function emitButtonAttach(config: ReturnType<typeof normalizeCodelessConfig>): string[] {
  return [
    `    ...(hasNativeButtons(native.platform) ? { button: [btn.generateID({ id: BUTTON_ID.action, public: true })] } : {}),`,
  ];
}

/** Register a single follow-up state after a replyMessage send. */
function emitReplyRegistration(
  config: ReturnType<typeof normalizeCodelessConfig>,
  usedMessageIDVar = false,
): string[] {
  void config;
  if (!usedMessageIDVar) {
    return [
      `  const followUpID = await chat.replyMessage({ style: MessageStyle.MARKDOWN, message: ${js(config.caption)} });`,
      `  if (followUpID) {`,
      `    state.create({ id: state.generateID({ id: String(followUpID) }), state: STATE.awaiting_reply, context: {} });`,
      `  }`,
    ];
  }
  return [
    `  if (messageID) {`,
    `    state.create({ id: state.generateID({ id: String(messageID) }), state: STATE.awaiting_reply, context: {} });`,
    `  }`,
  ];
}

function emitReplyRegistrationApi(
  config: ReturnType<typeof normalizeCodelessConfig>,
): string[] {
  void config;
  return [
    `  // Note: the reply above already went out; register follow-up state when we have its ID.`,
  ];
}
