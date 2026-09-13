import { describe, expect, it } from "vitest";

import {
  createEngineTask,
  isTerminalStatus,
  startBlockers,
  summarizeTaskBoard,
  transitionTask,
} from "@/modules/tasks/engine";

describe("task engine", () => {
  it("creates pending tasks with metadata", () => {
    const task = createEngineTask({
      title: "Write tests",
      description: "Cover the broker",
      owner: "main",
    });
    expect(task.status).toBe("pending");
    expect(task.progress).toBe(0);
    expect(task.owner).toBe("main");
    expect(isTerminalStatus(task.status)).toBe(false);
  });

  it("blocks start until dependencies complete", () => {
    const dep = createEngineTask({ title: "dep" });
    const task = createEngineTask({
      title: "main",
      dependencies: [dep.id],
    });
    expect(startBlockers(task, [dep, task]).length).toBe(1);
    const done = transitionTask(dep, "in_progress");
    const done2 = transitionTask(done, "completed");
    expect(startBlockers(task, [done2, task]).length).toBe(0);
    expect(done2.progress).toBe(100);
    expect(done2.completedAt).not.toBeNull();
  });

  it("validates transitions and rejects illegal jumps", () => {
    const task = createEngineTask({ title: "t" });
    expect(() => transitionTask(task, "completed")).toThrow();
    const running = transitionTask(task, "in_progress");
    expect(running.startedAt).not.toBeNull();
    const blocked = transitionTask(running, "blocked");
    const resumed = transitionTask(blocked, "in_progress");
    const failed = transitionTask(resumed, "failed", { error: "boom" });
    expect(failed.error).toBe("boom");
    expect(() => transitionTask(failed, "completed")).toThrow();
    const retried = transitionTask(failed, "in_progress");
    expect(transitionTask(retried, "cancelled").status).toBe("cancelled");
  });

  it("summarizes the board", () => {
    const a = createEngineTask({ title: "a" });
    const b = createEngineTask({ title: "b", dependencies: [a.id] });
    const summary = summarizeTaskBoard([a, b]);
    expect(summary.total).toBe(2);
    expect(summary.byStatus.pending).toBe(2);
    expect(summary.ready.map((task) => task.title)).toEqual(["a"]);
  });
});
