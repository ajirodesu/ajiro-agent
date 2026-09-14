/**
 * Aqua theme — the new default. Exact reference palette (verified firsthand
 * against aqua.css): near-black teal surfaces, mint/spring-teal primary,
 * soft indigo tertiary, rose/green/amber semantics.
 */
import type { AppTheme } from "@/theme/types";
import { rgb, rgba, SHARED_TYPOGRAPHY, softShadows } from "@/theme/utils";

export const aquaTheme: AppTheme = {
  id: "aqua",
  displayName: "Aqua",
  dark: true,
  lockedAccent: true,
  colors: {
    primary: rgb(52, 224, 190),
    onPrimary: rgb(5, 26, 22),
    primaryContainer: rgb(7, 46, 38),
    onPrimaryContainer: rgb(199, 250, 232),

    secondary: rgb(148, 173, 168),
    onSecondary: rgb(13, 22, 20),
    secondaryContainer: rgb(26, 38, 36),
    onSecondaryContainer: rgb(205, 224, 219),

    tertiary: rgb(129, 140, 248),
    onTertiary: rgb(15, 15, 35),
    tertiaryContainer: rgb(30, 27, 66),
    onTertiaryContainer: rgb(199, 199, 255),

    surface: rgb(7, 14, 17),
    onSurface: rgb(240, 247, 245),
    surfaceVariant: rgb(65, 80, 77),
    onSurfaceVariant: rgb(152, 168, 164),

    surfaceContainerLowest: rgb(3, 7, 9),
    surfaceContainerLow: rgb(10, 17, 20),
    surfaceContainer: rgb(14, 22, 25),
    surfaceContainerHigh: rgb(19, 29, 32),
    surfaceContainerHighest: rgb(26, 38, 41),

    surfaceBright: rgb(152, 168, 164),
    surfaceDim: rgb(3, 7, 9),

    inverseSurface: rgb(240, 247, 245),
    inverseOnSurface: rgb(7, 14, 17),
    inversePrimary: rgb(7, 46, 38),

    outline: rgb(96, 113, 109),
    outlineVariant: rgb(42, 54, 52),

    scrim: rgb(0, 0, 0),
    shadow: rgb(2, 6, 8),

    error: rgb(244, 63, 94),
    onError: rgb(255, 255, 255),
    errorContainer: rgb(46, 16, 26),
    onErrorContainer: rgb(253, 164, 175),

    success: rgb(74, 222, 128),
    onSuccess: rgb(4, 26, 15),
    successContainer: rgb(12, 42, 26),
    onSuccessContainer: rgb(166, 244, 190),

    warning: rgb(245, 158, 11),
    onWarning: rgb(38, 22, 0),
    warningContainer: rgb(46, 32, 10),
    onWarningContainer: rgb(252, 211, 120),

    info: rgb(52, 224, 190),
    onInfo: rgb(4, 26, 22),
    infoContainer: rgb(8, 35, 30),
    onInfoContainer: rgb(183, 245, 224),
  },
  effects: {
    glassBackground: rgba(14, 22, 25, 0.55),
    glassBorder: rgba(255, 255, 255, 0.08),
    glassBlur: 20,
    glassSaturation: 1.8,

    inputBackground: rgba(14, 22, 25, 0.55),
    inputBorder: rgba(255, 255, 255, 0.08),

    ...softShadows(),

    focusGlowColor: rgba(52, 224, 190, 0.24),
    avatarGlowColor: rgba(52, 224, 190, 0.35),

    ambientGlowPrimary: rgba(52, 224, 190, 0.2),
    ambientGlowSecondary: rgba(129, 140, 248, 0.14),

    ambientGlowOpacity: 1,

    scrollbarIdleOpacity: 0,
  },
};

export const AQUA_TYPOGRAPHY = SHARED_TYPOGRAPHY;
