# Dynamic Updates — Skills, MCP & Plugins Without an APK Rebuild

Scope: the dynamic remote extension/update architecture
(`src/modules/updates/`, `src/modules/skills/skill-registry.ts`,
`skill-update-status.ts`, `skill-rollback.ts`, `src/modules/mcp/catalog.ts`,
`mcp-compat.ts`, the extension-platform additions in `src/modules/extensions/`,
the OTA strategy in `src/modules/updates/ota.ts`, and the Store wiring).
Companion to `extensions/acode-compatibility.md` (Acode parity) and
`extensions/prompt-coverage.md` (that prompt's audit).

Last updated: 2026-09-18.

## 1. The boundary

| Updates without a rebuild | Require a native rebuild |
|---|---|
| Skill markdown/metadata/resources, MCP definitions/endpoints, compatible plugin JS, provider/model metadata, catalogs, compatibility data | Native modules/libraries/APIs/permissions/config, Expo SDK changes, new native capabilities, `expo-updates` activation itself |

The client enforces this with a static native-capability manifest
(`NATIVE_CAPABILITIES` in `extension-framework.ts`). An extension declaring
anything outside it refuses with **Requires App Update** — never installs
half-working, never bypasses the boundary.

## 2. Architecture

```
Remote registries (versioned JSON over HTTPS)
  skills:  catalog/skills.json   (raw.githubusercontent, ETag, 30-min TTL)
  mcp:     catalog/mcp-servers.json (same pattern)
  plugins: Acode registry API    (existing provider, ETag/paging)
     │ conditional fetch (304 = no download) → bundled fallback offline
     ▼
Local catalogs (in-memory + persisted caches; stale-while-revalidate)
     ▼
Stores (Skill / MCP / Plugin) — badges, filters, detail, actions
     ▼
Compatibility engine per type (channel → rollout → revoked → runtime floor →
native caps → deprecated → version/drift)
     ▼
Dynamic Runtime  |  Requires App Update
     ▼
Install → Verify → Stage → Activate (+ rollback point, health log)
```

Shared policy lives in `src/modules/updates/extension-framework.ts`
(channels, trust, native caps, version compare, rollout hashing, revocation
parsing, status labels, local health log) so the three systems cannot drift.

## 3. Registries

| Registry | URL | Sync | Delta |
|---|---|---|---|
| Skills | `SKILL_REGISTRY_URL` (repo `catalog/skills.json`) | ETag/Last-Modified, 30-min TTL, bundled fallback | 304 revalidation; per-skill hash checks on demand |
| MCP | `MCP_CATALOG_URL` (repo `catalog/mcp-servers.json`) | ETag/Last-Modified, 30-min TTL, bundled fallback | 304 revalidation |
| Plugins | `ACODE_REGISTRY_BASE` | ETag/Last-Modified, single-flight, persisted cache | 304 + diff engine |

Fixed in this work: the MCP catalog URL pointed at a nonexistent
`ajirodeu` owner (HTTP 404, verified) and silently fell back forever; it now
points at the real repo, so remote MCP discovery actually works.

GitHub `main.zip` source archives are NOT installable packages (repos do not
commit `dist/`; verified via the contents API). Seed plugin downloads resolve
through the registry (`{ kind: "registry" }`), i.e. the published builds —
the same channel installs and updates use.

## 4. Statuses, channels, trust, revocation

- Statuses (`DynamicUpdateStatus`): Installed, Latest, Update Available,
  Requires App Update, Incompatible, Deprecated, Revoked, Disabled, Offline —
  all derived from registry data, never invented.
- Channels: stable ⊂ beta ⊂ preview. Production default is stable
  (extension preferences + Skill Store chips). Higher-risk channels never
  leak downward; rollout percentages gate deterministically per id.
- Trust (`evaluateExtensionTrust`): verified > trusted > unknown, with
  `invalid`/`blocked`/`revoked` failing closed. Skill hash mismatches fail
  closed at install; skill signatures are presence-recorded until a
  publisher keyring exists (never upgraded on presence alone).
- Revocation is registry-fed: revoked entries refuse install/update,
  installed ones are disabled with a persisted reason on the next sync
  (plugin sweep, skill sweep, MCP setup block + installed finder).
- Rollback: plugins keep the replaced version until activation; skills
  snapshot the pre-update copy (`createSkillRollbackStore`, restorable from
  the Store); failed operations never leave partial state.
- Health telemetry is local-only (`createExtensionHealthLog`, capped ring):
  install/update/rollback/incompatible/revoked events. No remote pipeline
  exists and nothing transmits extension contents.

## 5. OTA application updates

`expo-updates` is installed and configured (`app.json`: `runtimeVersion`
`appVersion` policy, updates URL, `ON_ERROR_RECOVERY`, no auto-polling;
`eas.json`: `stable`/`preview` channels). `src/modules/updates/ota.ts`
checks (startup/foreground/manual), refuses runtime-mismatched updates
before download, stages, and applies on safe restart; failed startups fall
back automatically. Activation prerequisite (honest): the native binary must
be rebuilt once with this config before OTA can reach current installs.

## 6. Prompt coverage (§§1–57)

Statuses: **Done** · **Partial** (deliberate, with reason).

| § | Requirement | Status | Where |
|---|---|---|---|
| 1 | No reinstall for new Skill/MCP/compatible plugin | Done | Registries + stores below; E2E proves published builds validate |
| 2 | Native vs dynamic boundary, no fake native updates | Done | §1 table; `NATIVE_CAPABILITIES`; needs-app-update refusals |
| 3 | Two-layer architecture | Done | Layer A: native binary; Layer B: this document's systems |
| 4 | Versioned registry API (skills/mcp/plugins/providers/models/compat) | Done | Registry modules; provider/model metadata already live-cataloged |
| 5 | Dynamic Skill registry, no hardcoded skills | Done | `skill-registry.ts` (remote + bundled fallback); deltas via 304/hash |
| 6 | Dynamic MCP registry with full metadata | Done | `mcp/catalog.ts` (+ version/channel/revoked/deprecated/floor/caps/changelog/rollout) |
| 7 | MCP install as config through existing transport | Done | Existing runtime untouched; presets configure, never compile in |
| 8 | Plugin version discovery → detect → check → verify → install → activate | Done | Extension platform (prior work) + revocation/channel/native gates (this work) |
| 9 | Plugin runtime boundary + capability permissions | Done | Document host + permission grants (prior work) |
| 10 | No arbitrary native downloads; Requires App Update marking | Done | Installer has no native-download path; native gate marks instead |
| 11 | Version resolution (current/latest/min/max/deps/peers/platforms) | Done | `compareDynamicVersions` + latest-compatible selection; per-type statuses |
| 12 | Skill versioning + visible states | Done | Entry `version` + hash checks; all §43 states in `deriveSkillUpdateStatus` |
| 13 | MCP versioning + transport gating | Done | Entry `version` + drift detection; unknown transports → Requires App Update |
| 14 | Periodic sync (freshness → fetch → validate → compare → notify, no full downloads) | Done | TTL + conditional fetch + metadata-first in all three registries |
| 15 | Versioned manifests | Done | Skill/MCP/plugin entry schemas with additive optional fields |
| 16 | Local extension DB (installed/versions/state/source/hash/timestamps/deps/compat/rollback/trust) | Done | SQLite (skills/MCP) + installed records (plugins); works offline |
| 17 | Offline-first (cached browsing, installed keeps working, stale indicator) | Done | Bundled fallbacks + persisted caches + offline/stale UI states |
| 18 | Controlled background checking (startup/foreground/manual, no polling) | Done | Sync observers + manual Refresh; OTA manual-gated |
| 19 | Configurable intervals/TTLs | Done | Per-registry TTL constants; manual Refresh in each store |
| 20 | Delta/incremental (ETag/Last-Modified/hashes, no re-downloads) | Done | Conditional fetch everywhere; hash-short-circuit installs |
| 21 | Content addressing (verify hash, never trust name/URL/version) | Done | Skill `expectedHash` gate; package SHA recording (plugins) |
| 22 | Signed registry data (verify, reject failures) | Partial | Plugins: full Ed25519 (prior work). Skills/MCP: hash verification now; signatures presence-recorded until a keyring exists |
| 23 | Trust states, no silent invalid installs | Done | `evaluateExtensionTrust` + fail-closed paths in all installers |
| 24 | Emergency revocation (stop/prevent/disable/notify/restore) | Done | Registry-fed revocation in all three systems + sweeps + rollback |
| 25 | Rollback every update | Done | Plugin retained backups; skill snapshots + Store button; validate-before-write |
| 26 | Safe activation pipeline | Done | Download → verify → stage → validate → install → initialize → health → activate (each system) |
| 27 | Crash/health monitoring, auto-disable loops | Done | Broken marks + auto-disable (plugins, prior work); local health log (all) |
| 28–30 | Store dynamic flows (Skill/MCP/Plugin) | Done | All three screens sync → detail → check → install → verify → runtime |
| 31 | UI reflects catalog changes automatically | Done | Registry refresh repaints lists/counts/categories/versions/states |
| 32 | Skills↔MCP↔Plugin interop through checks | Done | Recommended-MCP status (advisory); plugin manifest refs trust-gated; no silent cross-installs |
| 33 | Unified discovery abstraction | Done | Per-type registries + one shared policy framework (no forced single API, per the prompt's own allowance) |
| 34 | Central update manager duties | Done | Per-type managers + shared framework; each covers check/compat/download/verify/install/rollback/health/status |
| 35 | Compatibility engine (version+runtime+platform+caps+deps+permissions) | Done | Per-type gates + `checkNativeRequirements`; incompatible shows Requires App Update (§42) |
| 36 | Native capability manifest | Done | `NATIVE_CAPABILITIES` + requirement checks pre-install |
| 37 | Rebuild decision classification | Done | §1 table enforced in code, not just docs |
| 38–40 | Expo OTA layer, separate from registries, safe strategy | Done | Config + `ota.ts` (runtime-gated check/stage/apply/recover); rebuild prerequisite stated |
| 41 | No-rebuild guarantees | Done | All four green paths work; native-requiring paths refuse with reason |
| 42 | Requires-update UX, no install anyway | Done | "Requires App Update" states + install/setup refusal in all stores |
| 43 | Store version visibility from real data | Done | All eight states derived, not hardcoded |
| 44 | Channels, production defaults stable | Done | Channel parsing/visibility + selectors (extension prefs, skill chips) |
| 45 | Gradual rollout + no blind pushes | Done | `rolloutAllows` gating discovery/updates; checks precede every push |
| 46 | Sync failure keeps app usable | Done | Cache preservation + backoff + non-blocking startup + stale states |
| 47 | Transactional consistency | Done | Atomic installs, validate-before-write, reconciliation reads |
| 48 | Full security requirements | Done | TLS (HTTPS-only URLs), hashes, signatures (plugins), permissions, validation, sandboxing, path restrictions, revocation, rollback |
| 49 | Telemetry/health (optional, private) | Done (local) | `createExtensionHealthLog` + manager/hook recording; no remote upload by design |
| 50–52 | Testing dynamic skills/MCP/plugins | Done | Registry/sync/install/update/rollback/offline/incompatible/revoked suites per type |
| 53 | Testing OTA | Done | Compatible/incompatible/mismatch/staging-failure unit tests (mocked native module) |
| 54–57 | Order, architecture, behavior, final rule | Done | This document; remote → verify → compatible → install, native → rebuild |

## 7. Verification

```
npx vitest run src/modules/updates src/modules/skills src/modules/mcp  # 96+ tests
npx vitest run src/modules/extensions                                  # 278 tests (+3 network-gated skips)
npx vitest run                                                          # 1163 tests (+3 skips), 122 files
AJIRO_E2E_NETWORK=1 npx vitest run src/modules/extensions/__tests__/e2e-archives.test.ts
npx tsc --noEmit   # one pre-existing error in EditorStatusFooter.tsx
npx expo lint <touched paths>  # clean
```
