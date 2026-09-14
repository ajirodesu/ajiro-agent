/**
 * Fallback ANSI terminal themes.
 *
 * These are ONLY fallbacks (e.g. before the app theme resolves). Production
 * rendering always uses `terminalThemeAdapter.adaptAppThemeToTerminalTheme()`
 * so the terminal inherits the active Ajiro theme. No unrelated hardcoded
 * colors are introduced for terminal chrome anywhere else.
 */
import type { TerminalTheme } from "@/terminal/terminalTypes";

export const FALLBACK_DARK_TERMINAL_THEME: TerminalTheme = {
  background: "#070E11",
  foreground: "#F0F7F5",
  cursor: "#34E0BE",
  selectionBackground: "#1D4A44",
  selectionForeground: "#F0F7F5",
  black: "#0E1619",
  red: "#F43F5E",
  green: "#4ADE80",
  yellow: "#F59E0B",
  blue: "#818CF8",
  magenta: "#C084FC",
  cyan: "#34E0BE",
  white: "#E5E5E5",
  brightBlack: "#41504D",
  brightRed: "#FDA4AF",
  brightGreen: "#A6F4BE",
  brightYellow: "#FCD378",
  brightBlue: "#C7C7FF",
  brightMagenta: "#D8B4FE",
  brightCyan: "#B7F5E0",
  brightWhite: "#FFFFFF",
};

export const FALLBACK_LIGHT_TERMINAL_THEME: TerminalTheme = {
  background: "#FFFFFF",
  foreground: "#1A1A1A",
  cursor: "#0A84FF",
  selectionBackground: "#ADD6FF",
  selectionForeground: "#1A1A1A",
  black: "#000000",
  red: "#CD3131",
  green: "#00BC00",
  yellow: "#949800",
  blue: "#0451A5",
  magenta: "#BC05BC",
  cyan: "#0598BC",
  white: "#555555",
  brightBlack: "#666666",
  brightRed: "#CD3131",
  brightGreen: "#14CE14",
  brightYellow: "#B5BA00",
  brightBlue: "#0451A5",
  brightMagenta: "#BC05BC",
  brightCyan: "#0598BC",
  brightWhite: "#A5A5A5",
};

/** Map the 16-color palette to xterm's `ITheme` shape. */
export function toXtermTheme(theme: TerminalTheme): Record<string, string> {
  return {
    background: theme.background,
    foreground: theme.foreground,
    cursor: theme.cursor ?? theme.foreground,
    cursorAccent: theme.cursorAccent ?? theme.background,
    selectionBackground: theme.selectionBackground ?? theme.background,
    selectionForeground: theme.selectionForeground ?? theme.foreground,
    black: theme.black,
    red: theme.red,
    green: theme.green,
    yellow: theme.yellow,
    blue: theme.blue,
    magenta: theme.magenta,
    cyan: theme.cyan,
    white: theme.white,
    brightBlack: theme.brightBlack,
    brightRed: theme.brightRed,
    brightGreen: theme.brightGreen,
    brightYellow: theme.brightYellow,
    brightBlue: theme.brightBlue,
    brightMagenta: theme.brightMagenta,
    brightCyan: theme.brightCyan,
    brightWhite: theme.brightWhite,
  };
}
