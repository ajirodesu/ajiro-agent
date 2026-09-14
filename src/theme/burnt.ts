/**
 * Burnt theme — warm charcoal, terracotta primary, cream text. Exact
 * reference palette. Container tones for error/success/warning/info follow
 * the reference dark-tint pattern (documented derivation where the
 * reference lists only the base semantic).
 */
import type { AppTheme } from "@/theme/types";
import { rgb, rgba, SHARED_TYPOGRAPHY, softShadows } from "@/theme/utils";

export const burntTheme: AppTheme = {
  id: "burnt",
  displayName: "Burnt",
  dark: true,
  lockedAccent: true,
  colors: {
    primary: rgb(218, 119, 86),
    onPrimary: rgb(255, 255, 255),
    primaryContainer: rgb(74, 40, 27),
    onPrimaryContainer: rgb(255, 214, 195),

    secondary: rgb(199, 178, 158),
    onSecondary: rgb(46, 34, 22),
    secondaryContainer: rgb(61, 48, 36),
    onSecondaryContainer: rgb(232, 218, 200),

    tertiary: rgb(156, 176, 132),
    onTertiary: rgb(20, 28, 12),
    tertiaryContainer: rgb(40, 51, 28),
    onTertiaryContainer: rgb(214, 227, 197),

    surface: rgb(17, 17, 16),
    onSurface: rgb(250, 249, 245),
    surfaceVariant: rgb(46, 44, 40),
    onSurfaceVariant: rgb(176, 174, 167),

    surfaceContainerLowest: rgb(10, 10, 9),
    surfaceContainerLow: rgb(13, 13, 12),
    surfaceContainer: rgb(22, 22, 20),
    surfaceContainerHigh: rgb(28, 27, 25),
    surfaceContainerHighest: rgb(35, 34, 31),

    surfaceBright: rgb(176, 174, 167),
    surfaceDim: rgb(10, 10, 9),

    inverseSurface: rgb(250, 249, 245),
    inverseOnSurface: rgb(17, 17, 16),
    inversePrimary: rgb(74, 40, 27),

    outline: rgb(138, 136, 130),
    outlineVariant: rgb(56, 54, 49),

    scrim: rgb(0, 0, 0),
    shadow: rgb(10, 8, 6),

    error: rgb(248, 96, 88),
    onError: rgb(255, 255, 255),
    errorContainer: rgb(62, 22, 19),
    onErrorContainer: rgb(255, 203, 196),

    success: rgb(134, 197, 116),
    onSuccess: rgb(14, 30, 12),
    successContainer: rgb(28, 48, 26),
    onSuccessContainer: rgb(209, 238, 200),

    warning: rgb(240, 180, 60),
    onWarning: rgb(43, 27, 4),
    warningContainer: rgb(58, 40, 12),
    onWarningContainer: rgb(252, 222, 150),

    info: rgb(130, 170, 220),
    onInfo: rgb(12, 24, 40),
    infoContainer: rgb(26, 44, 66),
    onInfoContainer: rgb(202, 222, 244),
  },
  effects: {
    glassBackground: rgba(32, 32, 30, 0.55),
    glassBorder: rgba(250, 249, 245, 0.1),
    glassBlur: 20,
    glassSaturation: 1.6,

    inputBackground: rgba(32, 32, 30, 0.55),
    inputBorder: rgba(250, 249, 245, 0.1),

    ...softShadows(),

    focusGlowColor: rgba(218, 119, 86, 0.22),
    avatarGlowColor: rgba(218, 119, 86, 0.3),

    ambientGlowPrimary: rgba(218, 119, 86, 0.16),
    ambientGlowSecondary: rgba(156, 176, 132, 0.12),

    ambientGlowOpacity: 1,

    scrollbarIdleOpacity: 0,
  },
};

export const BURNT_TYPOGRAPHY = SHARED_TYPOGRAPHY;
