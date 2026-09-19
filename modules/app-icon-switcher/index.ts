import { requireNativeModule } from 'expo'
import { Platform } from 'react-native'

type AppIconSwitcherModule = {
  /**
   * Enable the themed launcher alias and disable the rest.
   * Pass null to restore the default launcher activity icon.
   * The suffix is the activity-alias short name, e.g. "ThemedIconBurnt".
   */
  setThemedIconAlias(aliasSuffix: string | null): Promise<void>
}

const AppIconSwitcher = Platform.OS === 'android'
  ? requireNativeModule<AppIconSwitcherModule>('AppIconSwitcher')
  : null

/**
 * Switch the launcher icon. Android-only; safe no-op elsewhere.
 * Never throws: failures become console errors so theme changes (and
 * startup) can never break because of the icon.
 */
export async function setThemedIconAlias(
  aliasSuffix: string | null,
): Promise<void> {
  if (Platform.OS !== 'android' || !AppIconSwitcher) return
  try {
    await AppIconSwitcher.setThemedIconAlias(aliasSuffix)
  } catch (e) {
    console.error('[AppIconSwitcher] setThemedIconAlias() failed:', e)
  }
}
