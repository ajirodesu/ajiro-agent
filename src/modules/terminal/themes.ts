/** Terminal themes: dark, light, system mapping, custom. */
import { SYSTEM16 } from "@/modules/terminal/attributes";
import type { TerminalTheme } from "@/modules/terminal/types";

export const TERMINAL_DARK_THEME: TerminalTheme = {
  background: "#000000",
  foreground: "#e5e5e5",
  cursor: "#0a84ff",
  selection: "#264f78",
  palette: [...SYSTEM16],
};

export const TERMINAL_LIGHT_THEME: TerminalTheme = {
  background: "#ffffff",
  foreground: "#1a1a1a",
  cursor: "#0a84ff",
  selection: "#add6ff",
  palette: [
    "#000000",
    "#cd3131",
    "#00bc00",
    "#949800",
    "#0451a5",
    "#bc05bc",
    "#0598bc",
    "#555555",
    "#666666",
    "#cd3131",
    "#14ce14",
    "#b5ba00",
    "#0451a5",
    "#bc05bc",
    "#0598bc",
    "#a5a5a5",
  ],
};

export function resolveTerminalTheme(
  mode: "dark" | "light" | "system",
  systemDark: boolean,
  custom?: Partial<TerminalTheme>,
): TerminalTheme {
  const base =
    mode === "light" || (mode === "system" && !systemDark)
      ? TERMINAL_LIGHT_THEME
      : TERMINAL_DARK_THEME;
  if (!custom) return base;
  return {
    ...base,
    ...custom,
    palette:
      custom.palette && custom.palette.length >= 16
        ? custom.palette
        : base.palette,
  };
}
