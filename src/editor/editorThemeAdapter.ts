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

  const background = dark ? theme.colors.surfaceContainerLowest : "#FFFFFF";

  return {
    dark,
    background,
    foreground: palette.text,
    gutterBackground: background,
    gutterForeground: palette.textSecondary,
    cursor: accent,
    selection: wash(accent, dark ? 0.35 : 0.28),
    activeLine: dark
      ? wash("#FFFFFF", 0.05)
      : wash("#000000", 0.045),
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
