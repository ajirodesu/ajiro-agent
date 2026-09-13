/**
 * Device-local APK installation (§52): permission + confirmation gate, then
 * hand-off to the platform installer. Never silent: the caller must confirm
 * (staged-write approval) before `installApk` runs, and the OS shows its own
 * install prompt.
 *
 * Source provenance: [ANDROID] package-installer flow; [AJIRO ORIGINAL]
 * gating. The actual install intent delegates to the platform layer through
 * an injected `openInstaller` so this module stays unit-testable.
 */
import { advanceStagedWrite, proposeStagedWrite } from "@/modules/safety/staged-writes";

export type ApkInstallRequest = {
  uri: string;
  label?: string;
};

export type ApkInstallResult =
  | { ok: true; stage: "installer-opened" }
  | { ok: false; error: string };

/**
 * Request an install: builds the staged write the user must approve.
 * Returns the staged write id for the approval UI to track.
 */
export function requestApkInstall(request: ApkInstallRequest) {
  if (!request.uri || typeof request.uri !== "string") {
    throw new Error("APK installation requires a package uri.");
  }
  return proposeStagedWrite({
    kind: "apk-install",
    summary: `Install ${request.label ?? "app update"} from ${request.uri}`,
    detail: { uri: request.uri, label: request.label ?? null },
  });
}

/**
 * Perform the install after staged approval. `openInstaller` launches the
 * platform package installer for the uri.
 */
export async function installApk(
  approvedStage: { status: string; detail: Record<string, unknown> },
  openInstaller: (uri: string) => Promise<void>,
): Promise<ApkInstallResult> {
  if (approvedStage.status !== "approved") {
    return { ok: false, error: "APK installation was not approved." };
  }
  const uri = approvedStage.detail.uri;
  if (typeof uri !== "string" || !uri) {
    return { ok: false, error: "Approved install is missing a package uri." };
  }
  try {
    await openInstaller(uri);
    return { ok: true, stage: "installer-opened" };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export { advanceStagedWrite };
