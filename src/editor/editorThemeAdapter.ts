/**
 * Editor theme adapter — the SOLE editor color/theme integration path.
 *
 * Priority (per spec):
 *   Ajiro AppTheme (+ locked-accent rules) → EditorTheme → CodeMirror.
 *
 * Token colors reuse `toLegacyPalette()` so the editor always matches the
 * syntax colors used everywhere else in the app; chrome colors follow the
 * same dark/light rules as the terminal adapter. Theme changes are pushed
 * live into the WebView — the document and undo history are never reset
 * for visual updates.
 */
import { resolveAccent, toLegacyPalette } from "@/theme/themes";
import type { AppTheme } from "@/theme/types";

import type { EditorTheme } from "@/editor/editorTypes";
import type { PluginEditorTheme } from "@/modules/extensions/editor-themes";

/**
 * Build a code-editor theme from a plugin's portable color config
 * (Acode Editor Themes API). Slots mirror the documented config keys;
 * every slot falls back within the config itself, so a sparse theme
 * still applies coherently. Null when the config cannot yield a
 * readable editor (invalid background/foreground).
 */
export function adaptPluginThemeToEditorTheme(
  theme: PluginEditorTheme,
): EditorTheme | null {
  const config = theme.config;
  const valid = (value: string | undefined): string | null =>
    value && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim())
      ? value.trim()
      : null;
  const background = valid(config.background);
  const foreground = valid(config.foreground);
  if (!background || !foreground) return null;
  const dark = theme.dark;
  const pick = (...keys: string[]): string => {
    for (const key of keys) {
      const value = valid(config[key]);
      if (value) return value;
    }
    return foreground;
  };
  const keyword = pick("keyword");
  const string = pick("string");
  const comment = pick("comment");
  const number = pick("number");
  const func = pick("function");
  const type = pick("type", "class");
  const operator = pick("operator");
  const constant = pick("constant");
  const variable = pick("variable");
  return {
    dark,
    background,
    foreground,
    gutterBackground: background,
    gutterForeground: comment,
    gutterBorder: wash(comment, 0.5),
    indentGuide: wash(comment, dark ? 0.35 : 0.3),
    warning: dark ? "#E0A23C" : "#8A5A00",
    error: valid(config.invalid) ?? (dark ? "#FF7B86" : "#DC2626"),
    cursor: foreground,
    selection: wash(foreground, dark ? 0.35 : 0.28),
    activeLine: mixHex(background, foreground, 0.06),
    matchingBracket: wash(keyword, 0.3),
    keyword,
    string,
    comment,
    number,
    function: func,
    type,
    operator,
    tag: keyword,
    attribute: constant ?? type,
    variable,
    punctuation: comment,
    regex: string,
  };
}

/**
 * Resolve the effective editor theme: an explicitly selected plugin
 * theme wins when it still exists and builds; anything else falls back
 * to the app-derived theme (never a broken editor).
 */
export function resolveEditorTheme(input: {
  appTheme: AppTheme;
  userAccent: string | null;
  pluginTheme: PluginEditorTheme | null;
}): EditorTheme {
  if (input.pluginTheme) {
    const built = adaptPluginThemeToEditorTheme(input.pluginTheme);
    if (built) return built;
  }
  return adaptAppThemeToEditorTheme(input.appTheme, input.userAccent);
}

function toChannels(hex: string): [number, number, number] | null {
  const clean = hex.trim().replace(/^#/, "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  const base = parseInt(full, 16);
  return [(base >> 16) & 0xff, (base >> 8) & 0xff, base & 0xff];
}

function wash(hex: string, alpha: number): string {
  const channels = toChannels(hex);
  if (!channels) return `rgba(59, 130, 246, ${alpha})`;
  return `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, ${alpha})`;
}

/** Mix two `#RRGGBB` colors; `t = 0` keeps `base`, `t = 1` returns `over`. */
export function mixHex(base: string, over: string, t: number): string {
  const a = toChannels(base);
  const b = toChannels(over);
  if (!a || !b) return base;
  const mix = (x: number, y: number): number =>
    Math.min(255, Math.max(0, Math.round(x + (y - x) * t)));
  const r = mix(a[0], b[0]);
  const g = mix(a[1], b[1]);
  const bl = mix(a[2], b[2]);
  return `#${((r << 16) | (g << 8) | bl).toString(16).padStart(6, "0").toUpperCase()}`;
}

export function adaptAppThemeToEditorTheme(
  theme: AppTheme,
  userAccent: string | null,
): EditorTheme {
  const palette = toLegacyPalette(theme);
  // Same precedence as the rest of the app: locked themes own their accent.
  const accent = resolveAccent(theme, userAccent);
  const dark = theme.dark;

  const background = dark
    ? theme.colors.surfaceContainerLowest
    : theme.colors.surface;

  return {
    dark,
    background,
    foreground: palette.text,
    gutterBackground: background,
    gutterForeground: palette.textSecondary,
    gutterBorder: palette.border,
    indentGuide: wash(palette.textSecondary, dark ? 0.28 : 0.22),
    warning: theme.colors.warning,
    error: theme.colors.error,
    cursor: accent,
    selection: wash(accent, dark ? 0.35 : 0.28),
    activeLine: wash(theme.colors.surface, dark ? 0.05 : 0.045),
    matchingBracket: wash(accent, 0.28),
    keyword: palette.syntaxKeyword,
    string: palette.syntaxString,
    comment: palette.syntaxComment,
    number: palette.syntaxNumber,
    function: palette.syntaxFunction,
    type: palette.syntaxConstant,
    operator: palette.syntaxOperator,
    tag: palette.syntaxKeyword,
    attribute: palette.syntaxConstant,
    variable: palette.text,
    punctuation: palette.textSecondary,
    regex: palette.syntaxRegex,
  };
}
