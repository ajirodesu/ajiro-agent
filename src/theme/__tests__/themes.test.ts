import { describe, expect, it } from "vitest";

import { aquaTheme } from "@/theme/aqua";
import { burntTheme } from "@/theme/burnt";
import { indigoTheme } from "@/theme/indigo";
import {
  BUILT_IN_THEMES,
  LEGACY_DEFAULT_ACCENT,
  THEME_LIST,
  isValidAccent,
  resolveAccent,
  resolveAppTheme,
  resolveScheme,
  resolveStartupThemeId,
} from "@/theme/themes";
import {
  DEFAULT_THEME_ID,
  isNewThemeId,
  isValidThemeId,
} from "@/theme/types";
import type { ThemeColors } from "@/theme/types";

const REQUIRED_COLOR_KEYS: (keyof ThemeColors)[] = [
  "primary",
  "onPrimary",
  "primaryContainer",
  "onPrimaryContainer",
  "secondary",
  "onSecondary",
  "secondaryContainer",
  "onSecondaryContainer",
  "tertiary",
  "onTertiary",
  "tertiaryContainer",
  "onTertiaryContainer",
  "surface",
  "onSurface",
  "surfaceVariant",
  "onSurfaceVariant",
  "surfaceContainerLowest",
  "surfaceContainerLow",
  "surfaceContainer",
  "surfaceContainerHigh",
  "surfaceContainerHighest",
  "surfaceBright",
  "surfaceDim",
  "inverseSurface",
  "inverseOnSurface",
  "inversePrimary",
  "outline",
  "outlineVariant",
  "scrim",
  "shadow",
  "error",
  "onError",
  "errorContainer",
  "onErrorContainer",
  "success",
  "onSuccess",
  "successContainer",
  "onSuccessContainer",
  "warning",
  "onWarning",
  "warningContainer",
  "onWarningContainer",
  "info",
  "onInfo",
  "infoContainer",
  "onInfoContainer",
];

describe("theme registry", () => {
  it("keeps existing themes first-class alongside the new built-ins", () => {
    const ids = THEME_LIST.map((theme) => theme.id);
    expect(ids).toEqual([
      "light",
      "dark",
      "aqua",
      "burnt",
      "indigo",
    ]);
    expect(BUILT_IN_THEMES.aqua).toBe(aquaTheme);
    expect(BUILT_IN_THEMES.burnt).toBe(burntTheme);
    expect(BUILT_IN_THEMES.indigo).toBe(indigoTheme);
  });

  it("validates theme ids strictly", () => {
    expect(isValidThemeId("aqua")).toBe(true);
    expect(isValidThemeId("dark")).toBe(true);
    expect(isValidThemeId("nope")).toBe(false);
    expect(isValidThemeId(null)).toBe(false);
    expect(isValidThemeId(undefined)).toBe(false);
    expect(isNewThemeId("burnt")).toBe(true);
    expect(isNewThemeId("light")).toBe(false);
  });
});

describe("startup default", () => {
  it("selects aqua with no persisted theme", () => {
    expect(DEFAULT_THEME_ID).toBe("aqua");
    expect(
      resolveStartupThemeId({
        storedThemeId: undefined,
        storedThemeMode: undefined,
        hasThemeModeKey: false,
      }),
    ).toBe("aqua");
  });

  it("preserves existing valid preferences", () => {
    for (const id of ["system", "light", "dark"] as const) {
      expect(
        resolveStartupThemeId({
          storedThemeId: undefined,
          storedThemeMode: id,
          hasThemeModeKey: true,
        }),
      ).toBe(id);
    }
    for (const id of ["aqua", "burnt", "indigo"] as const) {
      expect(
        resolveStartupThemeId({
          storedThemeId: id,
          storedThemeMode: "dark",
          hasThemeModeKey: true,
        }),
      ).toBe(id);
    }
  });

  it("falls back to aqua on invalid preferences", () => {
    expect(
      resolveStartupThemeId({
        storedThemeId: "midnight",
        storedThemeMode: "neon",
        hasThemeModeKey: true,
      }),
    ).toBe("aqua");
  });

  it("resolves system against the device scheme only for legacy", () => {
    expect(resolveScheme("system", "dark")).toBe("dark");
    expect(resolveScheme("system", "light")).toBe("light");
    expect(resolveScheme("aqua", "light")).toBe("dark");
    expect(resolveScheme("burnt", "light")).toBe("dark");
    expect(resolveScheme("indigo", "light")).toBe("dark");
    expect(resolveAppTheme("system", "dark").id).toBe("dark");
    expect(resolveAppTheme("aqua", "light").id).toBe("aqua");
  });
});

describe("new theme palettes", () => {
  it("uses the exact reference primaries", () => {
    expect(aquaTheme.colors.primary).toBe("#34E0BE");
    expect(burntTheme.colors.primary).toBe("#DA7756");
    expect(indigoTheme.colors.primary).toBe("#9C87F5");
  });

  it("contains every required semantic token", () => {
    for (const theme of [aquaTheme, burntTheme, indigoTheme]) {
      for (const key of REQUIRED_COLOR_KEYS) {
        const value = theme.colors[key];
        expect(typeof value, `${theme.id}.${key}`).toBe("string");
        expect(value.length, `${theme.id}.${key}`).toBeGreaterThan(0);
      }
      expect(theme.dark).toBe(true);
      expect(theme.lockedAccent).toBe(true);
      expect(theme.effects.glassBlur).toBe(20);
    }
  });
});

describe("accent locking and precedence", () => {
  it("locks new themes to their primary", () => {
    expect(resolveAccent(aquaTheme, null)).toBe("#34E0BE");
    expect(resolveAccent(aquaTheme, "#A855F7")).toBe("#34E0BE");
    expect(resolveAccent(burntTheme, "#A855F7")).toBe("#DA7756");
    expect(resolveAccent(indigoTheme, "#0A84FF")).toBe("#9C87F5");
  });

  it("keeps legacy accent behavior (stored or default)", () => {
    const legacy = resolveAppTheme("dark", "dark");
    expect(legacy.lockedAccent).toBe(false);
    expect(resolveAccent(legacy, null)).toBe(LEGACY_DEFAULT_ACCENT);
    expect(resolveAccent(legacy, "#A855F7")).toBe("#A855F7");
  });

  it("validates accent values", () => {
    expect(isValidAccent(null)).toBe(true);
    expect(isValidAccent("#0A84FF")).toBe(true);
    expect(isValidAccent("red")).toBe(false);
    expect(isValidAccent(42)).toBe(false);
  });
});
