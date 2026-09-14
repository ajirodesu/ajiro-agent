/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useConfig } from '@/hooks/use-config';
import { resolveAppTheme, toLegacyPalette } from '@/theme/themes';
import { isValidThemeId, type AppThemeId } from '@/theme/types';

export function useTheme() {
  const scheme = useColorScheme();
  // New built-ins re-skin every existing component through the legacy
  // palette shape; legacy ids return the static palettes untouched.
  // Components rendered above AppStateProvider (splash banners) fall back
  // to the static palettes.
  let themeId: AppThemeId | null = null;
  try {
    const raw = useConfig().themeId;
    themeId = isValidThemeId(raw) ? raw : null;
  } catch {
    themeId = null;
  }
  if (
    themeId === null ||
    themeId === "system" ||
    themeId === "light" ||
    themeId === "dark"
  ) {
    return Colors[scheme];
  }
  return toLegacyPalette(
    resolveAppTheme(themeId, scheme === "dark" ? "dark" : "light"),
  );
}
