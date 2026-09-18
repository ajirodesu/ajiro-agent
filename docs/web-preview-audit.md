# Web Preview Native-Capability Audit (F0)

Date: 2026-09-18. Scope: what Web Preview (`expo export --platform web`)
can and cannot do, per native boundary. Method: source inspection of every
native call site + `expo export --platform web` (passes) + runtime-behavior
verification of the expo/web stubs in `node_modules`.

## Capability matrix

| Native capability | Web status | Disposition + evidence |
| --- | --- | --- |
| `expo-secure-store` | Rejects on web | Adapted: `secure-store.ts` wrapper + `secure-store.web.ts` in-memory map; `secrets.web.ts` mirrors `SecretStore`. Parity enforced by `contracts:check` + `web-contract-parity.test.ts`. |
| `expo-sqlite` | WASM backend | Adapted, no custom engine: web backend is **wa-sqlite** (WASM worker, `node_modules/expo-sqlite/web/wa-sqlite/`), needs Metro `wasm` assetExt (added). Named in `web-database.ts` (`WEB_DATABASE_NAME`, `describeWebDatabaseBackend`, `assertWebDatabaseSupported`); covered by `web-database.test.ts`. |
| `react-native-webview` (plugin host, CodeMirror, markdown, run preview) | Renders iframe; no native bridge | Per-surface verdicts below. |
| `expo-notifications` | Stubs: emitter/handler warn-only; scheduler throws `UnavailabilityError` | Verified safe: `setNotificationHandler` skipped on web (`_layout.tsx`); channel setup Android-gated; stale-dismiss Android/iOS-gated; every startup/approval/run-finish call site `.catch`-guarded; in-app banner path used while active. |
| `background-agent-service` (local module) | Module never loaded | Verified, unchanged: `Platform.OS === 'android'` guard at module scope and in every function; `requireNativeModule` never evaluated on web. |
| `scheduler-alarm` (local module) | Module never loaded | Verified, unchanged: same Android-guard pattern. |
| `expo-intent-launcher` + `LegacyFileSystem.getContentUriAsync` | Android-only APIs | Verified, unchanged: all 4 call sites (`index.tsx`, `library.tsx`, `chat-message.tsx`) inside `Platform.OS === "android"` branches with honest notices. |
| `saf-file-operations` (local module) | Missing on web | Verified, unchanged: uses `requireOptionalNativeModule` (null on web); service throws meaningful user-facing errors. |
| Camera capture | Intent-based | Verified, unchanged: `capturePhoto` never throws, returns typed failure (`The camera app could not be opened…`). |
| PTY/proot (`TerminalPty`) | Missing on web | Already fail-closed: `TerminalBridge` lazy-requires Android-only, throws typed `TerminalBridgeError("unavailable")`; screen renders honest banner. No `.web.tsx` needed (verdict T1). |
| Entry-script plugins | No execution host | Adapted: `plugin-host-surface.web.tsx` mounts nothing; runtime declarative path reports missing host. No plugin code executes. |
| OAuth (OpenAI/MCP browser flows) | No loopback plumbing | Honest: `secrets.web.ts` reports OAuth providers unconfigured; MCP OAuth callback route is a plain `Redirect`. |
| `persistent-model-download` | Empty stub (`export {}`) | Dead-code candidate D1 (no behavior on any platform). |

## Per-surface verdicts (F4)

| Route/surface | Verdict | Forensic reason | Patch |
| --- | --- | --- | --- |
| Chat (`index.tsx`) | Supported | Providers via fetch; keys in-memory for session | Wrapper rewiring only |
| Files (`files.tsx`) | Supported with adaptation | Markdown `WebView` is static HTML (iframe-safe); SAF/folder paths Android-gated with notices | None needed (verdict F1) |
| Editor (CodeMirror) | Adapted | `ReactNativeWebView.postMessage` bridge absent in iframe; editable-look-but-broken risks silent data loss | `CodeMirrorWebView.web.tsx`: read-only snapshot, never ready (parent queues) |
| Terminal (`terminal.tsx`) | Unsupported, honest | PTY needs `TerminalPty`; bridge already typed fail-closed, banner rendered | None needed (verdict T1) |
| Run console | Supported (error path) | `useProjectRun.start` resolves `phase: "error"` with actionable message | None |
| Run webview | Unsupported, honest | `liveUrl` points at on-device server | `Platform.OS === "web"` → `NativeViewUnavailable` |
| Extensions/plugins UI | Supported (degraded) | Catalog/signature/rollback pure JS; entry scripts cannot execute | Host `.web.tsx` mounts nothing |
| Settings/search/theme/responsive | Supported | `useTheme`, `ResponsiveShell`, router all platform-agnostic | None |
| Bot/git/library | Supported | Pure UI or guarded first-use paths | None |

## Dead-code / removal-review list (F0 proposal, not executed)

- **D1** `modules/persistent-model-download/index.ts` — body is `export {};`. No behavior on any platform. Propose removal after confirming no config references it.
- **D2** `dist/` — build output of `expo export`; untracked (git-ignored). Not dead code, but must never be committed.
- **D3** `headless-registration` — zero references under `src/`; nothing to remove, audit mention was speculative.

## Deciding diffs from the plan

1. **wa-sqlite, not sql.js.** The plan named a sql.js adapter; upstream `expo-sqlite` web targets wa-sqlite. No redundant engine shipped; `web-database.ts` describes/guards the real backend.
2. **No terminal/files `.web.tsx`.** Both already fail gracefully with honest UI; forking them would add a second truth. Verdicts T1/F1 recorded instead.
3. **Read-only editor over broken editor.** An iframe CodeMirror that looks editable but drops keystrokes is a data-loss hazard; snapshot + queued writes is the safe shape.
4. **In-memory secrets over localStorage.** Persisting credentials to `localStorage` would leak and pretend at SecureStore semantics; session-only memory + warning is correct for dev preview.

## Evidence

- `npx expo export --platform web` → `Exported: dist` (index.html + web bundles + wasm).
- `npx tsc --noEmit` → clean. `npx expo lint` → clean.
- `npx vitest run` → all files pass (incl. 5 new web-preview test files).
- `node ./scripts/contracts-check.mjs` → 6/6 PASS.
