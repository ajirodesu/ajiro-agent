import { describe, expect, it } from "vitest";

import {
  downloadAndVerifyUserspace,
  parseProvisionManifest,
  type ProvisionState,
} from "@/modules/runtime/provision-download";

const MANIFEST = JSON.stringify({
  version: "2026.09.01",
  userspace: {
    url: "https://example.com/linux.tar.zst",
    sha256: "a".repeat(64),
    sizeBytes: 123456,
  },
});

describe("provision download", () => {
  it("validates manifests strictly", () => {
    expect(parseProvisionManifest(MANIFEST).version).toBe("2026.09.01");
    expect(() => parseProvisionManifest("nope")).toThrow();
    expect(() =>
      parseProvisionManifest(JSON.stringify({ version: "x" })),
    ).toThrow();
    expect(() =>
      parseProvisionManifest(
        JSON.stringify({
          version: "1",
          userspace: { url: "http://insecure/x", sha256: "a".repeat(64), sizeBytes: 1 },
        }),
      ),
    ).toThrow();
  });

  it("downloads and verifies, emitting states", async () => {
    const states: ProvisionState[] = [];
    const path = await downloadAndVerifyUserspace(
      "https://example.com/manifest.json",
      "/tmp/linux.tar.zst",
      {
        fetchText: async () => MANIFEST,
        downloadFile: async (url, dest, onProgress) => {
          expect(url).toBe("https://example.com/linux.tar.zst");
          onProgress?.(10, 100);
        },
        computeSha256: async () => "A".repeat(64),
      },
      (state) => {
        states.push(state);
      },
    );
    expect(path).toBe("/tmp/linux.tar.zst");
    expect(states.map((state) => state.state)).toEqual([
      "downloading",
      "verifying",
      "ready",
    ]);
  });

  it("rejects checksum mismatches", async () => {
    await expect(
      downloadAndVerifyUserspace("https://example.com/manifest.json", "/tmp/x", {
        fetchText: async () => MANIFEST,
        downloadFile: async () => {},
        computeSha256: async () => "b".repeat(64),
      }),
    ).rejects.toThrow(/Checksum mismatch/);
  });
});
