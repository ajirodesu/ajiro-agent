import { describe, expect, it } from "vitest";

import {
  adaptAppThemeToEditorTheme,
  adaptPluginThemeToEditorTheme,
  resolveEditorTheme,
} from "@/editor/editorThemeAdapter";
import type { PluginEditorTheme } from "@/modules/extensions/editor-themes";
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
  "warning",
  "error",
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
        expect(editor[slot]).toMatch(/^(#|rgba?\(|hsla?\()/);
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

  it("builds a full editor theme from a plugin config", () => {
    const plugin: PluginEditorTheme = {
      id: "chai_theme",
      caption: "Chai Theme",
      dark: true,
      pluginId: "com.example.chai",
      config: {
        background: "#101418",
        foreground: "#e6edf3",
        keyword: "#ffb86c",
        string: "#a5ff90",
        comment: "#7f8c98",
      },
    };
    const editor = adaptPluginThemeToEditorTheme(plugin);
    expect(editor).not.toBeNull();
    expect(editor?.background).toBe("#101418");
    expect(editor?.keyword).toBe("#ffb86c");
    expect(editor?.number).toBe("#e6edf3");
    expect(editor?.dark).toBe(true);
    for (const slot of COLOR_SLOTS) {
      expect(typeof editor?.[slot]).toBe("string");
      expect(editor?.[slot]).toMatch(/^(#|rgba?\(|hsla?\()/);
    }
  });

  it("refuses configs without usable background/foreground", () => {
    const bad: PluginEditorTheme = {
      id: "bad",
      caption: "Bad",
      dark: true,
      pluginId: "com.example.bad",
      config: { background: "not-a-color", foreground: "#e6edf3" },
    };
    expect(adaptPluginThemeToEditorTheme(bad)).toBeNull();
  });

  it("prefers the selected plugin theme and falls back to the app theme", () => {
    const plugin: PluginEditorTheme = {
      id: "chai_theme",
      caption: "Chai Theme",
      dark: true,
      pluginId: "com.example.chai",
      config: { background: "#101418", foreground: "#e6edf3" },
    };
    const resolved = resolveEditorTheme({
      appTheme: aquaTheme,
      userAccent: null,
      pluginTheme: plugin,
    });
    expect(resolved.background).toBe("#101418");
    expect(
      resolveEditorTheme({ appTheme: aquaTheme, userAccent: null, pluginTheme: null })
        .background,
    ).toBe(adaptAppThemeToEditorTheme(aquaTheme, null).background);
  });

  it("uses a dark chrome for dark themes and white for light themes", () => {
    const darkEditor = adaptAppThemeToEditorTheme(darkTheme, null);
    expect(darkEditor.background).toBe(darkTheme.colors.surfaceContainerLowest);
    const lightEditor = adaptAppThemeToEditorTheme(lightTheme, null);
    expect(lightEditor.background).toBe(lightTheme.colors.surface);
  });
});
