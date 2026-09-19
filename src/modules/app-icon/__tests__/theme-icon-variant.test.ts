import { describe, expect, it } from "vitest";

import {
  aliasSuffixForVariant,
  resolveThemeIconVariant,
  THEME_ICON_ALIAS_SUFFIX,
} from "@/modules/app-icon/theme-icon-variant";

describe("resolveThemeIconVariant", () => {
  it("maps built-ins and legacy ids to their own artwork", () => {
    expect(resolveThemeIconVariant("aqua", "light")).toBe("aqua");
    expect(resolveThemeIconVariant("burnt", "light")).toBe("burnt");
    expect(resolveThemeIconVariant("indigo", "dark")).toBe("indigo");
    expect(resolveThemeIconVariant("light", "dark")).toBe("light");
    expect(resolveThemeIconVariant("dark", "light")).toBe("dark");
  });

  it("follows the device scheme for system, defaulting to dark", () => {
    expect(resolveThemeIconVariant("system", "light")).toBe("light");
    expect(resolveThemeIconVariant("system", "dark")).toBe("dark");
    expect(resolveThemeIconVariant("system", null)).toBe("dark");
    expect(resolveThemeIconVariant("system", undefined)).toBe("dark");
  });
});

describe("aliasSuffixForVariant", () => {
  it("uses the default activity for aqua and aliases otherwise", () => {
    expect(aliasSuffixForVariant("aqua")).toBeNull();
    expect(aliasSuffixForVariant("burnt")).toBe(
      THEME_ICON_ALIAS_SUFFIX.burnt,
    );
    for (const variant of ["burnt", "indigo", "dark", "light"] as const) {
      expect(aliasSuffixForVariant(variant)).toMatch(/^ThemedIcon[A-Z]/);
    }
  });
});
