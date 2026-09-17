import { beforeEach, describe, expect, it, vi } from "vitest";

import * as Updates from "expo-updates";
import { UpdateCheckResultNotAvailableReason } from "expo-updates";
import {
  applyOtaUpdate,
  checkForCompatibleUpdate,
  downloadOtaUpdate,
  type OtaApi,
} from "../ota";

vi.mock("expo-updates", () => ({
  UpdateCheckResultNotAvailableReason: {
    NO_UPDATE_AVAILABLE_ON_SERVER: "noUpdateAvailableOnServer",
  },
  fetchUpdateAsync: vi.fn(),
  isEnabled: true,
  checkForUpdateAsync: vi.fn(),
  reloadAsync: vi.fn(),
  runtimeVersion: "1.1.5",
}));

const api = Updates as unknown as OtaApi;

describe("ota update strategy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.checkForUpdateAsync).mockResolvedValue({
      isAvailable: false,
      isRollBackToEmbedded: false,
      manifest: undefined,
      reason: UpdateCheckResultNotAvailableReason.NO_UPDATE_AVAILABLE_ON_SERVER,
    });
  });

  it("reports unavailable when the native runtime has no update module", async () => {
    const disabled = { ...api, isEnabled: false };
    expect(await checkForCompatibleUpdate(disabled)).toEqual({
      available: false,
      reason: "unavailable",
    });
    expect(await downloadOtaUpdate(disabled)).toBe(false);
  });

  it("reports up-to-date when no update is available", async () => {
    expect(await checkForCompatibleUpdate(api)).toEqual({
      available: false,
      reason: "up-to-date",
    });
  });

  it("accepts updates targeting the installed runtime", async () => {
    vi.mocked(api.checkForUpdateAsync).mockResolvedValue({
      isAvailable: true,
      isRollBackToEmbedded: false,
      manifest: { runtimeVersion: "1.1.5" } as never,
      reason: undefined,
    });
    expect(await checkForCompatibleUpdate(api)).toMatchObject({
      available: true,
      compatible: true,
      runtimeVersion: "1.1.5",
    });
  });

  it("refuses updates targeting a different native runtime", async () => {
    vi.mocked(api.checkForUpdateAsync).mockResolvedValue({
      isAvailable: true,
      isRollBackToEmbedded: false,
      manifest: { runtimeVersion: "2.0.0" } as never,
      reason: undefined,
    });
    const result = await checkForCompatibleUpdate(api);
    expect(result).toMatchObject({ available: true, compatible: false });
    if (result.available) {
      expect(result.reason).toMatch(/2\.0\.0/);
    }
  });

  it("stages compatible updates and applies on restart", async () => {
    vi.mocked(api.fetchUpdateAsync).mockResolvedValue({ isNew: true } as never);
    expect(await downloadOtaUpdate(api)).toBe(true);
    await applyOtaUpdate(api);
    expect(vi.mocked(api.reloadAsync)).toHaveBeenCalledTimes(1);
  });

  it("fails closed when staging throws", async () => {
    vi.mocked(api.fetchUpdateAsync).mockRejectedValue(new Error("offline"));
    expect(await downloadOtaUpdate(api)).toBe(false);
  });
});
