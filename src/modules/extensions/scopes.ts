/**
 * Plugin scope model for the split stores.
 *
 * The registry carries no category taxonomy (real entries expose only
 * id/name/keywords/description), so scopes derive from established
 * signals: Acode's own theme-identifier rule plus keyword/name matching.
 * A plugin may belong to several scopes; unknown plugins are "other"
 * (surfaced through the "All" escape hatch, never hidden).
 *
 * Store sets: sidebar ("studio") shows themes + terminal; the file
 * manager header store ("workshop") shows editor + language +
 * file-manager. Paid entries are excluded from both stores.
 */
import { isThemePluginId } from "./runtime";
import type { ExtensionMetadata } from "./models";

export type PluginScope =
  | "theme"
  | "terminal"
  | "editor"
  | "language"
  | "filemanager"
  | "webview"
  | "snippets"
  | "other";

export type PluginStoreScope = "studio" | "workshop" | "all";

export const STUDIO_PLUGIN_SCOPES: readonly PluginScope[] = [
  "theme",
  "terminal",
];
export const WORKSHOP_PLUGIN_SCOPES: readonly PluginScope[] = [
  "editor",
  "language",
  "filemanager",
];

export function scopesForStore(scope: PluginStoreScope): PluginScope[] | null {
  if (scope === "studio") return [...STUDIO_PLUGIN_SCOPES];
  if (scope === "workshop") return [...WORKSHOP_PLUGIN_SCOPES];
  return null;
}

/** Paid plugins are excluded from both stores — free only. */
export function isFreeEntry(entry: Pick<ExtensionMetadata, "price">): boolean {
  const price =
    typeof entry.price === "number" ? entry.price : Number(entry.price);
  return !(price > 0);
}

const LANGUAGE_NAMES = [
  "python",
  "javascript",
  "typescript",
  "java",
  "kotlin",
  "go",
  "golang",
  "rust",
  "c",
  "cpp",
  "c++",
  "csharp",
  "c#",
  "php",
  "ruby",
  "swift",
  "dart",
  "lua",
  "r",
  "sql",
  "html",
  "css",
  "json",
  "xml",
  "yaml",
  "yml",
  "shell",
  "bash",
  "powershell",
  "perl",
  "haskell",
  "scala",
  "elixir",
  "clojure",
  "vim",
  "markdown",
  "latex",
  "toml",
  "ini",
  "dockerfile",
];

function signalText(entry: ExtensionMetadata): string {
  return [
    entry.id,
    entry.name,
    entry.category ?? "",
    entry.keywords.join(" "),
    entry.description ?? "",
  ]
    .join("\n")
    .toLowerCase();
}

function hasWord(haystack: string, word: string): boolean {
  // Hyphens stay inside tokens so compounds like "file-manager" match.
  return haystack
    .split(/[^a-z0-9#+.-]+/)
    .some((token) => token === word);
}

function hasAnyWord(haystack: string, words: string[]): boolean {
  return words.some((word) => hasWord(haystack, word));
}

/**
 * Every scope the entry belongs to, in a stable order. Never empty:
 * unmatched entries report ["other"].
 */
export function pluginScopes(entry: ExtensionMetadata): PluginScope[] {
  const id = entry.id.toLowerCase();
  const text = signalText(entry);
  const scopes: PluginScope[] = [];

  if (
    isThemePluginId(entry.id) ||
    hasAnyWord(text, ["theme", "themes", "skin", "skins", "colorscheme"])
  ) {
    scopes.push("theme");
  }
  if (hasAnyWord(text, ["terminal", "terminals", "console", "pty", "shell"])) {
    scopes.push("terminal");
  }
  if (
    entry.category?.toLowerCase() === "languages" ||
    hasAnyWord(text, [
      "language",
      "languages",
      "syntax",
      "highlight",
      "highlighting",
      "grammar",
      "lsp",
      "lint",
      "linting",
      "intellisense",
      ...LANGUAGE_NAMES,
    ])
  ) {
    scopes.push("language");
  }
  if (
    hasAnyWord(text, [
      "editor",
      "editing",
      "emmet",
      "autocomplete",
      "format",
      "formatter",
      "beautify",
      "minify",
      "peek",
      "minimap",
      "fold",
      "folding",
      "bracket",
      "indent",
      "comment",
      "multicursor",
      "keymap",
      "keybind",
      "snippets-ui",
    ])
  ) {
    scopes.push("editor");
  }
  if (
    hasAnyWord(text, [
      "filemanager",
      "file-manager",
      "explorer",
      "ftp",
      "sftp",
      "dropbox",
      "transfer",
      "remote",
    ])
  ) {
    scopes.push("filemanager");
  }
  if (id.includes("github") || hasWord(text, "git")) {
    if (!scopes.includes("filemanager")) {
      scopes.push("filemanager");
    }
  }
  if (
    hasAnyWord(text, ["preview", "webview", "browser", "server", "serve"])
  ) {
    scopes.push("webview");
  }
  if (hasAnyWord(text, ["snippet", "snippets"])) {
    scopes.push("snippets");
  }
  if (scopes.length === 0) {
    scopes.push("other");
  }
  return scopes;
}

/** True when the entry may appear in the given store scope. */
export function entryInStoreScope(
  entry: ExtensionMetadata,
  scope: PluginStoreScope,
): boolean {
  const allowed = scopesForStore(scope);
  if (!allowed) return true;
  const mine = pluginScopes(entry);
  return mine.some((item) => allowed.includes(item));
}
