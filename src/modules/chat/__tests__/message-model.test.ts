import { describe, expect, it } from "vitest";

import {
  providerToRuntime,
  runtimeToUi,
} from "@/modules/chat/message-model";
import {
  createStreamBus,
  normalizeRuntimeEvent,
} from "@/modules/runtime/stream-bus";

describe("message model", () => {
  it("converts provider parts to runtime blocks", () => {
    const runtime = providerToRuntime(
      {
        role: "assistant",
        parts: [
          { type: "text", text: "hello" },
          { type: "thinking", text: "hmm" },
          { type: "tool-call", id: "c1", name: "read", input: {} },
          { type: "tool-result", id: "c1", output: "ok" },
        ],
      },
      { id: "m1", conversationId: "cv", sequence: 1 },
    );
    expect(runtime.blocks.map((block) => block.kind)).toEqual([
      "text",
      "thinking",
      "tool-call",
      "tool-result",
    ]);
    const ui = runtimeToUi(runtime);
    expect(ui.segments.map((segment) => segment.kind)).toEqual([
      "markdown",
      "thinking",
      "tool",
      "tool",
    ]);
    expect(ui.streaming).toBe(false);
  });

  it("detects fenced code blocks as code segments", () => {
    const runtime = providerToRuntime(
      {
        role: "assistant",
        parts: [{ type: "text", text: "```ts\nconst a = 1;\n```" }],
      },
      { id: "m2", conversationId: "cv", sequence: 2 },
    );
    expect(runtime.blocks[0]).toMatchObject({ kind: "code", language: "ts" });
    expect(runtimeToUi(runtime).segments[0]).toMatchObject({ kind: "code" });
  });

  it("maps tool roles onto assistant runtime messages", () => {
    const runtime = providerToRuntime(
      { role: "tool", parts: [{ type: "text", text: "x" }] },
      { id: "m3", conversationId: "cv", sequence: 3 },
    );
    expect(runtime.role).toBe("assistant");
  });
});

describe("stream bus", () => {
  it("normalizes the legacy event vocabulary", () => {
    expect(normalizeRuntimeEvent("text-delta", { text: "hi" })).toEqual([
      { type: "text_delta", text: "hi" },
    ]);
    expect(
      normalizeRuntimeEvent("tool-input-delta", { id: "t1", text: "{" }),
    ).toEqual([{ type: "tool_input_delta", toolCallId: "t1", text: "{" }]);
    expect(
      normalizeRuntimeEvent("finish", {
        finishReason: "stop",
        usage: { inputTokens: 10, outputTokens: 5 },
      }),
    ).toEqual([
      { type: "message_delta", usage: { inputTokens: 10, outputTokens: 5 } },
      { type: "message_stop", reason: "stop" },
    ]);
    expect(normalizeRuntimeEvent("nope", {})).toEqual([]);
  });

  it("collects bus events through the legacy emitter", () => {
    const bus = createStreamBus();
    bus.emitLegacy("text-delta", { text: "a" });
    bus.emitLegacy("abort", {});
    expect(bus.events.map((event) => event.type)).toEqual([
      "text_delta",
      "stream_abort",
    ]);
  });
});
