/**
 * Device camera capture: asks the user for permission, then opens the
 * device's current camera app via ACTION_IMAGE_CAPTURE and imports the
 * returned photo into the workspace.
 *
 * Platform facts (verified against the bundled expo-intent-launcher native
 * module):
 * - Intent extras cross the JS bridge as primitives only, so EXTRA_OUTPUT
 *   cannot be delivered as the Uri Parcelable cameras require. The capture
 *   therefore fires a bare ACTION_IMAGE_CAPTURE intent.
 * - The bridge resolves with { resultCode, data?, extra? } where `data` is
 *   the result Intent's data URI string when the camera sets one.
 * - Firing the intent needs no CAMERA runtime permission of our own; the
 *   camera app captures with its own permission.
 * - Platform access is injected so this module stays pure and unit-tested;
 *   the composer wires the real expo modules on device.
 *
 * Source provenance: [ANDROID] intent flow; [AJIRO ORIGINAL] module shape.
 */

export const IMAGE_CAPTURE_ACTION = "android.media.action.IMAGE_CAPTURE";
export const RESULT_OK = -1;
export const RESULT_CANCELED = 0;

export type CameraCaptureDeps = {
  startCameraActivity: () => Promise<{ resultCode: number; data?: string }>;
};

export type CameraCaptureResult =
  | { ok: true; photoUri: string }
  | { ok: false; reason: "cancelled" | "failed"; message: string };

/**
 * Run one capture round-trip. Never throws: every outcome becomes a typed
 * result. A success without a returned URI is reported as failed (with an
 * actionable message) rather than fabricated.
 */
export async function capturePhoto(
  deps: CameraCaptureDeps,
): Promise<CameraCaptureResult> {
  let result: { resultCode: number; data?: string };
  try {
    result = await deps.startCameraActivity();
  } catch (error) {
    return {
      ok: false,
      reason: "failed",
      message: `The camera app could not be opened: ${messageOf(error)}`,
    };
  }

  if (result.resultCode === RESULT_CANCELED) {
    return { ok: false, reason: "cancelled", message: "Capture cancelled." };
  }

  if (result.resultCode !== RESULT_OK) {
    return {
      ok: false,
      reason: "failed",
      message: "The camera app did not return a photo.",
    };
  }

  if (result.data) {
    return { ok: true, photoUri: result.data };
  }

  return {
    ok: false,
    reason: "failed",
    message:
      "This camera app did not return the photo. Use Upload File to attach it instead.",
  };
}

export function buildCaptureFileName(timestamp: number): string {
  return `photo-${timestamp}.jpg`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
