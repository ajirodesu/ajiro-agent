/**
 * Indigo theme — near-black violet, amethyst primary, magenta tertiary.
 * Exact reference palette. Container tones for error/success/warning/info
 * follow the reference dark-tint pattern (documented derivation where the
 * reference lists only the base semantic).
 */
import type { AppTheme } from "@/theme/types";
import { rgb, rgba, SHARED_TYPOGRAPHY, softShadows } from "@/theme/utils";

export const indigoTheme: AppTheme = {
  id: "indigo",
  displayName: "Indigo",
  dark: true,
  lockedAccent: true,
  colors: {
    primary: rgb(156, 135, 245),
    onPrimary: rgb(20, 14, 43),
    primaryContainer: rgb(44, 32, 92),
    onPrimaryContainer: rgb(224, 217, 255),

    secondary: rgb(170, 161, 196),
    onSecondary: rgb(25, 20, 36),
    secondaryContainer: rgb(38, 32, 54),
    onSecondaryContainer: rgb(224, 218, 240),

    tertiary: rgb(232, 121, 199),
    onTertiary: rgb(46, 10, 38),
    tertiaryContainer: rgb(74, 22, 63),
    onTertiaryContainer: rgb(253, 209, 240),

    surface: rgb(11, 7, 20),
    onSurface: rgb(240, 236, 250),
    surfaceVariant: rgb(70, 62, 90),
    onSurfaceVariant: rgb(168, 159, 188),

    surfaceContainerLowest: rgb(6, 4, 12),
    surfaceContainerLow: rgb(15, 11, 27),
    surfaceContainer: rgb(20, 15, 35),
    surfaceContainerHigh: rgb(27, 20, 45),
    surfaceContainerHighest: rgb(35, 27, 56),

    surfaceBright: rgb(168, 159, 188),
    surfaceDim: rgb(6, 4, 12),

    inverseSurface: rgb(240, 236, 250),
    inverseOnSurface: rgb(11, 7, 20),
    inversePrimary: rgb(44, 32, 92),

    outline: rgb(111, 100, 138),
    outlineVariant: rgb(48, 41, 66),

    scrim: rgb(0, 0, 0),
    shadow: rgb(8, 5, 14),

    error: rgb(248, 87, 118),
    onError: rgb(255, 255, 255),
    errorContainer: rgb(62, 20, 28),
    onErrorContainer: rgb(255, 199, 212),

    success: rgb(94, 224, 152),
    onSuccess: rgb(6, 32, 18),
    successContainer: rgb(16, 52, 32),
    onSuccessContainer: rgb(192, 246, 210),

    warning: rgb(250, 176, 60),
    onWarning: rgb(45, 28, 4),
    warningContainer: rgb(60, 40, 12),
    onWarningContainer: rgb(252, 222, 150),

    info: rgb(156, 135, 245),
    onInfo: rgb(20, 14, 43),
    infoContainer: rgb(44, 32, 92),
    onInfoContainer: rgb(224, 217, 255),
  },
  effects: {
    glassBackground: rgba(20, 15, 35, 0.55),
    glassBorder: rgba(232, 225, 255, 0.08),
    glassBlur: 20,
    glassSaturation: 1.8,

    inputBackground: rgba(20, 15, 35, 0.55),
    inputBorder: rgba(232, 225, 255, 0.08),

    ...softShadows(),

    focusGlowColor: rgba(156, 135, 245, 0.24),
    avatarGlowColor: rgba(156, 135, 245, 0.3),

    ambientGlowPrimary: rgba(156, 135, 245, 0.2),
    ambientGlowSecondary: rgba(232, 121, 199, 0.14),

    ambientGlowOpacity: 1,

    scrollbarIdleOpacity: 0,
  },
};

export const INDIGO_TYPOGRAPHY = SHARED_TYPOGRAPHY;
