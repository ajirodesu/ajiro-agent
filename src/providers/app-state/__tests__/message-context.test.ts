import { describe, expect, it } from "vitest";

import type { ModelMessage } from "ai";

import { appendContextToLatestUserMessage } from "@/providers/app-state/helpers";

describe("appendContextToLatestUserMessage", () => {
  it("appends to the latest user message and reports success", () => {
    const messages = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ] as ModelMessage[];
    expect(appendContextToLatestUserMessage(messages, "ctx")).toBe(true);
    expect(messages[0]).toMatchObject({
      role: "user",
      content: "hello\n\nctx",
    });
  });

  it("reports false when no user turn exists so callers can fall back", () => {
    const messages = [{ role: "assistant", content: "hi" }] as ModelMessage[];
    expect(appendContextToLatestUserMessage(messages, "ctx")).toBe(false);
    expect(messages).toHaveLength(1);
  });
});
