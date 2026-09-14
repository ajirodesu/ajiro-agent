/**
 * Terminal theme adapter — the SOLE terminal color/theme integration path.
 *
 * Priority (per spec):
 *   Ajiro AppTheme (+ locked-accent rules) → TerminalTheme → xterm.
 *
 * Accent compatibility mirrors `resolveAccent()` in `src/theme/themes.ts`:
 * - locked (theme-owned palette: aqua/burnt/indigo) → theme's own primary
 *   always wins; the generic user accent never overrides it.
 * - legacy (light/dark/system) → stored user accent or the legacy default.
 *
 * ANSI colors derive from theme semantics (error/success/warning/info +
 * primary/tertiary) so the terminal visually belongs to the app; standard
 * 16-slot structure is kept because xterm requires it.
 */
import { resolveAccent } from "@/theme/themes";
import type { AppTheme } from "@/theme/types";
import { rgba } from "@/theme/utils";
import type { TerminalTheme } from "@/terminal/terminalTypes";

/** Lighten (>0) or darken (<0) a `#RRGGBB` color by -1..1. */
export function shade(hex: string, amount: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return hex;
  const base = parseInt(match[1] ?? "808080", 16);
  const clamp = (v: number): number => Math.min(255, Math.max(0, Math.round(v)));
  const mix = (channel: number): number =>
    amount >= 0 ? channel + (255 - channel) * amount : channel * (1 + amount);
  const r = clamp(mix((base >> 16) & 0xff));
  const g = clamp(mix((base >> 8) & 0xff));
  const b = clamp(mix(base & 0xff));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0").toUpperCase()}`;
}

/** Parse `#RRGGBB` (or short `#RGB`) into channels for rgba mixing. */
function toChannels(hex: string): [number, number, number] | null {
  const clean = hex.trim().replace(/^#/, "");
  const full =
    clean.length === 3
      ? clean.split("").map((c) => c + c).join("")
      : clean;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  const base = parseInt(full, 16);
  return [(base >> 16) & 0xff, (base >> 8) & 0xff, base & 0xff];
}

function accentWash(accent: string, alpha: number): string {
  const channels = toChannels(accent);
  if (!channels) return rgba(52, 224, 190, alpha);
  return `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, ${alpha})`;
}

export function adaptAppThemeToTerminalTheme(
  theme: AppTheme,
  userAccent: string | null,
): TerminalTheme {
  const { colors } = theme;
  // Same precedence as the rest of the app: locked themes own their accent.
  const accent = resolveAccent(theme, userAccent);
  const dark = theme.dark;

  const background = dark ? colors.surfaceContainerLowest : "#FFFFFF";
  const foreground = dark ? colors.onSurface : colors.onSurface;

  return {
    background,
    foreground,
    cursor: accent,
    cursorAccent: background,
    selectionBackground: accentWash(accent, dark ? 0.35 : 0.3),
    selectionForeground: foreground,
    black: dark ? colors.surfaceContainerLowest : "#000000",
    red: colors.error,
    green: colors.success,
    yellow: colors.warning,
    blue: colors.info,
    magenta: colors.tertiary,
    cyan: dark ? colors.primary : colors.info,
    white: dark ? colors.onSurfaceVariant : "#555555",
    brightBlack: dark ? shade(colors.surfaceContainerHighest, 0.25) : "#666666",
    brightRed: shade(colors.error, dark ? 0.25 : 0),
    brightGreen: shade(colors.success, dark ? 0.25 : 0.1),
    brightYellow: shade(colors.warning, dark ? 0.25 : 0),
    brightBlue: shade(colors.info, dark ? 0.25 : 0),
    brightMagenta: shade(colors.tertiary, dark ? 0.25 : 0),
    brightCyan: shade(colors.primary, dark ? 0.25 : 0),
    brightWhite: dark ? "#FFFFFF" : "#A5A5A5",
  };
}
