# N/O/P. Filesystem + Git/GitHub + Android Build

## Filesystem (§53, N)
App-private project storage + SAF trees (persisted URI permissions) +
authorized external dirs via folder picker; temp/artifact/cache separation.
Path guard (`safety/guards.ts`): no absolute paths, no `..`, no null bytes,
normalized project-relative. Never assumes unrestricted access.

## Git (§54, O-partial)
On-device via isomorphic-git over the SAF adapter: status/branches/commits/
diff/staging/change tracking/undo via checkpoint-service (adopted, wiring
pending — see 02). Push/pull need network + approval. Worktrees where the
JS implementation allows; limitations reported per operation, never silent.

## GitHub (§§55–56, O-partial)
Authenticated REST APIs (repos/issues/PRs/comments/branches/commits/checks/
reviews) + release/update flow + `claude-code-action`-style issue/PR review
workflows adapted to local runs. All agent work on-device; mutations
approval-gated (staged writes for push-class actions).

## Android build (§§50–52, P)
- Lifecycle supportable today: source editing, in-process checks, diff
  review, artifact handling — full edit→verify loop on-device.
- Toolchain detection: `linux-provision.ts` (shell/coreutils/git/node/npm/
  python/java/gradle/cmake/clang) with honest missing reports.
- APK install: `device/apk-install.ts` — staged-write approval first, then
  platform installer intent; never silent.
- NOT bundled: full userspace, Gradle distribution, NDK (size budget);
  optional downloadable toolchains are the mechanism. Detect-before-start
  is implemented at the broker (limitation errors name the missing piece).

## Device-only workflow (§§31, 100)
Open → project → ask → explore → plan → modify → terminal checks → diagnose
→ repair → diff review → build (toolchains permitting) → APK → install/test
on the same device → repeat. No PC/laptop/Termux/remote at any step.
