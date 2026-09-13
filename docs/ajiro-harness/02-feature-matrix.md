# B/C. Feature Matrix + Provenance (condensed)

Keep / Adapt / Reimplement verdicts. Confidence: H(igh)/M(edium)/L(ow).

| Area | Source implementation | Ajiro subsystem | Android strategy | Verdict | License | Conf. |
|------|----------------------|-----------------|------------------|---------|---------|-------|
| OS sandbox (Seatbelt/bubblewrap) | sandbox-runtime | permissions/engine + execution-broker (dispatch-layer allow/deny) | No OS primitives for apps; enforce at dispatch | Reimplement (adapted) | Apache-2.0 | H |
| Violation attribution | sandbox-runtime commandId | ProvenanceReceipt + provenance_events table | In-app receipts, persisted | Adapt | Apache-2.0 | H |
| Plugin manifests | official/community plugins | modules/plugins/engine | Pure TS validation | Adapt | mixed APL/MIT | M |
| Agent SDK sessions/streaming/permissions | agent-sdk TS (Commercial Terms) | providers/app-state/agent-run + runtime/stream-bus | Already on-device | Keep | Commercial | H |
| Issue/PR coding workflows | claude-code-action (MIT) | git-tools + GitHub API modules | On-device runs, no runners | Adapt | MIT | M |
| Staged writes/approval/provenance | commerce-agents | safety/staged-writes + provenance repo | In-app gates | Adapt (pattern) | unknown→treat proprietary | M |
| Domain skills/connectors | knowledge-work/financial/tag plugins | skills/lifecycle + engine | Include relevant only | Adapt | mixed | L |
| Agents Build/Plan/General/Explore | OpenCode | agents/modes + registry | Native definitions | Adapt | MIT | M |
| Sessions/SQLite persistence | OpenCode | core/db (17 tables, migrations) | expo-sqlite, WAL | Keep | MIT | H |
| Terminal workflow/tabs/history | OpenCode | modules/terminal (self-contained) | RN+TS only | Reimplement | MIT | H |
| Permissions allow/ask/deny+session | OpenCode (verified dialog keys a/A/d) | permissions/engine | Backend, same UI | Adapt | MIT | H |
| MCP tools/resources/prompts/OAuth | OpenCode + existing Ajiro MCP | modules/mcp (PROTECTED, preserved) | On-device servers kept | Keep/Extend | MIT | H |
| Provider abstraction/models | OpenCode | modules/runtime/model-runtime + universal providers | Network APIs only | Keep | MIT | H |
| Diff/undo/branching | OpenCode | checkpoint-service (adopted, see below) + conversation fork | In-process | Adapt | MIT | M |
| Task workflows | OpenCode | modules/tasks/engine | Pure TS | Adapt | MIT | M |

## Checkpoint-service verdict (dead-code audit)
`core/services/coding/checkpoint-service.ts` had zero callers but implements
§68/§100 file-undo. Verdict: ADOPTED + WIRED — snapshot/commit in all six SAF
mutating tools (edit/write/create-file/delete/move/rename), new `undo` tool
registered (dropped for read-only agents), service constructed per run in
agent-run. Workspace-DB file tools use message-level undo (out of scope).
