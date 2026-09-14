# K/L/M. Subagents + Terminal + Runtime (see also 04)

## Subagents (K)
Main → Explorer/Planner/CodeAnalyst/TestAgent/SecurityReviewer/AndroidAgent/
DocumentationAgent (+ General). Separate context (delegated prompt only),
restricted tools, own budgets (15–20 iterations), parallel execution,
cancellation, result-as-tool-output. Catalog described to the model
(`describeSubagentCatalog`, kept).

## Embedded terminal (L, §§32–49)
- REPLACED (canonical stack): `LinuxAgentRuntime` → `TerminalBridge`
  (`TerminalPty` Expo module: Kotlin + JNI + C++ forkpty) → PRoot → Debian
  Bookworm ARM64. UI: `LinuxTerminal.tsx` + `TerminalWebView.tsx` (local
  vendored xterm, no CDN) with Acode-adapted touch scrolling (momentum),
  long-press selection + copy/paste, fit-measured resize, xterm search, and
  live theme updates via `terminalThemeAdapter` (Ajiro AppTheme is the source
  of truth, locked-accent rules honored). Agent shell tool (`shell`) runs
  headless through the same runtime, independent of mounted terminal UI.
- Legacy in-process stack (`TerminalView`, `Controller`, old `Session`,
  `InProcessAdapter`, old terminal themes, and their dedicated tests) is
  deleted. The remaining `modules/terminal/` files are the pure ANSI
  engine (parser/buffer/grid/search) with no production importers.
  Transcript mode is kept.
- Rootfs extraction is real: `RootfsExtractor.kt` (commons-compress +
  Tukaani XZ, symlink/hardlink recreation, exec-bit preservation,
  path-traversal guard, progress events) via `TerminalBridge.extractRootfs`;
  `.tar.xz` primary, `.tar.gz`/`.tgz`/`.tar` accepted.
- Project ↔ `/workspace` sync (`src/runtime/workspaceSync*.ts`): SAF has no
  POSIX path so PRoot cannot bind-mount it — sync-in runs before shell exec
  / on terminal open, sync-out after exec / on terminal close. Never
  deletes; conflicts resolve for the SAF project and are reported; default
  ignores + size/count caps; FNV-1a manifest for steady-state speed.
- ANSI/VT: handled by xterm (SGR 16/256/truecolor, alt-screen, OSC titles,
  combining/wide cells). Raw PTY bytes are preserved verbatim to the WebView.
- Performance: PTY output bypasses React state (event emitter → WebView
  postMessage); theme/font updates never respawn the PTY.
- Security (§48): interactive sessions and `shell` go Permission → Broker →
  `linux` backend when provisioned, else the explicit unprovisioned
  limitation; app-private storage only, no root, no remote execution.

## Device runtime matrix (M, §§28–30)
| Operation | android_local | linux |
|---|---|---|
| fs read / scoped write | YES (SAF + app storage) | n/a |
| git (isomorphic-git) | YES (no binary; worktrees limited) | n/a |
| exec checks (5 allow-listed) | YES (in-process) | n/a |
| network APIs | YES (communication, approved) | n/a |
| general shell / packages / builds | NO (no exec on stock Android) | YES when provisioned: `LinuxAgentRuntime` (Debian/PRoot/PTY) via broker `exec.shell`; unprovisioned → explicit limitation |
No remote column exists. Network ≠ execution (§102).
