import { describe, expect, it } from "vitest";

import { aquaTheme } from "@/theme/aqua";
import { darkTheme, lightTheme } from "@/theme/legacy";
import type { AppTheme } from "@/theme/types";
import { adaptAppThemeToTerminalTheme } from "@/terminal/terminalThemeAdapter";

const ANSI_SLOTS = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
] as const;

describe("terminalThemeAdapter (sole terminal color integration)", () => {
  it("fills every ANSI slot with theme-derived colors", () => {
    for (const theme of [aquaTheme, darkTheme, lightTheme]) {
      const terminal = adaptAppThemeToTerminalTheme(theme, null);
      expect(terminal.background).toBeTruthy();
      expect(terminal.foreground).toBeTruthy();
      for (const slot of ANSI_SLOTS) {
        expect(typeof terminal[slot]).toBe("string");
        expect(terminal[slot]).toMatch(/^#/);
      }
    }
  });

  it("lets a locked (theme-owned) accent win over the user accent", () => {
    expect(aquaTheme.lockedAccent).toBe(true);
    const terminal = adaptAppThemeToTerminalTheme(aquaTheme, "#A855F7");
    expect(terminal.cursor).toBe(aquaTheme.colors.primary);
  });

  it("uses the user accent for legacy themes", () => {
    const legacy: AppTheme = { ...darkTheme, lockedAccent: false };
    const terminal = adaptAppThemeToTerminalTheme(legacy, "#A855F7");
    expect(terminal.cursor).toBe("#A855F7");
  });

  it("maps error/success/warning semantics into ANSI slots", () => {
    const terminal = adaptAppThemeToTerminalTheme(aquaTheme, null);
    expect(terminal.red).toBe(aquaTheme.colors.error);
    expect(terminal.green).toBe(aquaTheme.colors.success);
    expect(terminal.yellow).toBe(aquaTheme.colors.warning);
  });

  it("derives selection from the resolved accent", () => {
    const terminal = adaptAppThemeToTerminalTheme(aquaTheme, null);
    expect(terminal.selectionBackground).toContain("52, 224, 190");
  });
});
