# Z/AA. Test Matrix + Limitations (+W/X confirmation)

## Validation performed this build (Z-partial)
- Unit: 400+ vitest cases (runtime, permissions, broker, terminal
  parser/buffer/session/adapter/search, pipeline, stream bus, message model,
  tasks, plugins, skills lifecycle, context, deferred tools, staged writes,
  guards, provisioner, installer, thinking, modes, DB consistency incl.
  auto-cover of the new provenance table) — all passing on node.
- Static: tsc (Expo base config) clean; ESLint 0 errors.
- Agent+terminal loop (§94): broker→adapter path unit-tested (permission,
  limitation, receipt, stages); on-device run pending.
- MCP validation (§92): suite green; generic server behavior unchanged;
  termux-mcp bespoke streaming removed by mandate (only behavioral delta).
- NOT yet run: `expo export`, Android build, on-device matrix (§90:
  Android 12–16, low/mid/high-end, tablets, hardware keyboards, densities,
  dark/light), performance measurements (§89), terminal lifecycle recovery
  on-device (§93).

## MCP preservation (W) — confirmed
Transports, OAuth, discovery, records, server filtering intact; only
Termux branches removed. Suite green.

## UI preservation (X) — confirmed
No visual/component-structure changes; composer/messages/Markdown/tool
cards/thinking/permission UI untouched; terminal additions are functional
controls in existing language. No UI files deleted.

## Known Android limitations (AA)
1. No general shell/process spawn for apps → allow-list checks only.
2. No OS sandbox primitives → dispatch-layer enforcement instead.
3. No bundled Linux userspace → shell/package/build ops report honestly.
4. No git binary → isomorphic-git subset (worktrees/partial ops limited).
5. APK/AAB generation needs provisioned toolchains (not bundled).
6. Full typecheck (tsc) of projects needs node tooling → in-app checks are
   parse-level (documented in exec descriptions).
7. Terminal scroll-jump to search matches not implemented (highlight +
   count + cycling done).
8. ~~Checkpoint undo engine unwired to edit funnels~~ DONE: wired into all
   six SAF mutating tools + new `undo` tool (read-only agents drop it).
9. ~~Session fork/branch/archive/search missing~~ DONE at repository level
   (fork/branch-from-message/search/archive) + Fork/Archive menu items;
   sidebar text search pre-existed.
10. ~~PRoot download flow missing~~ DONE: manifest fetch + download +
    sha256 verify + states (`runtime/provision-download.ts`); bundles still
    need a published manifest URL (no invented endpoint).
11. Research depth: sandbox-runtime, opencode README, agent-sdk README
    verified firsthand (incl. opencode archival → Crush correction);
    remaining repos mapped at structure level with honest labels.
