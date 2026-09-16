# Debian Bookworm ARM64 rootfs

The on-device Linux runtime expects a minimal Debian Bookworm `aarch64`
rootfs containing at least:

- `/bin/bash`, `/bin/sh`
- `/usr/bin`, `/etc`, `/proc`, `/sys`, `/dev`
- `/workspace` (coding-agent workspace, created if missing)

## Provisioning paths

1. **Downloadable (light APK, recommended):** host the archive remotely and
   pass its URL to `linuxAgentRuntime.startRuntime(url)` /
   `rootfsManager.initialize({ url })`. Download + extraction report
   progress; extraction runs natively (`RootfsExtractor.kt`:
   commons-compress + Tukaani XZ, symlink/hardlink recreation, exec-bit
   preservation, path-traversal guard).
2. **Bundled (offline):** place `debian-bookworm-aarch64.tar.xz` in this
   directory, resolve it with `expo-asset`
   (`Asset.fromModule(require(...)).downloadAsync()`), and pass its
   `localUri` as `rootfsManager.initialize({ archiveUri })`.

## Supported formats

- `.tar.xz` / `.txz` — primary format, per the embedded-distribution spec.
- `.tar.gz` / `.tgz` and plain `.tar` — accepted as a compatible superset
  (same native extractor, gzip stdlib path).

## Verified reference artifact (checked 2026-09-14)

- URL: https://github.com/termux/proot-distro/releases/download/v4.17.3/debian-bookworm-aarch64-pd-v4.17.3.tar.xz
- Size: 42,912,980 bytes (byte-exact download)
- SHA-256: `3a841a794ae5999b33e33b329582ed0379d4f54ca62c6ce5a8eb9cff5ef8900b`
  (no publisher-published hash for this release; identity established by
  content validation below)
- Content: Debian **12.8** (`etc/debian_version`), merged-`/usr` layout
  (`bin → usr/bin` symlink, `usr/bin/bash` = 1.3 MB aarch64 ELF, glibc
  interpreter `lib/ld-linux-aarch64.so.1`, mode 755), `dash` present
- Census: 10,196 members — 8002 files, 1161 dirs, 1025 symlinks,
  0 hardlinks, 8 char devices (skipped by the extractor, counted),
  0 traversal violations; 221.5 MB uncompressed
- Single top-level wrapper dir → configure **`stripComponents: 1`**
  (`initialize({ url, stripComponents: 1 })`)
- `proc`/`sys`/`dev` ship as empty dirs; `workspace` is absent and
  auto-created by `finalize()` — validation passes on this exact tarball

Expected extraction report on-device: 8002 files, ~1160 dirs, 1025 links,
8 skipped. If your numbers differ materially, the archive is suspect.

Never commit large binaries unintentionally — keep `*.tar.xz` git-ignored
unless you explicitly choose bundled distribution.
