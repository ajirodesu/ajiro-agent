import { describe, expect, it } from "vitest";

import type { TodoListItem } from "@/core/types/app-state";
import {
  deriveProcessSteps,
  findLiveTodoList,
  isProcessActiveStatus,
} from "@/modules/chat/process-todos";

function item(
  id: string,
  title: string,
  status: TodoListItem["status"],
): TodoListItem {
  return { id, title, status, createdAt: "2026-01-01T00:00:00Z", completedAt: null };
}

describe("isProcessActiveStatus", () => {
  it("treats live phases as active and terminal ones as not", () => {
    for (const status of [
      "queued",
      "running",
      "waiting_for_approval",
      "waiting_for_question",
      "resumable",
      "retrying",
    ] as const) {
      expect(isProcessActiveStatus(status)).toBe(true);
    }
    for (const status of ["completed", "failed", "canceled", null, undefined] as const) {
      expect(isProcessActiveStatus(status)).toBe(false);
    }
  });
});

describe("deriveProcessSteps", () => {
  it("maps completed to done and highlights exactly the last in_progress", () => {
    const steps = deriveProcessSteps(
      [
        item("1", "Research", "completed"),
        item("2", "Write code", "in_progress"),
        item("3", "Test", "pending"),
      ],
      "running",
    );
    expect(steps.map((step) => step.state)).toEqual([
      "done",
      "active",
      "pending",
    ]);
  });

  it("never highlights twice when the model emits two in_progress", () => {
    const steps = deriveProcessSteps(
      [item("1", "A", "in_progress"), item("2", "B", "in_progress")],
      "running",
    );
    expect(steps.map((step) => step.state)).toEqual(["pending", "active"]);
  });

  it("marks the in-flight step failed (not done, not active) on run failure", () => {
    const steps = deriveProcessSteps(
      [item("1", "Done work", "completed"), item("2", "Blew up", "in_progress")],
      "failed",
    );
    expect(steps.map((step) => step.state)).toEqual(["done", "failed"]);
  });

  it("preserves execution order and ids", () => {
    const steps = deriveProcessSteps(
      [item("a", "First", "completed"), item("b", "Second", "pending")],
      "running",
    );
    expect(steps).toEqual([
      { id: "a", title: "First", state: "done" },
      { id: "b", title: "Second", state: "pending" },
    ]);
  });
});

describe("findLiveTodoList", () => {
  it("returns the newest assistant list and ignores empty/older ones", () => {
    const oldTodos = [item("1", "Old", "completed")];
    const liveTodos = [item("2", "Live", "in_progress")];
    expect(
      findLiveTodoList([
        { role: "assistant", metadata: { todoList: oldTodos } },
        { role: "user" },
        { role: "assistant", metadata: { todoList: [] } },
        { role: "assistant", metadata: { todoList: liveTodos } },
      ]),
    ).toBe(liveTodos);
  });

  it("returns [] when no assistant message carries todos", () => {
    expect(
      findLiveTodoList([
        { role: "user" },
        { role: "assistant", metadata: {} },
      ]),
    ).toEqual([]);
  });
});
