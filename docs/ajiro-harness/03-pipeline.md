# D/E. Request Lifecycle + Agent Loop

## Pipeline stages (`modules/runtime/pipeline.ts`)
USER INPUT → input_validated → attachments_resolved → project_resolved →
instructions_resolved → memory_resolved → skill_resolved → plugin_resolved →
mcp_resolved → tools_discovered (deferred) → agent_selected → context_built
(budgeted) → model_requested → streaming (bus) → thinking (status only) →
tool_requested → permission_evaluated (central engine) → executed (broker →
android_local; linux only if provisioned; never remote) → tool_result →
context_updated → [loop: model_requested | tool_requested] → validated →
reviewed → completed → persisted. Terminal stages: failed / cancelled from
anywhere. Transitions are validated (`isValidTransition`); illegal jumps are
dropped, not executed.

## Agent loop (§14)
MODEL RESPONSE → inspect stop condition → tool request?
YES → permission → execute → tool result → model again (maxIterations per
mode, settings-capped); NO → final response. Parallel/sequential/dependent
tools via the AI SDK tool loop; errors → model-visible results; denial →
approval UI; cancellation via AbortController; timeouts per tool;
background execution via run persistence + resume; subagents via the task
tool with isolated context and restricted tools.

## Canonical message model (§11, `modules/chat/message-model.ts`)
- ProviderMessage (wire): text / thinking / tool-call / tool-result / image.
- RuntimeMessage (internal): identity + sequence + status + blocks
  (text/thinking/tool-call/tool-result/code/attachment).
- UiMessage (render): markdown/code/tool/thinking-collapsed/attachment/error
  segments + streaming/failed flags. Pure converters, tested.

## Streaming (§12, `modules/runtime/stream-bus.ts`)
Legacy runtime events normalize to one bus:
message_start, content_block_start, text_delta, reasoning_delta,
tool_input_delta, tool_call_start/end, step_start/end, message_delta (usage),
message_stop, stream_error, stream_abort. Unknown names drop (counted).
Smoothing + 60s stall watchdog already in ai-sdk-runtime (kept).

## Thinking (§13, `modules/runtime/thinking.ts`)
Status + progress only (`Thinking…`, `Analyzing the project…`,
`Reading files…`, `Running tests…`). Provider summaries pass through
verbatim; nothing invents chain-of-thought.
