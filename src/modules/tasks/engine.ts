/**
 * Canonical task engine (§18): tasks with dependencies, ownership, progress,
 * and validated lifecycles. The lightweight todos checklist stays as-is for
 * simple lists; this engine drives agent-owned multi-step work.
 *
 * Source provenance: [OPENCODE] task workflows as publicly observable
 * behavior; [AJIRO ORIGINAL] states, transition rules, and bookkeeping.
 */
export type TaskStatus =
  | "pending"
  | "in_progress"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled";

export type EngineTask = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  dependencies: string[];
  owner: string;
  progress: number;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  result: string | null;
  error: string | null;
};

const TERMINAL: TaskStatus[] = ["completed", "failed", "cancelled"];

const ALLOWED: Record<TaskStatus, TaskStatus[]> = {
  pending: ["in_progress", "cancelled"],
  in_progress: ["blocked", "completed", "failed", "cancelled"],
  blocked: ["in_progress", "cancelled"],
  failed: ["in_progress", "cancelled"],
  completed: [],
  cancelled: [],
};

let nextTaskSeq = 1;

export function createEngineTask(input: {
  title: string;
  description?: string;
  dependencies?: string[];
  owner?: string;
}): EngineTask {
  const now = new Date().toISOString();
  return {
    id: `task-${Date.now().toString(36)}-${nextTaskSeq++}`,
    title: input.title.trim(),
    description: input.description?.trim() || null,
    status: "pending",
    dependencies: [...(input.dependencies ?? [])],
    owner: input.owner ?? "main",
    progress: 0,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    completedAt: null,
    result: null,
    error: null,
  };
}

export function isTerminalStatus(status: TaskStatus): boolean {
  return TERMINAL.includes(status);
}

/** A task may start only when every dependency completed. */
export function startBlockers(
  task: EngineTask,
  all: EngineTask[],
): EngineTask[] {
  const byId = new Map(all.map((entry) => [entry.id, entry]));
  return task.dependencies
    .map((id) => byId.get(id))
    .filter(
      (dep): dep is EngineTask => !!dep && dep.status !== "completed",
    );
}

/** Apply a status transition (validated). Throws on illegal transitions. */
export function transitionTask(
  task: EngineTask,
  next: TaskStatus,
  detail?: { error?: string; progress?: number; result?: string },
): EngineTask {
  if (!ALLOWED[task.status].includes(next)) {
    throw new Error(
      `Illegal task transition: ${task.status} -> ${next} (${task.id}).`,
    );
  }
  const now = new Date().toISOString();
  return {
    ...task,
    status: next,
    progress:
      next === "completed"
        ? 100
        : (detail?.progress ?? task.progress),
    startedAt: task.startedAt ?? (next === "in_progress" ? now : null),
    completedAt: isTerminalStatus(next) ? now : null,
    result: detail?.result ?? task.result,
    error: next === "failed" ? (detail?.error ?? task.error) : task.error,
    updatedAt: now,
  };
}

export type TaskBoardSummary = {
  total: number;
  byStatus: Record<TaskStatus, number>;
  blocked: EngineTask[];
  ready: EngineTask[];
};

export function summarizeTaskBoard(tasks: EngineTask[]): TaskBoardSummary {
  const byStatus: Record<TaskStatus, number> = {
    pending: 0,
    in_progress: 0,
    blocked: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
  };
  for (const task of tasks) byStatus[task.status] += 1;
  return {
    total: tasks.length,
    byStatus,
    blocked: tasks.filter((task) => task.status === "blocked"),
    ready: tasks.filter(
      (task) => task.status === "pending" && startBlockers(task, tasks).length === 0,
    ),
  };
}
