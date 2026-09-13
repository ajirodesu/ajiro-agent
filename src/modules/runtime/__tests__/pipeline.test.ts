import { describe, expect, it } from "vitest";

import {
  createPipelineTracer,
  isValidTransition,
} from "@/modules/runtime/pipeline";

describe("request pipeline", () => {
  it("starts at input validation", () => {
    expect(isValidTransition(null, "input_validated")).toBe(true);
    expect(isValidTransition(null, "model_requested")).toBe(false);
  });

  it("allows the agent loop (tool -> model -> tool)", () => {
    expect(isValidTransition("streaming", "tool_requested")).toBe(true);
    expect(isValidTransition("tool_requested", "permission_evaluated")).toBe(
      true,
    );
    expect(isValidTransition("permission_evaluated", "executed")).toBe(true);
    expect(isValidTransition("executed", "tool_result")).toBe(true);
    expect(isValidTransition("tool_result", "context_updated")).toBe(true);
    expect(isValidTransition("context_updated", "model_requested")).toBe(true);
    expect(isValidTransition("context_updated", "tool_requested")).toBe(true);
  });

  it("rejects backward jumps outside the loop", () => {
    expect(isValidTransition("completed", "model_requested")).toBe(false);
    expect(isValidTransition("tool_result", "model_requested")).toBe(false);
  });

  it("accepts terminal stages from anywhere", () => {
    expect(isValidTransition("streaming", "failed")).toBe(true);
    expect(isValidTransition("input_validated", "cancelled")).toBe(true);
  });

  it("traces a legal run and drops illegal stages", () => {
    const seen: string[] = [];
    const tracer = createPipelineTracer((event) => {
      seen.push(event.stage);
    });
    expect(tracer.trace("input_validated")).toBe(true);
    expect(tracer.trace("completed")).toBe(true);
    expect(tracer.trace("model_requested")).toBe(false);
    expect(tracer.current()).toBe("completed");
    expect(seen).toEqual(["input_validated", "completed"]);
  });
});
