import { tool } from "ai";
import { z } from "zod";
import { describe, expect, it } from "vitest";

import { wrapToolsWithApproval } from "@/modules/runtime/tool-approval";

function makeTools() {
  return {
    read: tool({
      description: "read",
      inputSchema: z.object({}),
      execute: async () => "content",
    }),
    write: tool({
      description: "write",
      inputSchema: z.object({}),
      execute: async () => "written",
    }),
  };
}

describe("allow-list approval mode", () => {
  const run = (
    wrapped: Record<string, unknown>,
    name: string,
  ): Promise<unknown> =>
    (
      wrapped[name] as unknown as {
        execute: (input: unknown) => Promise<unknown>;
      }
    ).execute({});

  it("auto-runs remembered tools and asks for the rest", async () => {
    const approvals: string[] = [];
    const wrapped = wrapToolsWithApproval(makeTools(), {
      allowListedTools: ["read"],
      mode: "allowList",
      requestApproval: async (request) => {
        approvals.push(request.toolName);
        return "deny";
      },
    });

    await expect(run(wrapped, "read")).resolves.toBe("content");
    expect(approvals).toEqual([]);

    const denied = await run(wrapped, "write");
    expect(denied).toMatchObject({ denied: true });
    expect(approvals).toEqual(["write"]);
  });

  it("remembers session-approved tools via onRememberApproval", async () => {
    const remembered: string[] = [];
    const wrapped = wrapToolsWithApproval(makeTools(), {
      allowListedTools: [],
      mode: "allowList",
      onRememberApproval: (toolName) => {
        remembered.push(toolName);
      },
      requestApproval: async () => "approve_session",
    });

    await run(wrapped, "write");
    expect(remembered).toEqual(["write"]);
  });

  it("behaves like ask mode for unlisted tools", async () => {
    const seen: string[] = [];
    const wrapped = wrapToolsWithApproval(makeTools(), {
      mode: "ask",
      requestApproval: async (request) => {
        seen.push(request.toolName);
        return "approve";
      },
    });

    await run(wrapped, "read");
    expect(seen).toEqual(["read"]);
  });
});
