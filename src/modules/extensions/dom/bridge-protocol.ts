/**
 * Plugin DOM bridge protocol (prompt §48/§49).
 *
 * Acode executes plugin entry scripts inside the app's webview document, so
 * plugins get a real `window`, `document`, `HTMLElement`, `CustomEvent`,
 * `fetch`, `location`, and `URL`. Ajiro reproduces that by running plugin
 * code inside one controlled `react-native-webview` document ("the plugin
 * host document") whose contents are never exposed to the native app: plugin
 * DOM work stays inside the webview, and everything that must affect Ajiro
 * (files, settings, commands, notifications, installing another plugin) is a
 * typed, permission-checked message on this protocol.
 *
 * The split in this file is deliberate: the message vocabulary and the pure
 * session bookkeeping are plain TypeScript so they can be unit-tested on
 * node, while the webview-side script (`dom-runtime-script.ts`) and the
 * React Native surface (`components/extensions/plugin-host-surface.tsx`)
 * stay thin.
 */
import { isRecord } from "../models";

/** Message sent from the webview into React Native. */
export type PluginBridgeOutbound =
  | { type: "ready" }
  | { type: "error"; message: string; pluginId: string | null; phase: PluginErrorPhase }
  | { type: "console"; level: "error" | "log" | "warn"; pluginId: string | null; text: string }
  | { type: "registered"; pluginId: string }
  | { type: "defined"; hasInit: boolean; pluginId: string }
  | { type: "activated"; pluginId: string }
  | { type: "unmounted"; pluginId: string }
  | { type: "page"; action: "hidden" | "shown" | "removed"; pluginId: string; title: string }
  /** Acode Editor Themes API: the portable `config` color map crosses the
   * bridge (live CodeMirror extension objects cannot be serialized). */
  | {
      type: "editor-theme-register";
      pluginId: string;
      id: string;
      caption: string;
      dark: boolean;
      config: Record<string, string>;
    }
  | { type: "editor-theme-unregister"; pluginId: string; id: string }
  | { type: "editor-theme-apply"; pluginId: string; id: string }
  | { type: "command-register"; command: PluginCommandRegistration; pluginId: string }
  | { type: "command-remove"; name: string; pluginId: string }
  | { type: "settings-set"; key: string; pluginId: string; value: unknown }
  | { type: "storage-get"; key: string; pluginId: string; requestId: number }
  | { type: "storage-remove"; key: string; pluginId: string }
  | { type: "storage-set"; key: string; pluginId: string; value: unknown }
  | { type: "fs-list"; path: string; pluginId: string; requestId: number }
  | { type: "fs-read"; path: string; pluginId: string; requestId: number }
  | { type: "fs-write"; path: string; pluginId: string; requestId: number; text: string }
  /**
   * Scoped editor access (§39). A plugin can read the active document and
   * replace its text; it cannot reach the editor instance, the project, or
   * any other file. Both directions are permission-gated on `editor`.
   */
  | { type: "editor-read"; pluginId: string; requestId: number }
  | { type: "editor-write"; pluginId: string; requestId: number; text: string }
  | { type: "install-plugin"; pluginId: string; requestId: number; targetId: string }
  | {
      type: "exec-request";
      name: string;
      pluginId: string | null;
      value?: unknown;
    }
  | { type: "notify"; level: "error" | "info" | "success" | "warning"; pluginId: string; text: string }
  /**
   * Formatter registration (verified against Acode's acode.js): the format
   * function itself stays inside the document — only its metadata crosses.
   */
  | {
      type: "formatter-register";
      displayName: string;
      extensions: string[];
      formatterId: string;
      pluginId: string;
    }
  | { type: "formatter-unregister"; formatterId: string; pluginId: string }
  /** `acode.format()` entry: the host resolves the selection + document. */
  | { type: "format-request"; pluginId: string; requestId: number }
  /** The document ran the selected formatter; the host applies the text. */
  | { type: "format-apply"; pluginId: string; requestId: number; text: string }
  /**
   * Native dialogs (verified against Acode's `src/dialogs/*` + `acode.js`):
   * the document collects arguments and normalizes option shapes, the app
   * renders. Every kind is permission-gated on `ui` host-side. `alert`
   * resolves when dismissed; `confirm` resolves a boolean; `prompt` resolves
   * the value (number-coerced for `type: "number"`) or null on cancel;
   * `select` resolves the chosen value, stays pending on cancel unless
   * `rejectOnCancel` was set (mirroring Acode), and `multi-prompt` resolves
   * the values map or rejects on cancel (mirroring Acode).
   */
  | {
      type: "dialog";
      kind: PluginDialogKind;
      payload: PluginDialogPayload;
      pluginId: string;
      requestId: number;
    }
  /**
   * Loader handles are stateful: create returns an id, later ops mutate it.
   * Mirrors Acode's singleton behavior — creating a loader replaces the
   * active one app-side. Ops for unknown ids are ignored, never errors.
   */
  | {
      type: "dialog-loader-create";
      message: string;
      options: { timeoutMs?: number };
      pluginId: string;
      requestId: number;
      title: string;
    }
  | {
      type: "dialog-loader-op";
      loaderId: string;
      op: "destroy" | "hide" | "setMessage" | "setTitle" | "show";
      pluginId: string;
      value?: string;
    }
  /** Fire-and-forget transient message (`acode.require("toast")`). */
  | { type: "toast"; durationMs?: number; pluginId: string; text: string }
  /** User-mediated file picking (`acode.fileBrowser`): safe by construction. */
  | { type: "file-browser"; mode: string; pluginId: string; requestId: number }
  /**
   * `acode.newEditorFile(filename, options?)`: creates the file in the
   * active project with the app's own file service and emits FILE_CREATED,
   * exactly like a manually created file. Responds with the created path.
   */
  | {
      type: "editor-new-file";
      filename: string;
      pluginId: string;
      requestId: number;
      text: string;
    };

