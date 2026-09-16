# H/I/J. MCP + Skills + Plugins (+W preservation)

## MCP — existing implementation PROTECTED (§§21, 77, 79, W)
- Kept verbatim: transports (SSE/streamable HTTP), OAuth (loopback + PKCE),
  header auth, connection state/reconnect, enable/disable, logs, discovery,
  tool definition sanitizing, display names, server instructions.
- Removed ONLY Termux-specific code: task await/poll/watch helpers,
  `execute_command` special-casing, background-task watcher, SSE native
  module, `termux` record field. Generic tools now complete inline with
  completed/failed records (running streaming was termux-only).
- Extended: generic execute wrapper preserved with records; MCP tools flow
  through agent permissions (server allow-list, read-only filtering).
- MCP tests all pass; no previously-working server behavior changed
  (termux-mcp servers simply lose their bespoke task-streaming path and
  behave like every other MCP server).
- Network-hosted MCP = external service, NOT a remote execution runtime.

## Skills (§19, I)
- SKILL.md discovery (`discoverSkillFromMarkdown`: frontmatter version else
  content hash), enable/disable + autoMatch, keyword scoring + ranking
  (`skills/lifecycle.ts`), supporting files (`skill_files` table), import
  drawer + GitHub import.
- Strict frontmatter validation (`skills/skill-validation.ts`, lobehub-style
  typed errors: name kebab ≤80, single-line description, bundle-name lock).
- Scopes (`skills/skill-scopes.ts`): global / project / agent (deny-wins via
  `toolPermissions.skills`, no migration) / conversation-selected /
  runtime-active; inline-vs-catalog split prevents duplicate injection.
- Project skills: SAF scan of `.agents/skills`, `.claude/skills`,
  `.ajiro/skills` (read-only context; no Electron IPC).
- Skill Store (`catalog/skills.json` curated from official Anthropic skills
  + `settings/skill-store.tsx`): browse/search/filter/detail/install/update/
  uninstall with rollback; update checks by content hash.
- Composer Skills Modal (search, sections, detail, enable, project install)
  bound to real `selectedSkillIds` runtime state.
- Management (`settings/skills/[id].tsx`): validated create/edit, agent
  assignment display, project pinning (`ProjectCodingSettings.skillIds`, no
  migration), MCP dependency inspection.
- Runtime: `skill`/`skillReadFile`/`manageSkill`/`importSkillFromUrl` tools
  plus `skillRunScript` (own-file allow-list, Linux headless, destructive
  approval); skill-link import routes appended as system hints;
  `recommendedMcpServerIds` surfaced with availability status everywhere —
  MCP itself untouched and authoritative for execution.

## Plugins (§20, J)
- `modules/plugins/engine.ts`: strict manifest validation (name/semver/lists),
  sources (official/community/third-party/local), trust (trusted/quarantined/
  blocked; third-party quarantined by default, installs disabled),
  review (trust/block), enable gate (trusted only), semver compare,
  capability fan-out only when trusted AND enabled.
- Hooks/MCP/tools/commands/skills/agents carried as manifest data; execution
  of contributed capabilities routes through permission + broker like
  everything else. Quarantine + provenance required before enable.

## Memory (§23)
Project/session/user-preference/automatic memory via existing memory store +
file store; retrieval/edit/delete/validation kept; secrets never intentionally
stored (redaction guards at boundaries).
