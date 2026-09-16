# PRoot binary (arm64-v8a) — SHIPPED

`libproot.so` (280,880 bytes) is a packaged executable-format PRoot binary.
Gradle only packages `lib*.so` from `jniLibs`; at first spawn
`TerminalPtyModule.ensureProotExecutable()` copies it to `files/bin/proot`
and `chmod 700`s it.

## Provenance (verified 2026-09-14)

- Source: https://github.com/ahmed-alnassif/proot/releases
  (automated Android NDK builds of the official Termux fork
  https://github.com/termux/proot, talloc statically linked)
- Release: `v26.08.25-7266fb3` (published 2026-08-25), asset
  `proot-aarch64.zip`
- SHA-256 of the zip matches the release's published `checksums.txt`:
  `045ced0a516d0ec419e11ff8cafdb641fb490ea49fc747704fedecc88cab1155`
- ELF validation performed on the extracted `proot` binary:
  64-bit LE, `e_machine = 183` (AArch64), PIE executable,
  interpreter `/system/bin/linker64` (Android bionic),
  `DT_NEEDED = {libdl.so, libc.so}` only — no `libtalloc.so`
  (talloc baked in, runs standalone), PRoot string profile present
  (`tracee`/`ptrace`/`bind`/`rootfs`/`guest`).
- The zip's `loader`/`loader-m32` Termux wrapper scripts are intentionally
  NOT shipped (the module installs the binary directly).

## Replacing it

Drop any Android-targeted static `proot` (arm64-v8a) here under the exact
name `libproot.so` and reinstall. Verify before shipping:

```
python3 -c "import struct; b=open('libproot.so','rb').read();
print(b[:4], struct.unpack_from('<H', b, 18)[0])"  # expect b'\x7fELF' 183
```

## LICENSE NOTICE (read before release)

PRoot (including the Termux fork it is built from) is **GPL-2.0**.
Shipping this binary inside the APK means the distributed app must comply
with GPL-2.0 for the PRoot component (corresponding source offer +
license preservation). Sources: https://github.com/termux/proot and the
build repo above. Ajiro's own code stays under its own license, but the
combined APK containing PRoot triggers GPL obligations for that part —
resolve this (attribution/source offer in-app or in release notes) before
publishing to a store.