export type PluginErrorPhase = "activate" | "execute" | "load" | "unmount";

/** Message sent from React Native into the webview. */
export type PluginBridgeInbound =
  | {
      type: "define-plugin";
      /** Files the plugin may read, keyed by package-relative path. */
      files?: string[];
      grantedPermissions: string[];
      pluginId: string;
      settings: Record<string, unknown>;
      source: string;
      storage: Record<string, unknown>;
    }
  | { type: "activate-plugin"; baseUrl: string; firstInit: boolean; pluginId: string }
  | { type: "unmount-plugin"; pluginId: string }
  | { type: "hide-page" }
  /** Show a plugin's last custom page (tab switch); no-op when it has none. */
  | { type: "show-page"; pluginId: string }
  /** Host → document mirror of the editor-theme registry (sync API). */
  | {
      type: "editor-themes-sync";
      themes: {
        id: string;
        caption: string;
        dark: boolean;
        pluginId: string;
        config: Record<string, string>;
      }[];
    }
  | { type: "response"; ok: boolean; requestId: number; result?: unknown; error?: string }
  | { type: "exec-command"; name: string; value?: unknown }
  | { type: "host-notice"; level: "error" | "info" | "success" | "warning"; text: string };

export type PluginCommandRegistration = {
  bindKey?: Record<string, string> | undefined;
  description?: string | undefined;
  exec?: unknown;
  name: string;
};

export type PluginDialogKind =
  | "alert"
  | "confirm"
  | "prompt"
  | "select"
  | "multi-prompt";

/** A select option after document-side normalization (Acode accepts strings, arrays, and objects). */
export type PluginSelectOption = {
  disabled?: boolean;
  subText?: string;
  text: string;
  value: string;
};

/** One multi-prompt field after normalization. Function-valued Acode options (`match`, `onclick`, `onchange`, `test`) cannot cross the bridge and are dropped. */
export type PluginMultiPromptInput = {
  defaultValue?: string;
  disabled?: boolean;
  hidden?: boolean;
  id: string;
  label?: string;
  matchSource?: string;
  placeholder?: string;
  required?: boolean;
  type?: string;
};

export type PluginDialogPayload =
  | { message: string; title: string }
  | { message: string; title: string }
  | {
      defaultValue: string;
      matchSource?: string;
      message: string;
      placeholder?: string;
      required?: boolean;
      type: string;
    }
  | { defaultValue?: string; options: PluginSelectOption[]; rejectOnCancel: boolean; title: string }
  | { help?: string; inputs: PluginMultiPromptInput[]; title: string };

/** Error name the app uses when the user cancels a select/multi-prompt. */
export const PLUGIN_DIALOG_CANCELLED = "DialogCancelled";

export const MAX_DIALOG_TEXT_LENGTH = 2000;
export const MAX_DIALOG_OPTIONS = 50;
export const MAX_DIALOG_INPUTS = 12;
export const MAX_NEW_FILE_NAME_LENGTH = 120;
export const MAX_TOAST_LENGTH = 300;

