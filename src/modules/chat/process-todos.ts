/**
 * Process todo list state model. Pure derivation from real process state —
 * no timers, no animation-driven flags, no local step copies.
 *
 * Source of truth: the live assistant message's `metadata.todoList`,
 * maintained atomically by the agent through the built-in `todos` tool
 * (`onTodosChange` replaces the whole list + triggers a store refresh).
 * Run liveness comes from `currentConversationRunStatus`.
 *
 * Mapping rules (accuracy guarantees):
 * - `completed` -> done (checkmark) iff the store says completed.
 * - `in_progress` -> active (highlight) for the LAST such item in execution
 *   order only, so at most one step is ever highlighted. Earlier
 *   `in_progress` items (model emitted two) fall back to pending: neutral,
 *   never checked.
 * - `in_progress` + run `failed` -> failed (distinct indicator, never a
 *   checkmark, never the active highlight).
 * - Cancel/completion removes the run from active statuses, so the panel
 *   unmounts with no orphaned state (nothing is stored locally).
 */
import type {
  AgentRunStatus,
  TodoListItem,
} from "@/core/types/app-state";

export type ProcessStepState = "pending" | "active" | "done" | "failed";

export type ProcessStep = {
  id: string;
  title: string;
  state: ProcessStepState;
};

const ACTIVE_RUN_STATUSES: ReadonlySet<AgentRunStatus> = new Set([
  "queued",
  "running",
  "waiting_for_approval",
  "waiting_for_question",
  "resumable",
  "retrying",
]);

export function isProcessActiveStatus(
  status: AgentRunStatus | null | undefined,
): boolean {
  return status !== null && status !== undefined
    ? ACTIVE_RUN_STATUSES.has(status)
    : false;
}

export function deriveProcessSteps(
  todoList: TodoListItem[],
  runStatus: AgentRunStatus | null | undefined,
): ProcessStep[] {
  const runFailed = runStatus === "failed";
  let lastInProgressIndex = -1;
  for (let index = 0; index < todoList.length; index += 1) {
    if (todoList[index].status === "in_progress") {
      lastInProgressIndex = index;
    }
  }

  return todoList.map((item, index) => {
    if (item.status === "completed") {
      return { id: item.id, title: item.title, state: "done" as const };
    }
    if (item.status === "in_progress" && index === lastInProgressIndex) {
      return {
        id: item.id,
        title: item.title,
        state: runFailed ? ("failed" as const) : ("active" as const),
      };
    }
    return { id: item.id, title: item.title, state: "pending" as const };
  });
}

/**
 * Latest assistant message carrying a todo list, scanning from the end so a
 * new run's list supersedes a previous run's (no cross-process leakage).
 */
export function findLiveTodoList(
  messages: {
    role: string;
    metadata?: { todoList?: TodoListItem[] } | null;
  }[],
): TodoListItem[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      message.role === "assistant" &&
      message.metadata?.todoList &&
      message.metadata.todoList.length > 0
    ) {
      return message.metadata.todoList;
    }
  }
  return [];
}
