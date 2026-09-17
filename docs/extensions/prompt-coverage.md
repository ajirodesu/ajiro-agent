# Extension Platform — Prompt Coverage Matrix

Audit of the master prompt ("Ajiro Agent — Acode-Compatible Extension Store,
Plugin Runtime, Package Manager, Dynamic Registry Synchronization, and
Compatibility Layer") against what is actually implemented, and where to look
for it. Section numbers match the prompt.

Statuses: **Done** (implemented and tested) · **Partial** (implemented with a
documented, intentional limit) · **N/A** (requirement not applicable to this
architecture).

Last audited: 2026-09-18. Test counts: 270 extension tests in 19 files
(312 with the editor suite in 25 files); 1114 tests across the repository
(+3 network-gated E2E tests, skipped offline).

| § | Requirement | Status | Where | Verified by |
|---|---|---|---|---|
| 1–6 | Official Acode sources as the contract (repo, docs, templates, real manifests, changelog, `en-us.json`) | Done | `docs/extensions/acode-compatibility.md` §1 records each source and what it established; `runtime.ts`, `manifest.ts`, `installer.ts`, `compatibility.ts` cite them inline | Report §1; `manifest-zip.test.ts`, `installer-runtime.test.ts` |
| 7 | Source-of-truth rule (inspect before implementing; no invented APIs) | Done | Every runtime behavior is annotated `[OPEN-SOURCE, MIT]` with the file it came from; Ajiro-only choices are annotated `[AJIRO ORIGINAL]` | Report §1, §5 |
| 8, 84 | Full target architecture (Store → Installed → Registry sync → Package manager → Compatibility runtime → Dependencies/permissions/security/storage/diagnostics) | Done | Report §2 architecture diagram; modules under `src/modules/extensions/` | This matrix |
| 9, 85 | A real plugin platform, not just a Store UI | Done | `dom/` (execution), `installer.ts`/`manager.ts` (packages), `runtime.ts` (lifecycle), `permissions.ts`, `security` in `zip.ts`, `storage.ts`, `diagnostics.ts` | `dom-host.test.ts`, `installer-runtime.test.ts`, `manifest-zip.test.ts` |
| 10 | Package model (`plugin.json` + configured entry point, never assume `main.js`) | Done | `manifest.ts` reads/patch-checks `main`; `installer.ts` stages whatever it names; `runtime.ts` reads the declared entry from the record | `manifest-zip.test.ts`; `installer-runtime.test.ts` ("rejects invalid packages…") |
| 11 | Manifest compatibility (validate JSON, required fields, id, version, entry point, assets, preserve unknown fields, reject malformed, reject conflicts, detect unsupported features) | Done | `manifest.ts` (`parsePluginManifest`, `validatePluginId`, `validatePluginVersion`, unknown-field preservation, `ACODE_DEFAULT_MAIN/ICON/README` patching, `./`-prefixed asset resolution against the archive entries) | `manifest-zip.test.ts` (incl. the dot-slash test); `e2e-archives.test.ts` |
| 12 | Safe ZIP handling (stage → validate → atomic install; reject `../`, absolute paths, traversal, corrupt archives) | Done | `zip.ts` (CRC, sizes, symlinks, ZIP64, unsupported methods), `installer.ts` staging | `manifest-zip.test.ts` |
| 13 | Local ZIP installation (pick → read → locate manifest → validate → show → confirm → install → register → enable if requested → load) | Done | `installer.ts` + `manager.ts` + Store "Install from file" flow with the permission consent drawer | `installer-runtime.test.ts` |
| 14 | Remote ZIP installation (download → validate → confirm → atomic install; never execute) | Done | `platform.ts` `fetchBytes`, `installer.ts` URL source, Store "Install from URL" drawer restricted to `https://` | `installer-runtime.test.ts` (registry URL download) |
| 15, 16 | Dynamic, registry-driven catalog; new plugins appear without an APK update | Done | `registry.ts` provider + `catalog-sync.ts` + persisted cache; nothing is hardcoded beyond an offline seed — and the seed itself now resolves through the registry (`{ kind: "registry" }`), because GitHub `main.zip` source archives are not installable packages (repos do not commit `dist/`; verified via the contents API) | `catalog-registry.test.ts`, `catalog-sync.test.ts` (§76 dynamic registry test); `e2e-archives.test.ts` |
| 17 | Discovery is not installation (discover/show/cache yes; install/execute/activate no) | Done | Sync only writes catalog metadata; plugins install disabled and run only when enabled | `catalog-sync.test.ts`; `installer-runtime.test.ts` ("A plain install never re-activates") |
| 18 | Cache-first Store (render cache, then revalidate) | Done | Store mount effect loads the cache first, then `syncCatalogInBackground` | `catalog-sync.test.ts` |
| 19 | Background registry synchronization (startup, Store open, foreground, stale, manual) | Done | `catalog-sync-observer.tsx` (startup + `AppState` foreground), Store open, refresh button; all single-flight and stale-checked | `catalog-sync.test.ts` |
| 20 | Stale-while-revalidate | Done | `catalog.ts` `isCacheStale` + `catalog-sync.ts` snapshot states | `catalog-sync.test.ts` |
| 21, 77 | Live Store updates while the user is viewing Explore | Done | `subscribeCatalog` repaints the open Store; extension lifecycle events (not catalog ones) also refresh it | `catalog-sync.test.ts` |
| 22 | Catalog diff engine (added/updated/removed/version-updated) | Done | `catalog.ts` `computeCatalogChanges` | `catalog-registry.test.ts` |
| 23 | Registry provider abstraction (`fetchCatalog`, `search`, `getExtension`, `getVersions`, `getLatestVersion`, `resolveDownload`) | Done | `registry.ts` `RegistryProvider` + `AcodeRegistryProvider` + `SeededRegistryProvider`; UI only sees normalized models | `catalog-registry.test.ts` |
| 24 | Registry cache state (sync status, ETag/Last-Modified, item counts) | Done | `models.ts` `RegistrySyncState`, persisted with the catalog cache; conditional requests are sent | `catalog-registry.test.ts` |
| 25 | Registry failure handling (keep cache, mark offline, retry later, distinguish failure kinds) | Done | `catalog-sync.ts` keeps the cached catalog and reports `offline`; failure kinds are separated (network/timeout/HTTP/malformed/empty) | `catalog-sync.test.ts` (§79 offline test) |
| 26 | New version detection → "Update available" | Done | `catalog.ts` `compareExtensionVersions` + `findUpdateAvailable`, surfaced as a badge; nothing updates silently. Behind it, `checkServerUpdates` probes Acode's `plugin/check-update/<id>/<version>` per installed plugin, and server-reported newer versions the synced listing missed are unioned into the badge, the update-all set, the Installed update filter, and (as a non-duplicating note) the detail view — with per-plugin failure isolation, so an offline probe degrades to catalog comparison | `catalog-registry.test.ts` (§78 + probe tests) |
| 27 | Compatibility-aware updates (a newer version is not automatically installable) | Done | `compatibility.ts` runs on the candidate package; the Store shows the reason before the update button | `catalog-registry.test.ts` |
| 28 | Store UI (Explore, Installed, Details with icon/author/version/keywords/license/repository/README/changelog/compat/actions) | Done | `app/(root)/extensions.tsx`: details complete, plus a **featured shelf** (`listFeaturedExtensions` — a deterministic presentation order, since the registry publishes no featured flag), **Installed state filter chips** for Enabled/Disabled/Broken/Update-available (`CATALOG_STATE_FILTERS`), a **Formatters** section (this plugin's registrations with per-language default Select/Clear persisted to preferences), a server-update note when the registry reports newer than the synced listing, and an inline-README/changelog fallback for uninstalled entries whose registry values are prose rather than package paths | `catalog-search.test.ts`; `formatters.test.ts` (`languageIdsForExtensions`); screen |
| 29 | Search across name/id/description/keywords/author, with filtering, sorting, pagination, states | Done | `filterCatalogEntries` + `sortCatalogEntries` + `CATALOG_PAGE_SIZE` paging in the screen | `catalog-registry.test.ts` (filtering); screen pagination is view-level |
| 30 | Normalized TypeScript models (no raw registry JSON above the provider) | Done | `models.ts` | `catalog-registry.test.ts` |
| 31 | Package manager façade (`install`/`update`/`uninstall`/`rollback`/`enable`/`disable`) | Done | `manager.ts` (plus `clearBrokenMark`, `hasRollbackPoint`, `listInstalled`) | `installer-runtime.test.ts` |
| 32 | Atomic installation with staging + backup + restore on failure | Done | `installer.ts` (`retainBackup`, rollback point) | `installer-runtime.test.ts` |
| 33 | Update system (single, update all, rollback, retry; no silent execution) | Done | `manager.ts` `update` + `updateWithRetry` (bounded attempts, exponential backoff, injectable sleep); Store "Update all" collects per-extension failures. Retrying the whole batch automatically is still a user decision, so a failure never turns into a silent loop | `manager-dependencies.test.ts` |
| 34 | Enable/disable without uninstalling; enabling re-runs compatibility + lifecycle | Done | `manager.ts` `enable`/`disable` → `runtime.activate`/`deactivate` | `installer-runtime.test.ts` |
| 35 | Acode lifecycle (discover → load entry → initialize → active → unmount → cleanup) | Done | `runtime.ts` `activate`/`deactivate` + `dom/plugin-host.ts` load/activate/unmount | `installer-runtime.test.ts`, `dom-host.test.ts` |
| 36 | `globalThis.acode` (+ `window.acode`) with the documented APIs | Done | `runtime.ts` `buildAcodeGlobal`/`installAcodeRuntime`; `dom/dom-runtime-script.ts` installs the document-level `acode` plugins actually use — including `registerFormatter`/`unregisterFormatter`/`formatters`/`getFormatterFor`/`format` with Acode's normalization and newest-first ordering, `$page.settitle`, `addIcon` with `monochrome` + deduplication, the full dialog suite (`alert`/`confirm`/`prompt`/`select`/`multiPrompt`/`loader`/`toast`/`fileBrowser`) with Acode's shapes and per-kind cancellation, `newEditorFile` through the app's file service, theme-first restore ordering, and async plugin-context propagation through promise chains/timers/listeners | `installer-runtime.test.ts`, `dom-host.test.ts`, `dom-formatters.test.ts`, `formatters.test.ts`, `dom-document.test.ts`, `dom-dialogs.test.ts` |
| 37 | `setPluginInit` semantics | Done | Runtime records it; the document invokes it as `(baseUrl, $page, cache)` | `installer-runtime.test.ts` |
| 38 | `setPluginUnmount` on disable/unload/update/uninstall | Done | `runtime.deactivate` + document-side resource reclamation (timers, listeners, pages, owned formatters); deactivation also deletes the plugin's `cache` data directory while settings survive, matching Acode's unmount cache clearing | `installer-runtime.test.ts` (cache-clear test), `dom-host.test.ts` |
| 39 | `acode.require` module registry (only deliberate modules exposed) | Partial | Document exposes `commands`, `settings`, `storage`, `filesystem` behind grants, plus the dialog modules (`toast`, `alert`, `confirm`, `prompt`, `select`, `loader`, `multiPrompt`) behind `ui`; Acode core modules Ajiro lacks (incl. the generic DOM builders `dialogBox`/`colorPicker`/…) throw descriptively instead of returning a fake stub | `dom-host.test.ts`, `dom-document.test.ts` (dialog modules round trip); Report §4 |
| 40 | `acode.define` with protection for reserved core modules | Done | Reserved names rejected case-insensitively in both the runtime and the document | `installer-runtime.test.ts` |
| 41 | `waitForPlugin` resolves/rejects for every documented case | Done | `runtime.waitForPlugin` | `installer-runtime.test.ts` |
| 42 | `acode.installPlugin` goes through Ajiro's consent + validated install | Done | Document → host → consent drawer in the surface → `manager.install`; refuses with no handler; user can disable the capability entirely | `dom-host.test.ts` ("routes a plugin-initiated install through the consent handler", "refuses … without user consent") |
| 43 | `clearBrokenPluginMark` for controlled retry | Done | `runtime.clearBrokenPluginMark` + Store "Clear broken mark" | `installer-runtime.test.ts` |
| 44 | Plugin initialization context (baseUrl, page context, plugin cache) via adapters | Done | `PluginInitCache`, `baseUrl` handed to the document, real `$page` object | `installer-runtime.test.ts`, `dom-host.test.ts` |
| 45 | Command compatibility | Done | Document `commands.addCommand`/`removeCommand` → `command-registry.ts` → detail view "Run"; `acode.exec` prefers the plugin's own command. `bindKey` is parsed per platform (`key-bindings.ts`), the candidate chords are pushed into the editor document, which claims only those chords and reports them back, and the app dispatches to the owning command. A chord claimed twice is a **conflict** and never fires, and a binding that would steal typed input (a bare or Shift-modified character) is refused outright — a claimed chord is consumed before CodeMirror sees it | `key-bindings.test.ts`, `editorDocument.test.ts`, `dom-host.test.ts` |
| 46 | Filesystem compatibility mapped onto Ajiro's abstractions, scoped | Partial | Package reads + a private data tree only; no Android filesystem, project, or scoped-storage access (deliberate) | `dom-host.test.ts`; Report §4 |
| 47 | Plugin storage isolation (`extensions/<id>` + `extension-data/<id>/…`, uninstall isolation) | Done | `storage.ts` path plan; `host-services.ts` per-kind files; uninstall removes exactly the plugin's trees | `installer-runtime.test.ts`, `dom-host.test.ts` |
| 48 | Plugin page/UI compatibility through a controlled bridge | Partial | Real DOM pages inside the document with an app-level overlay (title + close) and full theme inheritance; `$page.settitle` renames the page; the promise-based dialogs (`alert`/`confirm`/`prompt`/`select`/`multiPrompt`/`loader`/`toast`/`fileBrowser`) render through a native serial queue with per-kind cancellation, loader singleton + unmount teardown, and answers that are never logged; only the generic DOM builders stay unmapped | `dom-host.test.ts` (page state); `dom-document.test.ts` (settitle + full dialog round trip); `dom-dialogs.test.ts`; Report §4 |
| 49 | Web-context compatibility (only what real plugins need; controlled bridge) | Done | Real `window`/`document`/`fetch` in the document; navigation blocked, file access and DOM storage off, permissions enforced per message | `dom-host.test.ts`; Report §5 |
| 50 | Explicit plugin permissions, checked by the runtime before sensitive operations | Done | `permissions.ts` (derive + consent) and per-operation checks in `dom/plugin-host.ts`. Formatter defaults are a preference, not a permission: `formatters.ts` selection stores (memory + preferences-file backed with a 128-entry cap) resolve the default behind an explicit user choice, prune selections whose formatter is gone, and fall back to the newest candidate; format execution is additionally gated on an editor format capability | `dom-host.test.ts` (six refusal tests); `formatters.test.ts`; `dom-formatters.test.ts`; `preferences.test.ts` |
| 51 | Security (traversal protection, validation, atomic install, integrity, permission checks, crash isolation, broken detection, rollback, storage separation, checksums, no blind execution) | Done | `zip.ts`, `manifest.ts`, `installer.ts`, `permissions.ts`, `runtime.ts`, `platform.ts` `hashSha256`. **Publisher signatures** ([AJIRO ORIGINAL], since Acode publishes none): `signature.ts` verifies an optional `{ algorithm: "ed25519", keyId, value }` block with real Ed25519 over a canonical description of the package's own files, and `installer.ts` records the verdict on the record and refuses only when the user's preference (require signed packages + trusted keys, `preferences.ts`) makes that verdict blocking — before anything is staged | `manifest-zip.test.ts`, `installer-runtime.test.ts`, `dom-host.test.ts`, `signature.test.ts`, `signature-install.test.ts`, `preferences.test.ts` |
| 52 | Broken plugin state + diagnostics, no auto-load loop | Done | `models.ts` `PluginRuntimeState`; `runtime.activate` catch → broken + auto-disable + persisted error; `diagnostics.ts`. The transient states (`installing`, `updating`, `uninstalling`) are written around each operation and **reconciled on every read** (`reconcileInterruptedOperations`): an interrupted operation ends as the state the package on disk actually implies, or broken with an explanation | `installer-runtime.test.ts`, `manager-dependencies.test.ts`, `dom-host.test.ts` |
| 53 | Dependency system (discovery, versions, ordering, missing/conflicting/circular reporting) | Done | `dependencies.ts`: version grammar (`^`, `~`, `>=`, `>`, `<=`, `<`, `=`, conjunctions), graph from catalog + installed + root, dependency-first post-order, and reported **missing / version / conflict / circular / unparseable / failed** issues. The Store installs the closure first (each package through its own consent prompt) and shows a dependency report when a plan is blocked | `dependencies.test.ts`, `manager-dependencies.test.ts` |
| 54 | Compatibility evaluator with reasons, `compatible/partial/unsupported/unknown` | Done | `compatibility.ts` `evaluateCompatibility`, including top-level `Worker` construction and bare-`editorManager` references (both `partial` with the touchpoint named), proven against the real runner + snippets manifests; `newEditorFile` and the dialog globals are recognized as supported and no longer weaken the verdict | `catalog-registry.test.ts`; `real-plugin-fixtures.test.ts` |
| 55 | Acode `minVersionCode` mapped through a matrix, `unknown` when it cannot be established | Done | `acode-matrix.ts` + `versionFloorFailure` | `catalog-registry.test.ts` |
| 56 | Versioned compatibility matrix | Done | `acode-matrix.ts` | `catalog-registry.test.ts` |
| 57 | Separate persistence for catalog / installed / runtime state / sync state / diagnostics | Done | `catalog-cache.json`, `installed.json`, `diagnostics.json`, `preferences.json` under `ajiro-agent/extensions/` | `installer-runtime.test.ts`, `dom-host.test.ts` |
| 58 | Offline support (cached catalog, installed list, local details, installed plugins keep working) | Done | Cache-first Store; registry availability is not required to run plugins | `catalog-sync.test.ts` |
| 59 | Extension settings namespaced as `extensions.<pluginId>.<setting>` | Done | `host-services.ts` settings file + Store settings drawer | `dom-host.test.ts` |
| 60 | README/changelog via a safe Markdown renderer (no JS execution) | Done | Store renders both with `react-native-markdown-display`, links restricted to `http(s)` | Screen + lint/typecheck |
| 61 | Icons and assets resolved from the package, traversal rejected, thumbnails kept separate | Done | `extensionIconUri` (package icon validated with `isSafePluginPath`, else an `https` thumbnail) | `dom-host.test.ts` (path safety); screen |
| 62 | Repository link only when the metadata supplies one | Done | "Open source" button renders only for a real `repository` value | Screen |
| 63 | Non-intrusive discovery notification, controllable in settings | Done | Sidebar count badge gated by `notifyOnDiscovery`; plugin notifications render as inline notices | `preferences` + sidebar; `dom-host.test.ts` (notify routing) |
| 64 | Automatic discovery vs. automatic update separation | Done | Sync is automatic; install/update/enable are explicit user actions (update-all is still a user action) | `installer-runtime.test.ts` |
| 65 | No package prefetching from the catalog | Done | Only catalog metadata is fetched automatically; packages download on demand | `catalog-sync.test.ts` |
| 66 | Large catalog support (pagination, incremental sync, lazy images, normalized storage, no full READMEs in memory) | Done | Registry paging (`plugin/all?page=&limit=` with an early break), Store paging, `expo-image` lazy loading, README read on demand and capped at 20 KB, and an **inverted trigram index** (`buildCatalogSearchIndex`/`searchCatalogIndex`) built once per catalog revision, so typing searches candidates instead of every description | `catalog-search.test.ts`; screen |
| 67 | Ajiro theme compatibility (all UI inherits the active theme) | Done | Store uses theme tokens/`withAlpha`; the plugin document receives the resolved theme as plain colors | Screen; `dom-host.test.ts` (document theme) |
| 68 | No removal of existing Ajiro features (MCP, skills, terminal, projects, themes, agent, models) | Done | Purely additive: new modules, two new route/sidebar entries, two additions to the root layout | `git status` scope; full suite green |
| 69 | React Native + Expo + TypeScript architecture reused | Done | Expo Router screen, existing UI kit/providers, expo-file-system/expo-crypto, `react-native-webview` | lint/typecheck |
| 70–74 | Per-plugin migration/compatibility testing and documentation of incompatibilities | Partial | Documented per-API and per-fixture in the compatibility report; the three real `plugin.json` files are frozen verbatim as fixtures and analysed (parse + lifecycle + static-analysis proofs), and the three *published builds* are downloaded and validated end to end behind `AJIRO_E2E_NETWORK=1` (device execution remains out of reach) | Report §4, §7, §9; `real-plugin-fixtures.test.ts`, `real-manifest-lifecycle.test.ts`, `e2e-archives.test.ts` |
| 75 | Automated test suite (manifest, ZIP, installation, registry, runtime, dependencies, security) | Done | 312 tests across 25 extension/editor files (1114 across the repo, +3 network-gated), including signature verification and enforcement, a dedicated dependency suite (version grammar, ordering, missing, version mismatch, conflict, circular, unparseable), key-binding and conflict tests, catalog search-index/state-filter/featured tests, manager tests for dependency-first installs, retry backoff, and interrupted-operation reconciliation, a suite that executes the real plugin host document in a real DOM end to end, plus formatter registry/selection/host suites, registry check-update probe tests, verbatim real-manifest fixture suites, static-analysis fixture proofs, dialog/normalizer/host/executed-document dialog suites, theme-ordering tests, and a network-gated suite validating the three published builds | `npx vitest run src/modules/extensions src/editor` |
| 76 | Dynamic registry test (A+B → A+B+C with no binary change) | Done | `catalog-sync.test.ts` / `catalog-registry.test.ts` diff + merge coverage | `catalog-sync.test.ts` |
| 77 | Live dynamic Store test | Done | Snapshot subscription repaints the open Store | `catalog-sync.test.ts` |
| 78 | New version test (1.0.0 + registry 1.1.0 → Update available) | Done | `deriveExtensionInstallState`/`findUpdateAvailable` | `catalog-registry.test.ts` |
| 79 | Offline test (cached A/B/C remain available) | Done | Cache preserved on sync failure | `catalog-sync.test.ts` |
| 80 | Duplicate test (repeated sync never duplicates) | Done | Canonical-id merge in `mergeCatalogEntries` | `catalog-registry.test.ts`, `catalog-sync.test.ts` |
| 81 | End-to-end automatic catalog update → user install → validated → consent → installed → initialized | Done | Registry → sync → Store → `manager.install` → consent → atomic install → `runtime.activate` → document | `catalog-sync.test.ts`, `installer-runtime.test.ts`, `dom-host.test.ts` |
| 82 | No 100% compatibility claim without testing | Done | Report states `compatible/partial/unsupported/unknown` with reasons and lists the untested surface | Report §3–§6, §9 |
| 83 | Technical compatibility report | Done | `docs/extensions/acode-compatibility.md` | — |
| 85 | Dynamic ecosystem, but automatic discovery never means automatic execution | Done | Catalog sync vs. explicit install/enable; plugin-initiated installs require consent | `catalog-sync.test.ts`, `dom-host.test.ts` |
| 86 | Completion criteria (1–24) | Partial, by explicit list | Met: 1–5 (sources inspected), 6–11 (packages, sync, discovery without an APK update, version detection incl. the server check-update probe, offline cache, live Store updates), 12–13 (secure install, lifecycle incl. unmount cache clearing and theme-first restore), 14 (Acode global API to the documented extent, now incl. the formatter registry, `settitle`, monochrome `addIcon`, the full dialog suite, `newEditorFile`, and `fileBrowser`), 15 (versioned dependency resolution, ordering, conflict/circular detection), 16 (plugin settings), 17–19 (recovery, crash isolation, rollback), 20–22 (existing features and themes intact, 1114 tests pass), 23 (published builds validated end to end behind `AJIRO_E2E_NETWORK=1`), 24 (limitations documented). **Not met:** device-runtime execution (needs a device; analysis + validation run against the real builds) | This matrix, Report §9 |

## Known incomplete items (short list)

These are the only places where the prompt asks for more than what is built:

1. **Editor/project module instances, LSP, file handlers, terminal API**
   (§39/§46) — deliberately withheld for security and scope reasons.
   Scoped editor access (active-document read/replace, file creation,
   formatter dispatch through the registered editor access) is implemented
   and tested; what stays out is the editor/project *instance* itself, plus
   the native subsystems Ajiro does not have (LSP client, terminal emulator,
   file-type handler registry). Generic DOM dialog builders (`dialogBox`,
   `colorPicker`, …) are unmapped for the same reason: they construct
   Acode's own DOM.
2. **Publisher signatures that already exist in the wild** (§51) — verification
   is implemented, enforced, and tested, but Acode publishes no signatures, so
   every stock plugin is honestly reported as `Unsigned`. Requiring signatures
   is therefore a policy for publishers who sign with a key the user trusts,
   not a check that Acode packages already satisfy.
3. **Device-runtime execution** (§86 #23) — the three published builds are
   downloaded and validated end to end behind `AJIRO_E2E_NETWORK=1`
   (`e2e-archives.test.ts`); only *executing* them needs a device.
Recently closed (kept here for auditing honesty): versioned dependencies,
ordering and conflict/circular detection (§53/§75); command key bindings (§45);
persisted transient states plus reconciliation (§52); featured shelf and
Installed state filters (§28); trigram search index (§66); retry with backoff
(§33); **real execution of the generated plugin document** —
`dom-document.test.ts` now builds the actual document, runs it in a real DOM
(jsdom, a dev dependency) and drives it with the real `PluginDomHost`, so the
in-document script is exercised rather than reasoned about; and **publisher
signature verification** is wired end to end — recorded on every install,
enforced when the user requires it, editable in the Store's trust store, and
applied to every package in a dependency closure. Executing the document
immediately found three real defects: plugin commands run from the app had no
executing-plugin context (so their notifications and writes were refused);
unmounting deleted the plugin's permissions before its own unmount callback
ran (so state saved at shutdown was silently dropped); and an unmounted
plugin's commands stayed in the app's registry, still listable and runnable.

Closed since the previous audit: **formatter registry parity** (Acode's
normalization, newest-first ordering, and `[None, …]` options shape, with
per-language defaults persisted in preferences, pruned when stale, and
selectable in the detail view; `formatters.test.ts` + `dom-formatters.test.ts`
+ executed-document coverage); **per-plugin check-update probing** behind
catalog comparison (`checkServerUpdates`, unioned into the badge / update-all
/ filter / detail note); **JSON-encoded registry shapes** (keywords and
contributors decoded, flat `author_*` merged) with an inline-README fallback;
**`$page.settitle` and monochrome/deduplicated `addIcon`**; **unmount cache
clearing** with settings preserved; **verbatim real-manifest fixtures** for
the three seed plugins with lifecycle expectations; and **static-analysis
rules for `Worker` and bare `editorManager`** proven against the real
runner + snippets manifests.

Closed in this audit: **the full native dialog suite** (`alert`/`confirm`/
`prompt`/`select`/`multiPrompt`/`loader`/`toast`/`fileBrowser` with Acode's
shapes and per-kind cancellation, rendered natively, answers never logged,
plus the `require()` module forms; `dom-dialogs.test.ts` + executed-document
coverage); **async plugin-context propagation** (promise chains, timers, and
listeners attribute to the calling plugin — found because the dialog chain
test failed, proving chained `confirm().then(prompt())` was refused before);
**`newEditorFile`** (creates in the active project via the app's own file
service + `FILE_CREATED`); **theme-first restore ordering** (verbatim
identifier set); **network-gated real-build E2E** (`e2e-archives.test.ts`,
all three published builds validated); **seed downloads through the
registry** (GitHub `main.zip` source archives are not installable —
verified via the contents API); and **`./`-prefixed manifest asset
resolution** (found because the E2E failed: `dist/main.js` never matched).
The evaluator no longer flags `newEditorFile` or the dialog globals.

## Deliberate deviations

1. **Entry-script execution uses one shared webview document**, not Acode's
   "inject `<script src>` into the app webview". Reason: Ajiro's own UI runs in
   Hermes, which has no DOM; a controlled document is the only way to give
   plugins real web APIs without exposing the native app.
2. **Dependency edges are read from three sources** — the manifest's flat id
   array (all Acode gives), the catalog entry (which can carry a version), and
   installed records — because Acode itself publishes no versioned dependency
   model. Version ranges are honored when a requirement supplies one and are
   reported as advisory when only the catalog's latest version is visible.
3. **The filesystem module is scoped** to the plugin's package (read) and its
   private data tree (read/write). Project and device filesystem access is not
   part of the plugin surface.
4. **No numeric compatibility score** is produced, per §54.
5. **Plugin UI is a page surface** inside the document rather than mapped
   native widgets, per §48's "map where possible".

## How to re-audit

```bash
npx vitest run src/modules/extensions src/editor   # 312 tests (+3 network-gated), 25 files
npx vitest run                                     # 1114 tests (+3 network-gated), 117 files
AJIRO_E2E_NETWORK=1 npx vitest run src/modules/extensions/__tests__/e2e-archives.test.ts
npx tsc --noEmit                                   # one pre-existing error in
                                                   # src/editor/EditorStatusFooter.tsx
npx expo lint src/modules/extensions src/components/extensions "src/app/(root)/extensions.tsx"
```
