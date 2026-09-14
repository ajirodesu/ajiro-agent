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

Anything else fails closed in `detectArchiveFormat` before the native
bridge is ever called. Device nodes / fifos / sockets inside the archive
are skipped and counted (PRoot provides `/dev` itself); the skip count is
reported in the extraction-complete message and must stay small for a
healthy rootfs.

Never commit large binaries unintentionally — keep `*.tar.xz` git-ignored
unless you explicitly choose bundled distribution.
