/**
 * Resilient streaming bus (§12): every provider event is normalized into one
 * internal vocabulary before reaching state/UI. Mirrors the documented
 * message/content-block lifecycle (start, delta, stop) plus Ajiro runtime
 * concerns (thinking, tool input streaming, steps, errors, cancellation).
 *
 * Source provenance: [AJIRO ORIGINAL] bus; event lifecycle follows publicly
 * documented provider streaming behavior; names stay compatible with the
 * events ai-sdk-runtime already emits so the runtime can adopt this bus
 * without changing producers.
 */
export type StreamEvent =
  | { type: "message_start"; messageId: string }
  | { type: "content_block_start"; index: number; kind: string }
  | { type: "text_delta"; text: string }
  | { type: "reasoning_delta"; text: string }
  | { type: "tool_input_delta"; toolCallId: string; text: string }
  | { type: "content_block_stop"; index: number }
  | { type: "tool_call_start"; toolCallId: string; toolName: string }
  | { type: "tool_call_end"; toolCallId: string }
  | { type: "step_start"; stepIndex: number }
  | { type: "step_end"; stepIndex: number }
  | { type: "message_delta"; usage?: { inputTokens?: number; outputTokens?: number } }
  | { type: "message_stop"; reason: string }
  | { type: "stream_error"; message: string }
  | { type: "stream_abort" };

export type StreamSink = (event: StreamEvent) => void;

/**
 * Normalize a legacy ai-sdk-runtime onEvent call into bus events.
 * Unknown names pass through as stream_error-free no-ops (dropped, counted).
 */
export function normalizeRuntimeEvent(
  name: string,
  payload: unknown,
): StreamEvent[] {
  const textOf = (value: unknown): string =>
    typeof value === "string"
      ? value
      : typeof (value as { text?: unknown })?.text === "string"
        ? String((value as { text?: unknown }).text)
        : "";
  const record =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};
  switch (name) {
    case "text-start":
      return [{ type: "message_start", messageId: String(record.id ?? "") }];
    case "text-delta":
      return [{ type: "text_delta", text: textOf(payload) }];
    case "text-end":
      return [{ type: "message_stop", reason: "text-end" }];
    case "reasoning-start":
      return [
        {
          type: "content_block_start",
          index: 0,
          kind: "reasoning",
        },
      ];
    case "reasoning-delta":
      return [{ type: "reasoning_delta", text: textOf(payload) }];
    case "reasoning-end":
      return [{ type: "content_block_stop", index: 0 }];
    case "tool-input-start":
      return [
        {
          type: "tool_call_start",
          toolCallId: String(record.id ?? record.toolCallId ?? ""),
          toolName: String(record.toolName ?? record.name ?? ""),
        },
      ];
    case "tool-input-delta":
      return [
        {
          type: "tool_input_delta",
          toolCallId: String(record.id ?? record.toolCallId ?? ""),
          text: textOf(payload),
        },
      ];
    case "tool-input-end":
      return [
        {
          type: "tool_call_end",
          toolCallId: String(record.id ?? record.toolCallId ?? ""),
        },
      ];
    case "tool-execution-start":
      return [
        {
          type: "tool_call_start",
          toolCallId: String(record.id ?? ""),
          toolName: String(record.toolName ?? ""),
        },
      ];
    case "tool-execution-end":
      return [
        {
          type: "tool_call_end",
          toolCallId: String(record.id ?? ""),
        },
      ];
    case "step-start":
      return [
        {
          type: "step_start",
          stepIndex: Number(record.stepIndex ?? record.index ?? 0),
        },
      ];
    case "step-end":
      return [
        {
          type: "step_end",
          stepIndex: Number(record.stepIndex ?? record.index ?? 0),
        },
      ];
    case "finish":
      return [
        {
          type: "message_delta",
          usage:
            record.usage && typeof record.usage === "object"
              ? {
                  inputTokens:
                    typeof (record.usage as Record<string, unknown>).inputTokens ===
                    "number"
                      ? Number(
                          (record.usage as Record<string, unknown>).inputTokens,
                        )
                      : undefined,
                  outputTokens:
                    typeof (record.usage as Record<string, unknown>)
                      .outputTokens === "number"
                      ? Number(
                          (record.usage as Record<string, unknown>)
                            .outputTokens,
                        )
                      : undefined,
                }
              : undefined,
        },
        { type: "message_stop", reason: String(record.finishReason ?? "stop") },
      ];
    case "error":
      return [
        {
          type: "stream_error",
          message:
            payload instanceof Error ? payload.message : textOf(payload) || "stream error",
        },
      ];
    case "abort":
      return [{ type: "stream_abort" }];
    default:
      return [];
  }
}

export type StreamBus = {
  emitLegacy: (name: string, payload: unknown) => StreamEvent[];
  events: StreamEvent[];
};

export function createStreamBus(sink?: StreamSink): StreamBus {
  const events: StreamEvent[] = [];
  return {
    events,
    emitLegacy(name, payload) {
      const normalized = normalizeRuntimeEvent(name, payload);
      for (const event of normalized) {
        events.push(event);
        sink?.(event);
      }
      return normalized;
    },
  };
}
