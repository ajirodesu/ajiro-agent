# Acode Compatibility Report

Scope: the Extension Store, package manager, dynamic registry synchronization,
and Acode compatibility runtime under `src/modules/extensions/`, including the
DOM plugin runtime under `src/modules/extensions/dom/`. This document is the
honest statement of what is supported, what is not, and why. It is
deliberately *not* a claim of full Acode compatibility.

Last updated: 2026-09-16.

## 1. Sources of truth

Verified firsthand while writing this report:

| Source | What it established |
|---|---|
| https://docs.acode.app/docs/global-apis/acode | The `acode` global: `setPluginInit(pluginId, init, settings?)`, `init(baseUrl, $page, cacheFile)`, `setPluginUnmount`, `define`/`require` (case-insensitive names), `installPlugin(pluginId, installerPluginName)` (v954+), `waitForPlugin` → `Promise<boolean>`, `clearBrokenPluginMark`, plus `exec`, `addIcon`, `pushNotification`, `toInternalUrl`, `newEditorFile`, `registerFormatter`, `format`, `formatters`, `getFormatterFor` |
| https://docs.acode.app/docs/plugin-essentials/manifest | Documented `plugin.json` fields: `id`, `name`, `main`, `version`, `readme`, `icon`, `files`, `minVersionCode`, `price`, `author`, `license`, `keywords`, `changelogs`, `contributors`, `repository`. Icon ≤ 50 KB. `minVersionCode` 290 is the documented baseline. |
| https://docs.acode.app/docs/getting-started/understanding-plugin | Plugin initialization context (`baseUrl`, page, plugin cache) and the `setPluginInit`/`setPluginUnmount` contract |
| `Acode-Foundation/Acode` `src/lib/installPlugin.js` | Registry download URL `${API_BASE}/plugin/download/${id}?device=&token=&package=&version=`; `plugin.json` **main/icon/readme patching** to `main.js`/`icon.png`/`readme.md`; a real, undocumented **`dependencies`** manifest field with a user-confirmation prompt; `pluginJson.source`; ZIP entry **sanitization-and-skip** for absolute paths; `InstallState` incremental writes and `deleteRedundantFiles` cleanup |
| `Acode-Foundation/Acode` `src/lib/loadPlugins.js` | `PLUGIN_LOAD_TIMEOUT = 15000`; broken plugins go into `BROKEN_PLUGINS` **and** are auto-disabled (`pluginsDisabled[id] = true`) so they are not retried in a loop; a successful load clears the broken mark; theme plugins load first |
| `catalog/extensions.json` (bundled seed) | Real published metadata and archive URLs for `acode.plugin.python`, `acode.runner.plugin`, `acode.plugin.snippets` |

Inherited from the implementation's own notes and **not re-verified** in this
session: the exact registry list endpoint (`plugin/all?page=&limit=`) and that
`config.API_BASE` is `https://acode.app/api`. The provider tolerates both bare
arrays and enveloped responses, so a change there degrades rather than breaks.

## 2. Architecture

```
Acode-compatible registry (or bundled seed)
        │  registry.ts  — provider abstraction, normalization, pagination, seed floor
        ▼
Catalog sync  (catalog-sync.ts)  — cache-first, stale-while-revalidate, single-flight
        │  ETag / Last-Modified, diff engine (added/updated/removed/version-updated)
        ▼
Catalog cache  (catalog.ts → <documents>/ajiro-agent/extensions/catalog-cache.json)
        ▼
Extension Store UI  (app/(root)/extensions.tsx)  — Explore / Installed / Search / Details
        │  Preferences, diagnostics, settings, commands, icons, update-all
        ▼
Package manager  (manager.ts + installer.ts)  — download → validate → stage → atomic replace
        │  manifest.ts, zip.ts, signature.ts, permissions.ts, storage.ts, preferences.ts
        ▼
Compatibility layer  (compatibility.ts + acode-matrix.ts)  — per-extension report with reasons
        ▼
Acode runtime  (runtime.ts)  — globalThis.acode, lifecycle, crash isolation, broken marks
        │  PluginExecutionHost seam
        ▼
DOM plugin runtime  (dom/)  — one react-native-webview document per app session
        │  dom-runtime-script.ts  — the in-document acode shim, module registry, pages
        │  plugin-host.ts         — session state machine, permission + path enforcement
        │  runtime-bridge.ts      — runtime/commands/diagnostics/consent wiring
        │  host-services.ts       — package reads, private data, settings, storage
        ▼
RN surface  (components/extensions/plugin-host-surface.tsx)  — mounts the document
```

