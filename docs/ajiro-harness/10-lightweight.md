# U/V/Y. Dependency Audit + Dead Code + Lightweight

## Dependency audit (§80, U) — verified by import scan 2026-09-12
- REMOVED (UNUSED): `expo-glass-effect`, `punycode` (zero src references;
  package.json + lock root entries removed, lock re-validated in sync).
- Termux native module deleted (`modules/termux-stream`).
- REQUIRED (all referenced, many lazy): expo-sqlite/drizzle, ai SDKs
  (@ai-sdk/*, ai, openai/google/anthropic/xai/ollama providers),
  isomorphic-git + buffer (lazy), @babel/parser (lazy), zod, tanstack query,
  flash-list, reanimated, gesture-handler, screens, safe-area, keyboard-
  controller, svg, markdown-display, clipboard/document-picker/sharing/
  intent-launcher/media-library (attachments), secure-store, crypto,
  notifications, file-system, sqlite, sqlite-adjacent scheduler/alarms,
  tcp-socket (MCP loopback, lazy), quick-crypto (lazy), expo-ai-kit (lazy,
  on-device models), croner (scheduler), yaml (skills/agents), refractor
  (code highlight), lucide icons, nativewind/tailwind, jest→vitest toolchain.
- Classifications: no DUPLICATE/INCOMPATIBLE found; nothing TOO LARGE added
  (terminal is dependency-free TS).

## Dead-code audit (§78, V)
- Removed: Termux integration (mandated), 2 unused deps.
- Adopted (not deleted): `checkpoint-service.ts` (zero callers but required
  by §§54/68/100; canonical undo engine, edit-path wiring pending).
- No other dead backend files found (scheduler barrel live, constants live,
  verify-loop/diff/pruner/compaction live).

## Lightweight (Y, §§75, 81–88)
- Lazy: isomorphic-git, Buffer, @babel/parser, expo-ai-kit, tcp-socket,
  quick-crypto, exec-in-broker, terminal sessions (on demand), controller
  per-tab processes. Startup: minimal bootstrap → restore session → render →
  lazy agent services (existing order kept; nothing new initializes at launch).
- Bounded: terminal scrollback 5000, history 500/tab, exec 8000 chars/60s,
  tool outputs summarized, provenance prunable, context budgeted.
- Bundle optimization: tree-shaking via Metro, no new packages added,
  exec allow-list extracted to import-light leaf module.
- Measurements (§89): not yet taken on-device (cold/warm start, APK/AAB,
  RAM/CPU/battery, terminal throughput, DB size, render times) — tracked as
  future work in 11-tests-limits.md. No values invented.
