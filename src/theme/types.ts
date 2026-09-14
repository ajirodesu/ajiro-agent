/**
 * Central typed theme model (prompt §11-12). All color/effect state flows
 * through here; UI components consume semantic tokens, never raw hex.
 *
 * Source provenance: token SHAPES follow the harness spec [AJIRO ORIGINAL];
 * aqua/burnt/indigo VALUES are the reference palettes [ANTHROPIC-adjacent
 * open source: Persian-Bot theme files, verified firsthand for aqua].
 */
export type LegacyThemeId = "system" | "light" | "dark";
export type NewThemeId = "aqua" | "burnt" | "indigo";
export type AppThemeId = LegacyThemeId | NewThemeId;

/** New default theme for fresh installations with no stored preference. */
export const DEFAULT_THEME_ID: AppThemeId = "aqua";

const ALL_THEME_IDS: readonly AppThemeId[] = [
  "system",
  "light",
  "dark",
  "aqua",
  "burnt",
  "indigo",
];

export function isValidThemeId(value: unknown): value is AppThemeId {
  return (
    typeof value === "string" &&
    (ALL_THEME_IDS as readonly string[]).includes(value)
  );
}

export function isNewThemeId(id: AppThemeId): id is NewThemeId {
  return id === "aqua" || id === "burnt" || id === "indigo";
}

export interface ThemeColors {
  primary: string;
  onPrimary: string;
  primaryContainer: string;
  onPrimaryContainer: string;

  secondary: string;
  onSecondary: string;
  secondaryContainer: string;
  onSecondaryContainer: string;

  tertiary: string;
  onTertiary: string;
  tertiaryContainer: string;
  onTertiaryContainer: string;

  surface: string;
  onSurface: string;
  surfaceVariant: string;
  onSurfaceVariant: string;

  surfaceContainerLowest: string;
  surfaceContainerLow: string;
  surfaceContainer: string;
  surfaceContainerHigh: string;
  surfaceContainerHighest: string;

  surfaceBright: string;
  surfaceDim: string;

  inverseSurface: string;
  inverseOnSurface: string;
  inversePrimary: string;

  outline: string;
  outlineVariant: string;

  scrim: string;
  shadow: string;

  error: string;
  onError: string;
  errorContainer: string;
  onErrorContainer: string;

  success: string;
  onSuccess: string;
  successContainer: string;
  onSuccessContainer: string;

  warning: string;
  onWarning: string;
  warningContainer: string;
  onWarningContainer: string;

  info: string;
  onInfo: string;
  infoContainer: string;
  onInfoContainer: string;
}

export interface RnShadow {
  shadowColor: string;
  shadowOffset: { width: number; height: number };
  shadowOpacity: number;
  shadowRadius: number;
  elevation: number;
}

export interface ThemeEffects {
  glassBackground: string;
  glassBorder: string;
  /** Stored blur radius (20px equivalent); applied where a BlurView exists. */
  glassBlur: number;
  glassSaturation: number;

  inputBackground: string;
  inputBorder: string;

  shadowSoftSm: RnShadow;
  shadowSoftMd: RnShadow;
  shadowSoftLg: RnShadow;

  shadowCardRest: RnShadow;
  shadowCardHover: RnShadow;

  focusGlowColor: string;
  avatarGlowColor: string;

  ambientGlowPrimary: string;
  ambientGlowSecondary: string;

  ambientGlowOpacity: number;

  scrollbarIdleOpacity: number;
}

export interface ThemeTypography {
  /** Shared UI/body family (system stack — no new font dependency). */
  ui: string;
  /** Shared brand/display family (system serif — no new font dependency). */
  brand: string;
  /** Shared monospace family (system mono — no new font dependency). */
  mono: string;
}

export interface AppTheme {
  id: AppThemeId;
  displayName: string;
  /** All three new themes are deliberately dark. */
  dark: boolean;
  /** New themes own their accent; legacy themes keep token behavior. */
  lockedAccent: boolean;
  colors: ThemeColors;
  effects: ThemeEffects;
}
