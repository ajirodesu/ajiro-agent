import { describe, expect, it } from "vitest";

import {
  buildCaptureFileName,
  capturePhoto,
  type CameraCaptureDeps,
} from "@/modules/device/camera-capture";

function deps(overrides: Partial<CameraCaptureDeps> = {}): CameraCaptureDeps {
  return {
    startCameraActivity: async () => ({
      resultCode: -1,
      data: "content://camera/42",
    }),
    ...overrides,
  };
}

describe("camera capture", () => {
  it("builds timestamped file names", () => {
    expect(buildCaptureFileName(99)).toBe("photo-99.jpg");
  });

  it("returns the camera-provided photo URI on success", async () => {
    const result = await capturePhoto(deps());
    expect(result).toEqual({ ok: true, photoUri: "content://camera/42" });
  });

  it("reports cancellation", async () => {
    const result = await capturePhoto(
      deps({ startCameraActivity: async () => ({ resultCode: 0 }) }),
    );
    expect(result).toMatchObject({ ok: false, reason: "cancelled" });
  });

  it("fails honestly when no URI comes back", async () => {
    const result = await capturePhoto(
      deps({ startCameraActivity: async () => ({ resultCode: -1 }) }),
    );
    expect(result).toMatchObject({ ok: false, reason: "failed" });
  });

  it("fails honestly on unexpected result codes", async () => {
    const result = await capturePhoto(
      deps({ startCameraActivity: async () => ({ resultCode: 7 }) }),
    );
    expect(result).toMatchObject({ ok: false, reason: "failed" });
  });

  it("fails honestly when the camera cannot open", async () => {
    const result = await capturePhoto(
      deps({
        startCameraActivity: async () => {
          throw new Error("No Activity found");
        },
      }),
    );
    expect(result).toMatchObject({ ok: false, reason: "failed" });
  });
});
