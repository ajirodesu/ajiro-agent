# Debian Bookworm ARM64 rootfs

The on-device Linux runtime expects a minimal Debian Bookworm `aarch64`
rootfs (`.tar.xz`, glibc) containing at least:

- `/bin/bash`, `/bin/sh`
- `/usr/bin`, `/etc`, `/proc`, `/sys`, `/dev`
- `/workspace` (coding-agent workspace, created if missing)

Two supported provisioning paths:

1. **Bundled (offline):** place `debian-bookworm-aarch64.tar.xz` in this
   directory and wire it into `RootfsManager.initialize()` (or extend the
   native extractor). Keeps everything fully on-device.
2. **Downloadable (light APK):** host the archive remotely and pass its URL
   to `linuxAgentRuntime.startRuntime(url)` / `rootfsManager.initialize({ url })`.
   Progress is reported via `onProgress`.

`RootfsManager` validates the extraction (`.ready` marker + version file)
and refuses to mark the runtime ready when validation fails. Never commit
large binaries unintentionally — keep `*.tar.xz` git-ignored unless you
explicitly choose bundled distribution.