/** Cap dialog prose so a plugin cannot flood the app with megabytes of text. */
export function normalizeDialogText(value: unknown, max = MAX_DIALOG_TEXT_LENGTH): string {
  const text = typeof value === "string" ? value : String(value ?? "");
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Acode prompt types are HTML input types; anything else becomes text. */
export function normalizePromptType(value: unknown): string {
  const type = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (type === "textarea" || type === "number") return type;
  if (
    type === "text" ||
    type === "password" ||
    type === "tel" ||
    type === "email" ||
    type === "url" ||
    type === "search"
  ) {
    return type;
  }
  return "text";
}

/**
 * Normalize one Acode select item. Acode accepts a bare string, an object,
 * or a positional array [value, text, icon?, disabled-flag?, ...] where a
 * boolean past index 1 means "enabled" (so disabled is its negation).
 */
export function normalizeSelectOption(item: unknown): PluginSelectOption | null {
  if (typeof item === "string") {
    const text = item.trim();
    if (!text) return null;
    return { text, value: item };
  }
  if (Array.isArray(item)) {
    const [value, text, ...rest] = item;
    if (typeof value !== "string" || !value) return null;
    const disabledFlag = rest.find((entry) => typeof entry === "boolean");
    return {
      disabled: typeof disabledFlag === "boolean" ? !disabledFlag : false,
      text: typeof text === "string" && text ? text : value,
      value,
    };
  }
  if (isRecord(item)) {
    const value = item.value;
    if (typeof value !== "string" || !value) return null;
    const text = item.text;
    const subText = item.subText ?? item.subtext;
    const option: PluginSelectOption = {
      text: typeof text === "string" && text ? text : value,
      value,
    };
    if (typeof subText === "string" && subText) option.subText = subText;
    if (item.disabled === true) option.disabled = true;
    return option;
  }
  return null;
}

export function normalizeSelectOptions(input: unknown): PluginSelectOption[] {
  if (!Array.isArray(input)) {
    return typeof input === "string" && input.trim()
      ? [{ text: input, value: input }]
      : [];
  }
  const options: PluginSelectOption[] = [];
  for (const item of input) {
    if (options.length >= MAX_DIALOG_OPTIONS) break;
    const option = normalizeSelectOption(item);
    if (option) options.push(option);
  }
  return options;
}

/** Flatten Acode multi-prompt input groups; strings are group labels and are dropped. */
export function normalizeMultiPromptInputs(input: unknown): PluginMultiPromptInput[] {
  const raw: unknown[] = Array.isArray(input) ? input.flat() : [];
  const inputs: PluginMultiPromptInput[] = [];
  for (const entry of raw) {
    if (inputs.length >= MAX_DIALOG_INPUTS) break;
    if (!isRecord(entry) || typeof entry.id !== "string" || !entry.id) continue;
    const normalized: PluginMultiPromptInput = { id: entry.id };
    if (typeof entry.name === "string" && entry.name) normalized.label = entry.name;
    else if (typeof entry.placeholder === "string" && entry.placeholder) {
      normalized.label = entry.placeholder;
    }
    if (typeof entry.placeholder === "string") normalized.placeholder = entry.placeholder;
    if (typeof entry.value !== "undefined" && entry.value !== null) {
      normalized.defaultValue = String(entry.value);
    }
    if (entry.required === true) normalized.required = true;
    if (entry.disabled === true) normalized.disabled = true;
    if (entry.hidden === true) normalized.hidden = true;
    if (typeof entry.type === "string" && entry.type) {
      normalized.type = normalizePromptType(entry.type);
    }
    inputs.push(normalized);
  }
  return inputs;
}

/**
 * New file names are flat (no directories), like the app's own create-file
 * flow: slashes become dashes, control characters are stripped.
 */
export function normalizeNewFileName(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const name = input
    .replace(/[/\\]+/g, "-")
    .replace(/[\0-\x1f\x7f]/g, "")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, MAX_NEW_FILE_NAME_LENGTH);
  return name ? name : null;
}

export function parsePluginBridgeOutbound(raw: string): PluginBridgeOutbound | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || typeof parsed.type !== "string") return null;
  return parsed as PluginBridgeOutbound;
}

/** `window.ReactNativeWebView.postMessage` payload for an inbound message. */
export function serializePluginBridgeInbound(message: PluginBridgeInbound): string {
  // `<` is escaped so plugin source and page titles can never close the
  // enclosing <script> block or break out of the injected call.
  return JSON.stringify(message).replace(/</g, "\\u003c");
}

/**
 * A plugin page the user can actually see (Acode's WCPage). The page's DOM
 * lives inside the webview; the native side only learns *that* a page is
 * showing and its title, and decides where to put the surface.
 */
export type PluginPageState = { pluginId: string; title: string } | null;

export function pageStateFromMessage(
  message: PluginBridgeOutbound,
): PluginPageState | undefined {
  if (message.type !== "page") return undefined;
  return message.action === "shown"
    ? { pluginId: message.pluginId, title: message.title }
    : null;
}

export type PluginSessionState = {
  /** Plugin ids whose entry script has been injected and registered. */
  defined: Set<string>;
  /** Plugin ids whose init callback completed successfully. */
  activated: Set<string>;
};

export function createSessionState(): PluginSessionState {
  return { activated: new Set(), defined: new Set() };
}

/** Console noise is capped so a chatty plugin cannot exhaust memory. */
export const MAX_CONSOLE_LINES_PER_PLUGIN = 200;
export const MAX_PAGE_TITLE_LENGTH = 120;

export function normalizeConsoleText(text: unknown): string {
  const value = typeof text === "string" ? text : String(text ?? "");
  return value.length > 500 ? `${value.slice(0, 500)}…` : value;
}

export function normalizePageTitle(title: unknown): string {
  const value = typeof title === "string" ? title.trim() : "";
  if (!value) return "Plugin";
  return value.length > MAX_PAGE_TITLE_LENGTH
    ? `${value.slice(0, MAX_PAGE_TITLE_LENGTH)}…`
    : value;
}

/**
 * Package-relative path validation for bridge file operations: the webview
 * may only ever ask for files inside the plugin's own package, and never for
 * its private data directories.
 */
export function isSafePluginPath(path: string): boolean {
  if (!path || typeof path !== "string") return false;
  if (path.includes("\\") || path.includes("\0")) return false;
  if (path.startsWith("/")) return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(path)) return false;
  return !path.split("/").includes("..");
}
