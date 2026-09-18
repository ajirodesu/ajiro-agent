# Web Preview (dev-only)

Browser preview of the same app, router, and theme for fast UI iteration.
Not a distribution target: anything that needs Android native modules is
visibly unavailable instead of half-working.

## Run it

```sh
npx expo export --platform web   # static bundle, verifies web resolvability
npx expo start --web             # dev server with HMR
```

## What works

- Same `app/` router, same `useTheme()` tokens, same Geist fonts.
- Same responsive shell (`ResponsiveShell`, mobile `<768`, tablet
  `768-1279`, desktop `≥1280`) — resize the window to exercise breakpoints.
- Chat over any API-key provider: keys entered in preview are kept in
  memory for the session only (see below) and reach the network from the
  browser like any web chat client.
- SQLite via the expo-sqlite WASM build (Metro `wasm` assetExt in
  `metro.config.js`); conversations, settings, and memory persist in the
  browser profile's OPFS/IndexedDB, separate from the device.
- Transcript-mode terminal output, markdown preview, files list, settings,
  skills/MCP management UI.

## Deliberately unavailable (honest fallbacks)

| Surface | Web behavior |
| --- | --- |
| Secrets (`expo-secure-store`) | `src/core/services/secure-store.web.ts` in-memory map, session-only; one console warning, no disk writes. OAuth providers stay unconfigured (browser redirect loopback has no native plumbing). |
| Secrets consumers | `openai-oauth.ts`, `bot-service.ts`, `login.tsx`, `secrets.ts` all import the `@/core/services/secure-store` wrapper; `secrets.web.ts` mirrors the `SecretStore` interface over memory. Pure key helpers live in `secrets-shared.ts` (no expo imports). |
| Entry-script plugins | `plugin-host-surface.web.tsx` mounts nothing; the runtime keeps declarative activation and reports the missing execution host instead of marking plugins broken. No plugin code executes. |
| Code editor | `CodeMirrorWebView.web.tsx` shows a read-only snapshot with a caption; never reports ready, drops inbound edits (parent queues, nothing lost). |
| Interactive terminal | Fail-closed `TerminalBridgeError("unavailable")` renders the existing honest banner (`On-device Linux terminal requires Android (current platform: web)`). |
| Project run webview | `NativeViewUnavailable`; `useProjectRun.start` already resolves to `phase: "error"` with `Running projects needs the native runtime (Android dev build).` |
| Notifications | `setNotificationHandler` skipped on web (`_layout.tsx`); all schedule/dismiss paths already `.catch`-guarded or Android-gated, in-app banner path used while active. |
| Background agent / alarms | Local modules (`modules/background-agent-service`, `modules/scheduler-alarm`) already no-op unless `Platform.OS === "android"`; `requireNativeModule` never evaluated on web. |
| Intents / SAF / camera | All call sites Android-gated with honest notices (`index.tsx`, `library.tsx`, `chat-message.tsx`); `saf-file-operations` uses `requireOptionalNativeModule`; `capturePhoto` returns typed failure, never throws. |

## Verified, not changed

- `background-agent-service` / `scheduler-alarm`: pre-existing
  `Platform.OS === "android"` guards at module scope and per function.
- `run-notifications.ts`: channel setup Android-gated, stale-dismiss
  Android/iOS-gated, startup callers `.catch`.
- `+native-intent.tsx`: pure path matching, no native calls.
- `persistent-model-download`: empty stub.
- No `headless-registration` references exist under `src/`.

## Rules for new code

1. Prefer `.web.tsx` variants over `Platform.OS` branches for surfaces;
   prefer branches for one-line guards.
2. Never persist secrets on web; never silently drop user input — queue,
   banner, or read-only.
3. First-use native calls must fail gracefully (typed error / honest
   message), never throw through startup.
4. No plugin code executes in preview; nothing installs/enables/runs as a
   side effect of previewing.
