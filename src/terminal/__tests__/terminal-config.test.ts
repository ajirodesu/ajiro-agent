import { describe, expect, it } from "vitest";

import { DEFAULT_TERMINAL_OPTIONS, resolveTerminalOptions } from "@/terminal/terminalConfig";

describe("terminalConfig (Acode defaults adapted)", () => {
  it("matches the Acode reference behavior", () => {
    expect(DEFAULT_TERMINAL_OPTIONS.cursorBlink).toBe(true);
    expect(DEFAULT_TERMINAL_OPTIONS.cursorStyle).toBe("block");
    expect(DEFAULT_TERMINAL_OPTIONS.scrollback).toBe(1000);
    expect(DEFAULT_TERMINAL_OPTIONS.tabStopWidth).toBe(4);
    expect(DEFAULT_TERMINAL_OPTIONS.convertEol).toBe(true);
    expect(DEFAULT_TERMINAL_OPTIONS.fontLigatures).toBe(false);
    expect(DEFAULT_TERMINAL_OPTIONS.touchSelectionTapHoldDuration).toBe(400);
    expect(DEFAULT_TERMINAL_OPTIONS.touchSelectionHapticFeedback).toBe(true);
  });

  it("merges overrides and clamps to safe ranges", () => {
    const merged = resolveTerminalOptions({ fontSize: 99, scrollback: 50 });
    expect(merged.fontSize).toBeLessThanOrEqual(24);
    expect(merged.scrollback).toBeGreaterThanOrEqual(100);
    expect(merged.cursorStyle).toBe("block");
  });
});
