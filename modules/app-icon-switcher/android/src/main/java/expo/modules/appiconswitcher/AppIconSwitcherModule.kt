package expo.modules.appiconswitcher

import android.content.ComponentName
import android.content.pm.PackageManager
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Switches the launcher icon between the default activity and the
 * theme-specific activity-aliases installed by the with-themed-app-icon
 * config plugin. Exactly one launcher component is enabled at a time;
 * DONT_KILL_APP keeps the switch from restarting the process.
 */
class AppIconSwitcherModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AppIconSwitcher")

    AsyncFunction("setThemedIconAlias") { aliasSuffix: String? ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      val packageManager = context.packageManager
      val packageName = context.packageName

      val aliases = listOf(
        "ThemedIconBurnt",
        "ThemedIconIndigo",
        "ThemedIconDark",
        "ThemedIconLight",
      )
      for (alias in aliases) {
        val state = if (alias == aliasSuffix) {
          PackageManager.COMPONENT_ENABLED_STATE_ENABLED
        } else {
          PackageManager.COMPONENT_ENABLED_STATE_DISABLED
        }
        packageManager.setComponentEnabledSetting(
          ComponentName(packageName, "$packageName.$alias"),
          state,
          PackageManager.DONT_KILL_APP,
        )
      }
      packageManager.setComponentEnabledSetting(
        ComponentName(packageName, "$packageName.MainActivity"),
        if (aliasSuffix == null) {
          PackageManager.COMPONENT_ENABLED_STATE_ENABLED
        } else {
          PackageManager.COMPONENT_ENABLED_STATE_DISABLED
        },
        PackageManager.DONT_KILL_APP,
      )
      Unit
    }
  }
}
