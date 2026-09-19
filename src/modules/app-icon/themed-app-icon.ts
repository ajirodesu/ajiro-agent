/**
 * Applies the launcher icon matching the active theme. Android-only:
 * iOS has no Expo-supported alternate-icon API, so it keeps the default
 * icon (documented limitation, not a failure). Never throws — theme
 * changes and startup must not break because of the icon.
 */
import { Platform } from "react-native";

import { setThemedIconAlias } from "app-icon-switcher";
import type { AppThemeId } from "@/theme/types";
import { createAliasQueue } from "@/modules/app-icon/alias-queue";
import {
  aliasSuffixForVariant,
  resolveThemeIconVariant,
} from "@/modules/app-icon/theme-icon-variant";

/**
 * One queue for the whole process, so rapid theme toggles cannot interleave
 * native calls or land out of order (see `alias-queue.ts`).
 */
const enqueueAlias = createAliasQueue(setThemedIconAlias);

export async function applyThemedAppIcon(
  themeId: AppThemeId,
  deviceScheme: "light" | "dark" | null | undefined,
): Promise<void> {
  if (Platform.OS !== "android") {
    return;
  }
  const variant = resolveThemeIconVariant(themeId, deviceScheme);
  await enqueueAlias(aliasSuffixForVariant(variant));
}
