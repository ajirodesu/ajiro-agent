/**
 * Central themed app-artwork resolution (`icon` + `splash-icon`).
 *
 * Single source of truth for "which artwork matches the active theme":
 * file names come from `themed-asset-sources.ts` (pure, tested), theme
 * identifiers from the app's own theming system (`AppThemeId`), variant
 * resolution shared with the launcher-icon switcher. Every consumer —
 * splash overlay, about screen, empty-chat illustration — resolves through
 * `getThemedIconSource` / `useThemedIconSource`. No parallel theme
 * tracking, no per-screen mapping tables.
 *
 * Metro requires static `require()` calls, so the table below keys every
 * file the resolver can produce; unknown themes fall back to the default
 * artwork instead of breaking.
 */
import { useColorScheme } from "react-native";

import { useAppTheme } from "@/hooks/use-app-theme";
import {
  getThemedAssetFile,
  resolveThemedAssetFile,
  themedAssetFileName,
  THEMED_ASSET_FALLBACK_VARIANT,
  type ThemedAssetKind,
} from "@/theme/themed-asset-sources";
import type { AppThemeId } from "@/theme/types";

export type { ThemedAssetKind };
export { THEMED_ASSET_FALLBACK_VARIANT, themedAssetFileName };

const SOURCES: Record<string, number> = {
  "icon-aqua.png": require("../../assets/images/icon-aqua.png"),
  "icon-burnt.png": require("../../assets/images/icon-burnt.png"),
  "icon-indigo.png": require("../../assets/images/icon-indigo.png"),
  "icon-dark.png": require("../../assets/images/icon-dark.png"),
  "icon-light.png": require("../../assets/images/icon-light.png"),
  "splash-icon-aqua.png": require("../../assets/images/splash-icon-aqua.png"),
  "splash-icon-burnt.png": require("../../assets/images/splash-icon-burnt.png"),
  "splash-icon-indigo.png": require("../../assets/images/splash-icon-indigo.png"),
  "splash-icon-dark.png": require("../../assets/images/splash-icon-dark.png"),
  "splash-icon-light.png": require("../../assets/images/splash-icon-light.png"),
};

export function getThemedIconSource(
  kind: ThemedAssetKind,
  themeId: AppThemeId | null | undefined,
  deviceScheme?: "light" | "dark" | null,
): number | undefined {
  const file = getThemedAssetFile(kind, themeId, deviceScheme);
  const resolved = resolveThemedAssetFile(kind, file, (name) => name in SOURCES);
  // Last resort only if the default variant is somehow absent from the
  // bundle too: the base app icon. Nothing renders as a broken image.
  return (
    SOURCES[resolved] ??
    SOURCES[themedAssetFileName("icon", THEMED_ASSET_FALLBACK_VARIANT)]
  );
}

/**
 * Reactive artwork source for the active theme. Derives synchronously
 * from the app theme state on every render, so rapid theme toggles can
 * never show a stale icon (no async loading, no cached theme copy).
 * `system` resolves through the device scheme, never left unresolved.
 */
export function useThemedIconSource(
  kind: ThemedAssetKind,
): number | undefined {
  const { themeId } = useAppTheme();
  const deviceScheme = useColorScheme();
  const scheme =
    deviceScheme === "dark" || deviceScheme === "light" ? deviceScheme : null;
  return getThemedIconSource(kind, themeId, scheme);
}
