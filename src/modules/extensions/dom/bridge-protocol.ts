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
  | { type: "page"; action: "hidden" | "shown"; pluginId: string; title: string }
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
  | { type: "notify"; level: "error" | "info" | "success" | "warning"; pluginId: string; text: string };

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
  | { type: "response"; ok: boolean; requestId: number; result?: unknown; error?: string }
  | { type: "exec-command"; name: string; value?: unknown }
  | { type: "host-notice"; level: "error" | "info" | "success" | "warning"; text: string };

export type PluginCommandRegistration = {
  bindKey?: Record<string, string> | undefined;
  description?: string | undefined;
  exec?: unknown;
  name: string;
};

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
