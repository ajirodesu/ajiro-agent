# F/G. Context + Tool Architecture

## Context engine (§24)
- Sources tracked: conversation, instructions, memory, skills, plugins, MCP,
  tools, files, terminal output, Git state, tasks, plans, attachments,
  subagent results (`modules/context/engine.ts`).
- Budgeting: per-source priorities + pinned set (system instructions, active
  task never drop) + per-source hard truncation + drop list + restore points.
- Existing kept: summarizer, compaction, token estimator, pruner, overflow,
  repo-map, usage/compact action (OpenCode-style indicator preserved).
- Context optimization (§87-88): relevance ordering, deferred tools (§25),
  compaction/summaries, selective file loading; large conversations rely on
  the existing virtualized message list (UI untouched).

## Tool architecture
- Registry: built-in tools (ai `tool()` + zod), coding tools (exec allow-list,
  git), MCP runtime tools (generic wrapper; termux path removed), skill/agent/
  schedule/question/task tools. One ToolSet per run, filtered by agent mode
  (`filterToolsByAgentPermissions`: read-only modes drop mutating tools),
  MCP server allow-list, plan/subagent read-only MCP filtering.
- Deferred discovery (§25, `modules/tools/deferred.ts`): capability registry
  scores signals→schemas; each request carries relevant schemas only.
- Schemas carry token costs for budgeting. No shell strings anywhere on the
  exec path (stable command IDs).

## Agent modes (§15, `modules/agents/modes.ts`)
Build/Plan/Explore/General/Review/Debug/Test/Android/Git/Security/
Documentation primaries + Explorer/Planner/CodeAnalyst/TestAgent/
SecurityReviewer/AndroidAgent/DocumentationAgent subagents. Each: instructions,
readOnly, maxIterations (min() with user setting, enforced in agent-run),
contextPolicy, runtime preference, skill hints. Registered as native agents;
user rows override by name (existing behavior kept).

## Subagents (§16, K)
Task tool spawns with isolated context, restricted tools (deny-list),
own iteration budget, parallel execution, cancellation via run abort,
result returned as tool output. No sub-subagents.
