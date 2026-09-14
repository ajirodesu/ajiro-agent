# PRoot binary (arm64-v8a)

Drop a **statically linked `proot` for `arm64-v8a`** here so it ships inside
the APK and the native module can install it to app-private storage:

```
modules/terminal-pty/android/src/main/jniLibs/arm64-v8a/libproot.so
```

> The file MUST be named `libproot.so` (Gradle only packages `lib*.so` from
> `jniLibs`). It must be an executable-format static `proot` binary — the
> `TerminalPtyModule.ensureProotExecutable()` copies it to
> `files/bin/proot` and `chmod 700`s it at first spawn.

Recommended source: build proot from https://github.com/proot-me/proot
(`proot/src/proot`) or use a Termux-compatible static arm64 build. Verify:

```
file libproot.so   # ELF 64-bit LSB executable, ARM aarch64, statically linked
```

Without this file, `spawnSession` / `executeHeadless` fail closed with
`proot binary missing` — the app never fabricates a shell.