Startup and foreground catalog synchronization is driven by
`components/extensions/catalog-sync-observer.tsx`, mounted once from the root
layout. The plugin host document is mounted by
`components/extensions/plugin-host-surface.tsx`, also once from the root layout,
and only when an installed extension actually ships an entry script.

Discovery never installs, enables, or executes anything.

## 3. Supported Acode API surface

| API | Status | Notes |
|---|---|---|
| Entry script execution (`main.js`) | Supported | Executed with `new Function` **inside the plugin host document**, the only place on the device with a real DOM and dynamic code evaluation. Hermes has neither, which is why the document exists. The script is injected as data over the bridge, never as a remote `<script src>`. The document itself is covered by an end-to-end test that runs it in a real DOM |
| `window`, `document`, `HTMLElement`, `CustomEvent`, `Blob`, `URL`, `location`, `fetch` | Supported | Genuine browser globals: the plugin runs in a real document. `fetch` is permission-gated, and any URL inside the plugin's own `baseUrl` is served from the installed package over the bridge instead of the network |
| `acode.setPluginInit(id, init, settings?)` | Supported | `init` is invoked as Acode does: `(baseUrl, $page, cache)`. The `settings` declaration is recorded and readable via `ExtensionRuntime.getPluginSettings` |
| `$page` (Acode's WCPage) | Partial | A plugin gets a real page object with `show()`, `hide()`, `remove()`, `onshow`, `onhide`, `innerHTML`, `textContent`, `get(id)`, `querySelector`, `querySelectorAll`, and the backing `element`. It is styled with the active Ajiro theme. Acode's editor-bound methods (`$page.get("...")` for editor widgets, `WCPage` internals) are not reproduced |
| `acode.setPluginUnmount(id, cb)` | Supported | Runs on disable, update, rollback, and uninstall. The document additionally reclaims everything the plugin created: timers, `window` listeners, and its pages |
| `acode.define(name, module)` | Supported | Case-insensitive names, reserved core names rejected. Shared at document scope, exactly like Acode |
| `acode.require(name)` | Partial | The document provides `commands`, `settings`, `storage`, and `filesystem`, each behind its permission grant, plus plugin-defined modules. Acode core modules Ajiro does not ship (`app`, `editor`, `project`, `filelist`, `theme`, `palette`, …) throw a descriptive error rather than returning a stub |
| `acode.exec(name, value)` | Supported | Runs the plugin's own registered command when it owns one, otherwise forwards to the host command handler |
| `acode.pushNotification(title, message, options)` | Supported | Permission-gated (`notifications`); surfaced as an inline notice in the app and recorded in diagnostics |
| `acode.addIcon(name, src)` | Supported | Injects a CSS class into the document, as Acode does |
| `acode.toInternalUrl(url)` | Partial | `http(s)` URLs pass through; package-relative paths resolve to a `blob:` URL built from the installed file |
| `acode.installPlugin(id, installerName)` | Supported (consent-gated) | Always asks the user, shows the requested capabilities, and installs through the same validated package manager the Store uses. Refused outright when the user turns plugin-initiated installs off |
| `acode.waitForPlugin(id)` | Supported | Resolves `true` once loaded; rejects for missing, disabled, broken, or uninstalled plugins |
| `acode.clearBrokenPluginMark(id)` | Supported | Returns a promise (superset of Acode's sync `void`); clears the persisted mark so the plugin can be enabled again |
| Plugin lifecycle | Supported | `not-installed → installing → installed → enabled/disabled → loading → loaded → broken/updating/uninstalling`; a crash or a >15 s init marks the plugin broken **and auto-disables it**, matching `loadPlugins.js`. Disable/update/uninstall unmount the plugin inside the document first |
| `plugin.json` parsing | Supported | All documented fields, unknown fields preserved, Acode's main/icon/readme fallback patching, plus the real `dependencies` field |
| ZIP install (registry / local file / remote URL) | Supported | Registry, `https://` URL, and document-picker ZIP |
| Update, rollback, uninstall, update all | Supported | Updates keep the replaced version as a rollback point until the new version activates; rollback restores and re-validates it; update-all collects per-extension failures instead of aborting |
| Registry discovery + metadata refresh | Supported | Newly published extensions appear without an APK update |
| Plugin settings | Supported | Stored per extension as `extensions.<pluginId>.<key>` in the plugin's private data directory, editable from the Store, deleted on uninstall |
| Plugin commands | Supported | Registered in the document, mirrored into an app-level registry, and runnable from the extension detail view |
| Command `bindKey` | Supported, with one refusal | The platform map is resolved for the running OS (`ios` reads the `mac` entry, `android` the `linux` one). Candidate chords are pushed into the editor document, which claims **only** those chords and reports them back, and the app dispatches to the owning plugin command. A chord two commands claim is a conflict: shown as conflicted and never dispatched. A binding that would steal typed input (a bare or Shift-modified character) is refused, because a claimed chord is consumed before CodeMirror sees it |
| Manifest `dependencies` | Supported | Version-aware when a requirement supplies one (`^`, `~`, `>=`, `>`, `<=`, `<`, `=`, conjunctions): the closure is resolved, installed dependency-first (each package through its own consent prompt), and blocked plans report missing / version / conflict / circular / unparseable / failed issues |
| Plugin diagnostics | Supported | Bounded, persisted log of console output, refused operations, and lifecycle failures, viewable and clearable per extension |
| Publisher signatures | [AJIRO ORIGINAL], optional | Acode publishes no signatures at all, so Ajiro defines its own optional `signature` block (`{ algorithm: "ed25519", keyId, value }`), verifies it with real Ed25519 over a canonical description of the package's contents, and records the verdict on the installed record. Nothing is refused unless the user turns on "require signed packages" and trusts the signing key; the Store shows the verdict either way |

## 4. Unsupported (and why)

| API / capability | Reason |
|---|---|
| `acode.newEditorFile`, `registerFormatter`, `format`, `formatters`, `getFormatterFor` | Ajiro's editor is CodeMirror, exposed to plugins through an Ajiro-shaped API that does not exist yet. `newEditorFile` throws deliberately rather than pretending |
| Core modules `app`, `editor`, `project`, `filelist`, `theme`, `palette`, `sidebarApps`, `keyboard` | Ajiro has its own command, editor, navigation, and filesystem layers. Mapping them 1:1 would hand third-party code unrestricted internals, so they stay reserved and unresolvable. The compatibility evaluator names them up front so it is visible before activation |
| Acode's *native* `filesystem` semantics | Ajiro's `filesystem` module reads files inside the plugin's own package and reads/writes the plugin's private data directory. It never reaches the Android filesystem, the user's projects, or other apps' data |
| Editor/selection manipulation from a plugin | No Acode-compatible editor module exists yet; a plugin that requires `editor` fails at that line and is diagnosed |
| LSP, file-handler, and terminal plugin APIs | Acode v1008+/v1012+ surfaces; out of scope for this iteration |
| Plugin UI beyond a page surface | Plugin pages render inside the plugin host document. A plugin cannot drive Ajiro's native screens, and `acode.toast`/`loader`/`select`/`alert`/`confirm`/`prompt` are not mapped |
| `description` field in `plugin.json` | Not documented in the manifest page. Descriptions are read from the registry entry, so a local ZIP install shows no description unless the registry supplies one |
| A signature a *publisher* has already made | Ajiro can verify signatures, but Acode's registry publishes none: there is nothing to check a stock plugin against, which is why an unsigned package installs by default and is labelled `Unsigned` rather than "unverified but fine" |

## 5. Deliberate differences from Acode

1. **One document, not one per plugin.** Acode injects a `<script src>` per
   plugin into the app's own webview. Ajiro uses a single, blank, controlled
   document that every plugin shares, with navigation blocked, file access and
   DOM storage disabled, and no ambient origin. Message traffic is the only
   channel between plugin code and the app.
2. **Plugin writes are redirected.** A plugin can read its package but never
   write to it; `writeFile` lands in
   `<data>/<pluginId>/storage/files/…`. A plugin therefore cannot rewrite its
   own manifest or entry script.
3. **ZIP safety is stricter.** Acode sanitizes entry paths and *skips* unsafe
   absolute entries with a warning. Ajiro rejects the whole archive on path
   traversal, absolute paths, drive/URL forms, backslashes, symlinks, ZIP64,
   unsupported compression, or a CRC mismatch. A rejected package is never
   partially written.
4. **Installation is atomic, not incremental.** Acode writes files one by one
   with `InstallState` bookkeeping and cleans up redundant files afterwards.
   Ajiro stages the fully validated tree, then swaps it into place with a
   backup, so a failed install or update can never leave a half-written plugin.
5. **Permissions are an Ajiro concept.** `plugin.json` has no permission
   section, so required capabilities (storage, UI, and — for a plugin with an
   entry script — commands, editor, network, plus filesystem when it ships
   `files`) are inferred and must be approved before the first install and
   again whenever an update asks for more. The document enforces them on every
   bridged operation, and caps how many requests one plugin may make.
6. **Environment failures are not plugin faults.** If no runtime document is
   mounted, an entry-script plugin is *not* reported as loaded: activation
   fails with an environment error, the extension stays disabled and retryable,
   and no broken mark is written. Reporting "loaded" for code that never ran
   would be a lie.
7. **Registry download URL.** Ajiro requests `${API_BASE}/plugin/download/<id>`
   without Acode's `device`/`package`/`version` query parameters. Paid or
   device-bound downloads may therefore differ; free plugins that publish a
   direct ZIP URL are unaffected.
8. **`clearBrokenPluginMark` returns a promise**, `waitForPlugin` resolves a
   real `true`, and core `require` throws instead of returning a stub. Each is
   a superset or a louder failure than Acode's shape, never a silent one.
9. **Publisher signatures are Ajiro's own extension point, not Acode parity.**
   Because the ecosystem ships none, the honest default is "record the verdict,
   refuse nothing": an unsigned package installs and is labelled `Unsigned`,
   and only a user who turns on *require signed packages* and trusts a signing
   key can make a verdict block an install. The signed payload is a canonical
   description of the package's own files (never the ZIP bytes, which would
   include the signature and could therefore never verify), so a signature
   cannot be moved onto a different version or a tampered archive.

## 6. Compatibility evaluation and `minVersionCode`

`compatibility.ts` produces one of `compatible | partial | unsupported |
unknown` **with reasons** — never a numeric score.
`acode-matrix.ts` maps `minVersionCode` ranges onto the API surface Ajiro
emulates:

| `minVersionCode` | Notes | Emulated | Not emulated |
|---|---|---|---|
| 0–289 | pre-`minVersionCode` era | init, unmount, define, require | `waitForPlugin`, `clearBrokenPluginMark` |
| 290–962 | modern plugin API | the full runtime surface above | editor/project/formatter modules |
| ≥ 963 | latest plugin API (runner era) | the full runtime surface above | editor/project/formatter modules |

Rules applied by the evaluator:

- A declared floor above the emulated version code (currently `963`) is
  `unsupported`.
- An entry script runs in the plugin host document, so `window`, `document`,
  and `fetch` are **supported**, not merely tolerated.
- Requiring an Acode core module Ajiro does not ship, or calling
  `newEditorFile` / the editor DOM directly, yields `partial` with the exact
  module or API named.
- A data-only package (no entry script) is `compatible`.
- `unknown` is used when a manifest is too malformed to judge; it never implies
  support.

## 7. Known plugin fixtures

The bundled seed catalog ships three real plugins, so the Store is populated and
installable offline:

| Plugin | Source | Expected status |
|---|---|---|
| `acode.plugin.python` | `Acode-Foundation/acode-plugin-python` | Runs — its entry script executes in the document; it registers commands and runners. Editor-bound features are unavailable (no `editor` module) |
| `acode.runner.plugin` | `Acode-Foundation/acode-runner-plugin` | Partial — declares `minVersionCode: 963`; its runner console is DOM-based and works, but anything reaching for the Acode editor API does not |
| `acode.plugin.snippets` | `deadlyjack/acode-plugin-snippets` | Runs — snippet expansion registers through the `commands` module; its editor integration is limited to what that module exposes |

Package handling for these archives (GitHub `main.zip` layout with a single
top-level folder) is covered structurally by the test suite. Installing the
real archives end to end is **not** part of the automated suite, because it
would require network access and a device runtime; treat the statuses above as
analysis, and verify on-device before relying on them.

## 8. Verification

```
npx vitest run src/modules/extensions src/editor   # 242 tests, 17 files
npx vitest run                                     # 883 tests, 87 files, all passing
npx tsc --noEmit                                   # clean for the extension platform
npx eslint src/modules/extensions src/components/extensions "src/app/(root)/extensions.tsx" \
  src/components/ui/app-sidebar.tsx src/editor/CodeMirrorEditor.tsx src/editor/editorDocument.ts
```

Coverage: manifest parsing and rejection, ZIP structure/CRC/traversal/absolute
path/symlink/entry-point validation, permission consent gating, staging cleanup,
atomic replace and backup, dependency reporting, uninstall isolation, install →
enable → disable → update → rollback → uninstall, broken-plugin recovery,
runtime init/unmount/resource cleanup, `require`/`define`/`waitForPlugin`/
`installPlugin`/`clearBrokenPluginMark`, the catalog diff engine, duplicate
collapsing, cache-first and offline behavior, malformed registry responses,
single-flight scheduling, and the discovery indicator.

The plugin host document is **executed**, not simulated, in
`dom-document.test.ts`: the generated document runs in a real DOM (jsdom, dev
dependency only) with the production `PluginDomHost` attached over the same
`postMessage` channel the WebView surface uses, and fixture plugins exercise
entry-script execution, page rendering, bridged storage reads and writes,
command registration and execution, permission refusal, unmount teardown, load
failures, and document replacement. Only the WebView itself is replaced.

Dependency resolution and key bindings add: version grammar and its
unparseable cases, dependency-first ordering, missing/version/conflict/circular
reporting, dependency-first installation with per-package consent failures,
retry with exponential backoff, interrupted-operation reconciliation (repaired
and broken cases), Acode key-spec parsing across every alias, platform map
resolution, chord matching and conflict refusal, and a cross-check that the
document's inline chord builder agrees with the app's TypeScript one.

Catalog search adds: index/linear-scan equivalence over a battery of needles,
order preservation, empty and miss queries, stale-index refusal, per-state
Installed filters, and the featured shelf's determinism.

The DOM runtime adds: bridge protocol parsing and payload escaping, package-path
validation, document readiness and replacement, load/activate/unmount handshakes
including the no-init-callback and throwing-init cases, page state, permission
refusals for commands/notifications/filesystem/storage, package-path traversal
refusal, private-data writes, the request budget, plugin-initiated install
consent and refusal, console capture, diagnostic ring limits and persisted
per-plugin clearing, document remount re-activation, and the environment-failure
path that leaves a plugin retryable instead of broken.

Signatures add: Ed25519 verification against a user trust store, key/tampering
substitution detection, malformed and unsupported-algorithm blocks, the
`text:`/`bytes:` payload agreement between signer and verifier, the block/allow
policy, persistence of a verdict (and of a legacy record that has none),
enforcement inside a real ZIP install (nothing is written when a package is
refused), and the manager applying the preference to every package in a
dependency closure.

## 9. Open gaps

1. **Editor and project modules.** The largest remaining gap: a plugin cannot
   drive Ajiro's editor or the active project through an Acode-shaped module.
   This is a deliberate security decision, not an oversight. (Command key
   bindings are the one editor-adjacent surface that *is* wired: a plugin can
   claim a chord and run its own command, but it cannot read or change the
   editor's document.)
2. **`$page` parity.** Page creation, show/hide, and DOM access work; Acode's
   editor-widget specifics do not.
3. **Real published archives are not exercised end to end by tests** (network
   and device runtime required).
4. **Formatter registry, LSP, file handlers, terminal API** are unimplemented.
5. **No signatures exist to verify in the wild.** Verification is implemented
   and enforced, but Acode publishes no signatures, so out of the box every
   plugin is correctly reported as `Unsigned`. Requiring signatures only
   becomes meaningful for publishers who sign with a key you trust.
6. **Plugin UI is limited to the plugin page surface**: no native dialogs or
   toasts are mapped from the Acode helpers.
