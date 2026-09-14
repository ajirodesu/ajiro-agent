/**
 * Terminal defaults — Acode `terminalDefaults.js` adapted to React Native.
 *
 * Original (`DEFAULT_TERMINAL_SETTINGS`): fontSize 12, MesloLGS NF, block
 * cursor + blink, scrollback 1000, tabStopWidth 4, convertEol, no ligatures,
 * 400ms long-press selection, haptics on.
 *
 * Mobile adjustments: slightly larger base font (14), system monospace stack
 * (no font-file dependency), scrollback kept at 1000 to bound WebView memory.
 */
import type { TerminalOptions } from "@/terminal/terminalTypes";

export const DEFAULT_TERMINAL_OPTIONS: TerminalOptions = {
  fontSize: 14,
  fontFamily: "ui-monospace, Menlo, Consolas, monospace",
  fontWeight: "normal",
  fontLigatures: false,
  letterSpacing: 0,
  lineHeight: 1.2,
  cursorBlink: true,
  cursorStyle: "block",
  scrollback: 1000,
  showScrollbar: true,
  tabStopWidth: 4,
  convertEol: true,
  touchSelectionTapHoldDuration: 400,
  touchSelectionHapticFeedback: true,
};

export function resolveTerminalOptions(
  overrides?: Partial<TerminalOptions>,
): TerminalOptions {
  const merged: TerminalOptions = { ...DEFAULT_TERMINAL_OPTIONS, ...overrides };
  merged.fontSize = Math.max(10, Math.min(24, Math.round(merged.fontSize)));
  merged.scrollback = Math.max(100, Math.min(10_000, Math.round(merged.scrollback)));
  merged.tabStopWidth = Math.max(2, Math.min(8, Math.round(merged.tabStopWidth)));
  return merged;
}
