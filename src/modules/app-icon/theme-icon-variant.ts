/**
 * Theme → launcher-icon variant mapping. Pure and node-testable.
 *
 * - aqua/burnt/indigo resolve to their own artwork variant.
 * - light/dark resolve to theirs; `system` follows the device scheme
 *   (null scheme falls back to dark, matching the dark-first new themes).
 * - Only `aqua` uses the default launcher activity (alias null); every
 *   other variant maps to its activity-alias suffix, shared with the
 *   `with-themed-app-icon` plugin and the native switcher module.
 */
import type { AppThemeId } from "@/theme/types";

export type ThemeIconVariant =
  | "aqua"
  | "burnt"
  | "indigo"
  | "light"
  | "dark";

export const THEME_ICON_ALIAS_SUFFIX: Record<
  Exclude<ThemeIconVariant, "aqua">,
  string
> = {
  burnt: "ThemedIconBurnt",
  indigo: "ThemedIconIndigo",
  dark: "ThemedIconDark",
  light: "ThemedIconLight",
};

export function resolveThemeIconVariant(
  themeId: AppThemeId,
  deviceScheme: "light" | "dark" | null | undefined,
): ThemeIconVariant {
  switch (themeId) {
    case "aqua":
      return "aqua";
    case "burnt":
      return "burnt";
    case "indigo":
      return "indigo";
    case "light":
      return "light";
    case "dark":
      return "dark";
    case "system":
    default:
      return deviceScheme === "light" ? "light" : "dark";
  }
}

/** Activity-alias suffix, or null for the default launcher icon. */
export function aliasSuffixForVariant(
  variant: ThemeIconVariant,
): string | null {
  return variant === "aqua"
    ? null
    : THEME_ICON_ALIAS_SUFFIX[variant];
}
