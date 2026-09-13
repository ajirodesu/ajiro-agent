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
  content hash), enable/disable + autoMatch (existing repo), keyword scoring
  + ranking (`skills/lifecycle.ts`), supporting files (`skill_files` table),
  import drawer + GitHub import (existing UI kept), MCP access via
  recommended server ids, version + lifecycle metadata without migration.

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
