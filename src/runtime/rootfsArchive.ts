/**
 * Rootfs archive format detection (pure, unit-tested).
 *
 * The native extractor (`RootfsExtractor.kt`) supports `.tar.xz` (primary,
 * per the embedded-distribution spec), plus `.tar.gz`/`.tgz` and plain
 * `.tar` as a compatible superset. Anything else fails closed before the
 * bridge is ever called.
 */

export type RootfsArchiveFormat = "tar.xz" | "tar.gz" | "tar";

const TAR_XZ = [".tar.xz", ".txz"] as const;
const TAR_GZ = [".tar.gz", ".tgz"] as const;

export function detectArchiveFormat(fileName: string): RootfsArchiveFormat | null {
  const lower = fileName.trim().toLowerCase();
  if (TAR_XZ.some((suffix) => lower.endsWith(suffix))) return "tar.xz";
  if (TAR_GZ.some((suffix) => lower.endsWith(suffix))) return "tar.gz";
  if (lower.endsWith(".tar")) return "tar";
  return null;
}

export function archiveFormatLabel(format: RootfsArchiveFormat): string {
  switch (format) {
    case "tar.xz":
      return "xz-compressed tar";
    case "tar.gz":
      return "gzip-compressed tar";
    case "tar":
      return "uncompressed tar";
  }
}
