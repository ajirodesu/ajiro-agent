/**
 * Canonical request-processing pipeline: the stage model every user request
 * flows through. Stages are traced (not re-executed) here; the existing
 * agent runtime performs them. Executable stages stay on-device by
 * construction — the only execution sink is the execution broker.
 *
 * Source provenance: [AJIRO ORIGINAL] stage list and tracer; stage
 * semantics follow [CLAUDE CODE] and [OPENCODE] publicly observable agent
 * loops (model -> tools -> permission -> execute -> model-again).
 */
export type PipelineStage =
  | "input_validated"
  | "attachments_resolved"
  | "project_resolved"
  | "instructions_resolved"
  | "memory_resolved"
  | "skill_resolved"
  | "plugin_resolved"
  | "mcp_resolved"
  | "tools_discovered"
  | "agent_selected"
  | "context_built"
  | "model_requested"
  | "streaming"
  | "thinking"
  | "tool_requested"
  | "permission_evaluated"
  | "executed"
  | "tool_result"
  | "context_updated"
  | "validated"
  | "reviewed"
  | "completed"
  | "persisted"
  | "failed"
  | "cancelled";

export const PIPELINE_ORDER: PipelineStage[] = [
  "input_validated",
  "attachments_resolved",
  "project_resolved",
  "instructions_resolved",
  "memory_resolved",
  "skill_resolved",
  "plugin_resolved",
  "mcp_resolved",
  "tools_discovered",
  "agent_selected",
  "context_built",
  "model_requested",
  "streaming",
  "thinking",
  "tool_requested",
  "permission_evaluated",
  "executed",
  "tool_result",
  "context_updated",
  "validated",
  "reviewed",
  "completed",
  "persisted",
];

const TERMINAL_STAGES: PipelineStage[] = ["failed", "cancelled"];

export type PipelineEvent = {
  stage: PipelineStage;
  at: string;
  detail?: string;
};

/** True when `next` may legally follow `stage` (loops allowed backwards). */
export function isValidTransition(
  stage: PipelineStage | null,
  next: PipelineStage,
): boolean {
  if (stage === null) return next === "input_validated";
  if (TERMINAL_STAGES.includes(next)) return true;
  if (next === "tool_requested") {
    return (
      stage === "streaming" ||
      stage === "thinking" ||
      stage === "context_updated"
    );
  }
  if (next === "model_requested") {
    return stage === "context_built" || stage === "context_updated";
  }
  if (next === "context_updated") {
    return stage === "tool_result";
  }
  const order = PIPELINE_ORDER.indexOf(stage);
  const nextOrder = PIPELINE_ORDER.indexOf(next);
  return nextOrder >= order;
}

export type PipelineSink = (event: PipelineEvent) => void;

/** Creates a tracer that validates transitions and forwards to the sink. */
export function createPipelineTracer(sink?: PipelineSink) {
  let current: PipelineStage | null = null;
  const events: PipelineEvent[] = [];
  return {
    events,
    current: () => current,
    trace(stage: PipelineStage, detail?: string): boolean {
      if (!isValidTransition(current, stage)) return false;
      current = stage;
      const event: PipelineEvent = {
        stage,
        at: new Date().toISOString(),
        ...(detail ? { detail } : {}),
      };
      events.push(event);
      sink?.(event);
      return true;
    },
  };
}
