/**
 * Theme registry: existing themes first, then aqua/burnt/indigo.
 * Resolution rules (startup §25, precedence §19):
 * - stored theme_id valid → it (existing valid preferences preserved);
 * - else stored theme_mode explicitly present and legacy-valid → it;
 * - else (missing/invalid) → aqua.
 * Accent: locked themes always resolve to their primary; legacy themes
 * resolve to the stored user accent or the legacy default.
 */
import { aquaTheme } from "@/theme/aqua";
import { burntTheme } from "@/theme/burnt";
import { indigoTheme } from "@/theme/indigo";
import { darkTheme, lightTheme } from "@/theme/legacy";
import type {
  AppTheme,
  AppThemeId,
  LegacyThemeId,
  NewThemeId,
} from "@/theme/types";
import {
  DEFAULT_THEME_ID,
  isNewThemeId,
  isValidThemeId,
} from "@/theme/types";

export type { AppTheme, AppThemeId, LegacyThemeId, NewThemeId };
export { DEFAULT_THEME_ID, isNewThemeId, isValidThemeId };

export const BUILT_IN_THEMES: Record<NewThemeId, AppTheme> = {
  aqua: aquaTheme,
  burnt: burntTheme,
  indigo: indigoTheme,
};

/** All selectable themes: existing first, then the new built-ins. */
export const THEME_LIST: AppTheme[] = [
  { ...lightTheme, displayName: "Light" },
  { ...darkTheme, displayName: "Dark" },
  aquaTheme,
  burntTheme,
  indigoTheme,
];

export function resolveAppTheme(
  id: AppThemeId,
  deviceScheme: "light" | "dark",
): AppTheme {
  if (id === "system") {
    return deviceScheme === "dark" ? darkTheme : lightTheme;
  }
  if (id === "light") return lightTheme;
  if (id === "dark") return darkTheme;
  return BUILT_IN_THEMES[id];
}

/** NativeWind scheme: new themes are deliberately dark, always. */
export function resolveScheme(
  id: AppThemeId,
  deviceScheme: "light" | "dark",
): "light" | "dark" {
  if (isNewThemeId(id)) return "dark";
  if (id === "system") return deviceScheme;
  return id;
}

export function resolveStartupThemeId(input: {
  storedThemeId: unknown;
  storedThemeMode: unknown;
  hasThemeModeKey: boolean;
}): AppThemeId {
  if (isValidThemeId(input.storedThemeId)) {
    return input.storedThemeId;
  }
  if (
    input.hasThemeModeKey &&
    (input.storedThemeMode === "system" ||
      input.storedThemeMode === "light" ||
      input.storedThemeMode === "dark")
  ) {
    return input.storedThemeMode as LegacyThemeId;
  }
  return DEFAULT_THEME_ID;
}

/** De-facto legacy accent (send button, current visuals). */
export const LEGACY_DEFAULT_ACCENT = "#0A84FF";

export type AccentChoice = {
  id: string;
  label: string;
  /** Null = follow the theme default. */
  value: string | null;
};

export const ACCENT_CHOICES: AccentChoice[] = [
  { id: "default", label: "Default", value: null },
  { id: "blue", label: "Blue", value: "#0A84FF" },
  { id: "green", label: "Green", value: "#34D17B" },
  { id: "purple", label: "Purple", value: "#A855F7" },
  { id: "orange", label: "Orange", value: "#F59E0B" },
];

export function isValidAccent(value: unknown): value is string | null {
  if (value === null) return true;
  return (
    typeof value === "string" &&
    ACCENT_CHOICES.some((choice) => choice.value === value)
  );
}

/**
 * Accent precedence: locked (new) themes always resolve to their primary —
 * a stored user accent can never override them. Legacy themes resolve to
 * the stored accent or the legacy default (current visuals unchanged).
 */
export function resolveAccent(
  theme: AppTheme,
  userAccent: string | null,
): string {
  if (theme.lockedAccent) return theme.colors.primary;
  if (userAccent && isValidAccent(userAccent)) return userAccent;
  return LEGACY_DEFAULT_ACCENT;
}

type LegacyPalette = {
  text: string;
  background: string;
  backgroundElement: string;
  backgroundSelected: string;
  textSecondary: string;
  border: string;
  input: string;
  ring: string;
  accent: string;
  accentForeground: string;
  syntaxComment: string;
  syntaxConstant: string;
  syntaxFunction: string;
  syntaxKeyword: string;
  syntaxNumber: string;
  syntaxOperator: string;
  syntaxRegex: string;
  syntaxString: string;
  destructive: string;
  destructiveForeground: string;
};

/**
 * Global application mechanism: maps a semantic theme onto the legacy
 * flat palette shape every existing component already consumes. New themes
 * therefore re-skin the whole app with zero component edits; legacy ids
 * are never routed here (their static palettes render byte-identically).
 */
export function toLegacyPalette(theme: AppTheme): LegacyPalette {
  const colors = theme.colors;
  const effects = theme.effects;
  return {
    text: colors.onSurface,
    background: colors.surface,
    backgroundElement: colors.surfaceContainer,
    backgroundSelected: colors.surfaceContainerHigh,
    textSecondary: colors.onSurfaceVariant,
    border: colors.outlineVariant,
    input: effects.inputBackground,
    ring: effects.focusGlowColor,
    accent: colors.primary,
    accentForeground: colors.onPrimary,
    syntaxComment: colors.onSurfaceVariant,
    syntaxConstant: colors.tertiary,
    syntaxFunction: colors.info,
    syntaxKeyword: colors.primary,
    syntaxNumber: colors.warning,
    syntaxOperator: colors.secondary,
    syntaxRegex: colors.warning,
    syntaxString: colors.success,
    destructive: colors.error,
    destructiveForeground: colors.onError,
  };
}
