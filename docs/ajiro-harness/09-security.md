# T. Security Architecture (§§96–99)

## Threat coverage
| Threat | Mitigation |
|---|---|
| Prompt injection (repos, plugins, skills, MCP, tool output) | Untrusted-by-default (third-party plugins quarantined, installs disabled); tool output is data, never instructions; pipeline validates transitions |
| Malicious plugins/skills/MCP | Manifest validation, quarantine + review gate, capability fan-out only when trusted+enabled, permission-gated execution, provenance log |
| Command injection | No shell: stable command IDs + zod-validated args; terminal fails closed (127) |
| Path traversal | `validateProjectPath` (no absolute/`..`/null bytes) at filesystem boundaries |
| Secret leakage | `redactSecrets` (keys/bearer/token/password/private-key/gh_/sk-); secrets excluded from context/logs/tool output; SecureStore for credentials; never intentionally stored in memory |
| Malicious packages/scripts | package-install class defaults to ask/deny; Linux slot unprovisioned → cannot silently install toolchains |
| Hostile web content | No WebView terminal; fetched content treated as data |

## Secret management (§97)
Android SecureStore for API keys/OAuth/GitHub tokens; redaction at log,
tool-output, and context boundaries; OAuth via loopback + PKCE (kept).

## Provenance (§98)
`ProvenanceReceipt` per broker execution (action/agent/tool/runtime/
permission/timestamps/session) + persisted `provenance_events` table
(migration v26, repository with session/action queries + pruning).

## Staged writes (§99)
proposal → validation → user review → approval → apply (`safety/
staged-writes.ts`); kinds: fs-delete/overwrite, git-force/branch-delete/
push, apk-install, credential-change, mcp-privileged. Applied only through
the broker after approval. APK install additionally requires the OS
installer prompt (never silent).
