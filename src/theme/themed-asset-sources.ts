/**
 * Pure themed-artwork file resolution (no requires, no React — node-safe).
 * Maps the app's own theme identifiers to asset file names:
 * `icon-{variant}.png` / `splash-icon-{variant}.png`. The runtime `require()`
 * table lives in `themed-assets.ts` (Metro needs static requires); tests
 * assert against these file names plus on-disk existence.
 */
import {
  resolveThemeIconVariant,
  type ThemeIconVariant,
} from "@/modules/app-icon/theme-icon-variant";
import {
  DEFAULT_THEME_ID,
  isValidThemeId,
  type AppThemeId,
} from "@/theme/types";

export type ThemedAssetKind = "icon" | "splash";

export const THEMED_ASSET_FALLBACK_VARIANT: ThemeIconVariant = "aqua";

/** Asset file name for one kind + variant, e.g. `splash-icon-burnt.png`. */
export function themedAssetFileName(
  kind: ThemedAssetKind,
  variant: ThemeIconVariant,
): string {
  return kind === "splash"
    ? `splash-icon-${variant}.png`
    : `icon-${variant}.png`;
}

export function getThemedAssetFile(
  kind: ThemedAssetKind,
  themeId: AppThemeId | null | undefined,
  deviceScheme?: "light" | "dark" | null,
): string {
  // Canonical validity check: a theme added later is valid here as soon
  // as it joins AppThemeId, and always resolves to a real variant below.
  const safeThemeId: AppThemeId =
    themeId && isValidThemeId(themeId) ? themeId : DEFAULT_THEME_ID;
  if (themeId !== safeThemeId && typeof __DEV__ !== "undefined" && __DEV__) {
    console.warn(
      `[themed-assets] Unknown theme "${String(themeId)}" — falling back to "${DEFAULT_THEME_ID}".`,
    );
  }
  return themedAssetFileName(
    kind,
    resolveThemeIconVariant(safeThemeId, deviceScheme ?? null),
  );
}

/**
 * Guarantees a bundled file name for a resolved one. A theme or variant
 * added later whose artwork was never regenerated (`npm run
 * vendor:themed-icons`) — or whose `require()` entry is missing — falls back
 * to the default variant OF THE SAME KIND, so a splash never degrades into
 * the square app icon. Logs a dev warning instead of breaking the build or
 * rendering a broken image.
 */
export function resolveThemedAssetFile(
  kind: ThemedAssetKind,
  file: string,
  hasFile: (file: string) => boolean,
): string {
  if (hasFile(file)) {
    return file;
  }
  const fallback = themedAssetFileName(kind, THEMED_ASSET_FALLBACK_VARIANT);
  if (typeof __DEV__ !== "undefined" && __DEV__) {
    console.warn(
      `[themed-assets] Missing artwork "${file}" — falling back to "${fallback}".`,
    );
  }
  return fallback;
}
