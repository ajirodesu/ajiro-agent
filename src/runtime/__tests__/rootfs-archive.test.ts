import { describe, expect, it } from "vitest";

import { archiveFormatLabel, detectArchiveFormat } from "@/runtime/rootfsArchive";

describe("rootfsArchive", () => {
  it("detects the primary .tar.xz format", () => {
    expect(detectArchiveFormat("debian-bookworm-aarch64.tar.xz")).toBe("tar.xz");
    expect(detectArchiveFormat("rootfs.txz")).toBe("tar.xz");
    expect(detectArchiveFormat("  ROOTFS.TAR.XZ  ")).toBe("tar.xz");
  });

  it("accepts gzip and plain tar as a compatible superset", () => {
    expect(detectArchiveFormat("debian.tar.gz")).toBe("tar.gz");
    expect(detectArchiveFormat("debian.tgz")).toBe("tar.gz");
    expect(detectArchiveFormat("debian.tar")).toBe("tar");
  });

  it("rejects anything else before the bridge is ever called", () => {
    expect(detectArchiveFormat("debian.zip")).toBeNull();
    expect(detectArchiveFormat("debian.tar.xz.sig")).toBeNull();
    expect(detectArchiveFormat("")).toBeNull();
  });

  it("labels formats for progress messages", () => {
    expect(archiveFormatLabel("tar.xz")).toContain("xz");
    expect(archiveFormatLabel("tar.gz")).toContain("gzip");
    expect(archiveFormatLabel("tar")).toContain("uncompressed");
  });
});
