/**
 * App theme access (§23): extends (never replaces) the existing provider.
 * Returns the resolved semantic theme, effects, typography, locked accent,
 * and setters. Legacy ids behave exactly as before.
 */
import { useColorScheme } from "react-native";

import { useConfig } from "@/hooks/use-config";
import {
  resolveAccent,
  resolveAppTheme,
  type AppTheme,
} from "@/theme/themes";
import type { AppThemeId } from "@/theme/types";

export type AppThemeValue = {
  themeId: AppThemeId;
  theme: AppTheme;
  accent: string;
  setTheme: (id: AppThemeId) => Promise<void>;
  setAccent: (value: string | null) => Promise<void>;
};

export function useAppTheme(): AppThemeValue {
  const {
    themeId,
    accentColor,
    updateThemeId,
    updateAccentColor,
  } = useConfig();
  const deviceScheme = useColorScheme();
  const theme = resolveAppTheme(
    themeId,
    deviceScheme === "dark" ? "dark" : "light",
  );
  return {
    themeId,
    theme,
    accent: resolveAccent(theme, accentColor),
    setTheme: updateThemeId,
    setAccent: updateAccentColor,
  };
}
