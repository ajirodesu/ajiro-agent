import { describe, expect, it } from "vitest";

import { adaptAppThemeToEditorTheme } from "@/editor/editorThemeAdapter";
import { aquaTheme } from "@/theme/aqua";
import { darkTheme, lightTheme } from "@/theme/legacy";
import type { AppTheme } from "@/theme/types";

const COLOR_SLOTS = [
  "background",
  "foreground",
  "gutterBackground",
  "gutterForeground",
  "gutterBorder",
  "indentGuide",
  "cursor",
  "selection",
  "activeLine",
  "matchingBracket",
  "keyword",
  "string",
  "comment",
  "number",
  "function",
  "type",
  "operator",
  "tag",
  "attribute",
  "variable",
  "punctuation",
  "regex",
] as const;

describe("editorThemeAdapter (sole editor color integration)", () => {
  it("fills every slot with a CSS color for every built-in theme", () => {
    for (const theme of [aquaTheme, darkTheme, lightTheme]) {
      const editor = adaptAppThemeToEditorTheme(theme, null);
      expect(editor.dark).toBe(theme.dark);
      for (const slot of COLOR_SLOTS) {
        expect(typeof editor[slot]).toBe("string");
        expect(editor[slot]).toMatch(/^(#|rgba\()/);
      }
    }
  });

  it("lets a locked (theme-owned) accent win over the user accent", () => {
    expect(aquaTheme.lockedAccent).toBe(true);
    const editor = adaptAppThemeToEditorTheme(aquaTheme, "#A855F7");
    expect(editor.cursor).toBe(aquaTheme.colors.primary);
  });

  it("uses the user accent for legacy themes", () => {
    const legacy: AppTheme = { ...darkTheme, lockedAccent: false };
    const editor = adaptAppThemeToEditorTheme(legacy, "#A855F7");
    expect(editor.cursor).toBe("#A855F7");
  });

  it("maps syntax semantics onto token slots", () => {
    const editor = adaptAppThemeToEditorTheme(aquaTheme, null);
    expect(editor.keyword).toBe(aquaTheme.colors.primary);
    expect(editor.string).toBe(aquaTheme.colors.success);
    expect(editor.number).toBe(aquaTheme.colors.warning);
    expect(editor.comment).toBe(aquaTheme.colors.onSurfaceVariant);
  });

  it("derives selection from the resolved accent", () => {
    const editor = adaptAppThemeToEditorTheme(aquaTheme, null);
    const channels = aquaTheme.colors.primary
      .replace("#", "")
      .match(/../g)!
      .map((hex) => parseInt(hex, 16))
      .join(", ");
    expect(editor.selection).toContain(channels);
  });

  it("uses a dark chrome for dark themes and white for light themes", () => {
    const darkEditor = adaptAppThemeToEditorTheme(darkTheme, null);
    expect(darkEditor.background).toBe(darkTheme.colors.surfaceContainerLowest);
    const lightEditor = adaptAppThemeToEditorTheme(lightTheme, null);
    expect(lightEditor.background).toBe("#FFFFFF");
  });
});
