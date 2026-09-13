/**
 * Thinking/reasoning presentation (§13): status + progress only. Never
 * exposes or fabricates private chain-of-thought — only provider-supplied
 * summaries (passed through verbatim) and activity-derived status lines.
 *
 * Source provenance: [AJIRO ORIGINAL]; presentation vocabulary follows
 * publicly observable agent UX.
 */
export type ThinkingStatus =
  | "thinking"
  | "analyzing"
  | "reading"
  | "searching"
  | "editing"
  | "running"
  | "testing"
  | "building"
  | "waiting-approval"
  | "waiting-input"
  | "compacting"
  | "done";

const STATUS_LABELS: Record<ThinkingStatus, string> = {
  thinking: "Thinking…",
  analyzing: "Analyzing the project…",
  reading: "Reading files…",
  searching: "Searching…",
  editing: "Editing files…",
  running: "Running…",
  testing: "Running tests…",
  building: "Building…",
  "waiting-approval": "Waiting for approval…",
  "waiting-input": "Waiting for input…",
  compacting: "Compacting context…",
  done: "Done",
};

export function thinkingLabel(status: ThinkingStatus): string {
  return STATUS_LABELS[status];
}

/** Derive a safe status line from run activity (tool names -> verbs). */
export function statusForTool(toolName: string): ThinkingStatus {
  const lower = toolName.toLowerCase();
  if (/read|cat|list|glob|grep|search|explore/.test(lower)) return "reading";
  if (/edit|write|apply|patch/.test(lower)) return "editing";
  if (/test|jest|vitest|pytest/.test(lower)) return "testing";
  if (/build|gradle|compile/.test(lower)) return "building";
  if (/exec|run|terminal|shell|command/.test(lower)) return "running";
  if (/git|diff/.test(lower)) return "analyzing";
  return "thinking";
}

/** Progress text with an optional bounded percent; no internals leak. */
export function progressText(
  status: ThinkingStatus,
  percent?: number,
): string {
  const label = thinkingLabel(status);
  if (percent === undefined || Number.isNaN(percent)) return label;
  const clamped = Math.min(100, Math.max(0, Math.round(percent)));
  return `${label} ${clamped}%`;
}
