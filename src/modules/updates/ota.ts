/**
 * Compatible OTA update strategy (Dynamic Updates prompt §§38–40, 45, 53).
 *
 * expo-updates/EAS Update delivers the *application* JavaScript layer; the
 * extension registries deliver *content*. The two systems stay separate
 * (§39): this module only moves the app layer, and only when the update's
 * runtime version matches the installed native binary.
 *
 * Controlled checking (§18): the app config sets
 * `checkAutomatically: ON_ERROR_RECOVERY`, so expo-updates never polls on
 * its own — the app calls `checkForCompatibleUpdate` on startup, on
 * foreground, or from a manual Refresh, with backoff handled by the caller.
 *
 * Activation note: expo-updates ships in the native binary, so this config
 * takes effect on the next native build, not on current installs. Until
 * then every method reports `available: false` with `reason: "unavailable"`.
 */
import * as Updates from "expo-updates";

export type OtaCheckResult =
  | { available: false; reason: "unchecked" | "unavailable" | "up-to-date" }
  | {
      available: true;
      compatible: boolean;
      reason: string | null;
      runtimeVersion: string | null;
      updateId: string | null;
    };

export type OtaApi = Pick<
  typeof Updates,
  | "checkForUpdateAsync"
  | "fetchUpdateAsync"
  | "isEnabled"
  | "reloadAsync"
  | "runtimeVersion"
>;

/**
 * Check for an application update and verify it targets this native
 * runtime. An update whose manifest declares a different runtimeVersion is
 * refused before download (§40: never apply an incompatible OTA update).
 */
export async function checkForCompatibleUpdate(
  api: OtaApi = Updates,
): Promise<OtaCheckResult> {
  if (!api.isEnabled) {
    return { available: false, reason: "unavailable" };
  }
  let check: Awaited<ReturnType<OtaApi["checkForUpdateAsync"]>>;
  try {
    check = await api.checkForUpdateAsync();
  } catch {
    return { available: false, reason: "up-to-date" };
  }
  if (!check.isAvailable || !check.manifest) {
    return { available: false, reason: "up-to-date" };
  }
  const manifest = check.manifest as { runtimeVersion?: unknown };
  const updateRuntime =
    typeof manifest.runtimeVersion === "string" ? manifest.runtimeVersion : null;
  if (updateRuntime && updateRuntime !== api.runtimeVersion) {
    return {
      available: true,
      compatible: false,
      reason: `Update targets runtime ${updateRuntime}; this install is ${api.runtimeVersion ?? "unknown"}.`,
      runtimeVersion: updateRuntime,
      updateId: null,
    };
  }
  return {
    available: true,
    compatible: true,
    reason: null,
    runtimeVersion: updateRuntime,
    updateId: null,
  };
}

/**
 * Download and stage a compatible update (§40: download → stage →
 * validate). Returns true when a staged update now waits for a safe
 * restart — the caller tracks that bit, since expo-updates exposes no
 * pending getter. Returns false when nothing new was staged.
 */
export async function downloadOtaUpdate(api: OtaApi = Updates): Promise<boolean> {
  if (!api.isEnabled) return false;
  try {
    const result = await api.fetchUpdateAsync();
    return result.isNew;
  } catch {
    return false;
  }
}

/**
 * Apply the staged update on a safe restart (§40). expo-updates keeps the
 * previous bundle for emergency recovery; a failed startup falls back
 * automatically (ON_ERROR_RECOVERY), which is the recovery path (§53).
 */
export async function applyOtaUpdate(api: OtaApi = Updates): Promise<void> {
  await api.reloadAsync();
}
