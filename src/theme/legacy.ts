/**
 * Legacy theme adapters: the existing system/light/dark themes expressed in
 * the semantic AppTheme shape WITHOUT changing their values. Every color
 * below is mapped 1:1 from the existing theme-tokens palettes, so legacy
 * themes render byte-identically to before. Mappings that have no exact
 * legacy equivalent (containers, tertiary) use the closest documented token.
 */
import { Colors } from "@/constants/theme-tokens";

import type { AppTheme, ThemeColors, ThemeEffects } from "@/theme/types";
import { rgba, SHARED_TYPOGRAPHY, softShadows } from "@/theme/utils";

function legacyEffects(
  glassBackground: string,
  glassBorder: string,
  inputBackground: string,
  inputBorder: string,
  focusGlowColor: string,
  ambientPrimary: string,
  ambientSecondary: string,
): ThemeEffects {
  return {
    glassBackground,
    glassBorder,
    glassBlur: 20,
    glassSaturation: 1.6,
    inputBackground,
    inputBorder,
    ...softShadows(),
    focusGlowColor,
    avatarGlowColor: focusGlowColor,
    ambientGlowPrimary: ambientPrimary,
    ambientGlowSecondary: ambientSecondary,
    ambientGlowOpacity: 1,
    scrollbarIdleOpacity: 0,
  };
}

function legacyColors(
  palette: (typeof Colors)["dark"],
  extras: {
    tertiary: string;
    tertiaryContainer: string;
    success: string;
    warning: string;
    info: string;
  },
): ThemeColors {
  return {
    primary: palette.accent,
    onPrimary: palette.accentForeground,
    primaryContainer: palette.backgroundSelected,
    onPrimaryContainer: palette.text,

    secondary: palette.textSecondary,
    onSecondary: palette.background,
    secondaryContainer: palette.backgroundSelected,
    onSecondaryContainer: palette.text,

    tertiary: extras.tertiary,
    onTertiary: palette.background,
    tertiaryContainer: extras.tertiaryContainer,
    onTertiaryContainer: palette.text,

    surface: palette.background,
    onSurface: palette.text,
    surfaceVariant: palette.backgroundElement,
    onSurfaceVariant: palette.textSecondary,

    surfaceContainerLowest: palette.background,
    surfaceContainerLow: palette.backgroundElement,
    surfaceContainer: palette.backgroundElement,
    surfaceContainerHigh: palette.backgroundSelected,
    surfaceContainerHighest: palette.backgroundSelected,

    surfaceBright: palette.text,
    surfaceDim: palette.background,

    inverseSurface: palette.text,
    inverseOnSurface: palette.background,
    inversePrimary: palette.backgroundSelected,

    outline: palette.border,
    outlineVariant: palette.border,

    scrim: "#000000",
    shadow: "#000000",

    error: palette.destructive,
    onError: palette.destructiveForeground,
    errorContainer: palette.backgroundSelected,
    onErrorContainer: palette.destructive,

    success: extras.success,
    onSuccess: palette.background,
    successContainer: palette.backgroundSelected,
    onSuccessContainer: extras.success,

    warning: extras.warning,
    onWarning: palette.background,
    warningContainer: palette.backgroundSelected,
    onWarningContainer: extras.warning,

    info: extras.info,
    onInfo: palette.background,
    infoContainer: palette.backgroundSelected,
    onInfoContainer: extras.info,
  };
}

export const lightTheme: AppTheme = {
  id: "light",
  displayName: "Light",
  dark: false,
  lockedAccent: false,
  colors: legacyColors(Colors.light, {
    tertiary: "#0B5CAD",
    tertiaryContainer: "#E0E1E6",
    success: "#196B3A",
    warning: "#8A4B08",
    info: "#0B5CAD",
  }),
  effects: legacyEffects(
    rgba(255, 255, 255, 0.6),
    rgba(0, 0, 0, 0.08),
    rgba(255, 255, 255, 0.8),
    rgba(0, 0, 0, 0.08),
    rgba(11, 92, 173, 0.18),
    rgba(11, 92, 173, 0.08),
    rgba(111, 66, 193, 0.06),
  ),
};

export const darkTheme: AppTheme = {
  id: "dark",
  displayName: "Dark",
  dark: true,
  lockedAccent: false,
  colors: legacyColors(Colors.dark, {
    tertiary: "#79C0FF",
    tertiaryContainer: "#2E3135",
    success: "#76D39B",
    warning: "#F2A65A",
    info: "#79C0FF",
  }),
  effects: legacyEffects(
    rgba(24, 26, 29, 0.6),
    rgba(255, 255, 255, 0.08),
    rgba(24, 26, 29, 0.8),
    rgba(255, 255, 255, 0.08),
    rgba(121, 192, 255, 0.18),
    rgba(121, 192, 255, 0.08),
    rgba(210, 168, 255, 0.06),
  ),
};

export const LEGACY_TYPOGRAPHY = SHARED_TYPOGRAPHY;
