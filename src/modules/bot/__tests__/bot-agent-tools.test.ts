import { describe, expect, it, vi } from "vitest";

import {
  createBotCommandAgentTools,
  isBotAgentMode,
} from "@/modules/bot/bot-agent-tools";
import type { CommandStore } from "../../../../packages/cat-bot/src/engine/modules/codeless/command-service";

function memoryStore(): CommandStore & {
  rows: Map<string, { botId: string; name: string; source: { kind: "manual" } | { kind: "imported"; repositoryId: string }; mdText: string; enabled: boolean; updatedAt: string }>;
  getMode: () => Promise<"bot" | "agent">;
} {
  const rows = new Map<string, { botId: string; name: string; source: { kind: "manual" } | { kind: "imported"; repositoryId: string }; mdText: string; enabled: boolean; updatedAt: string }>();
  return {
    rows,
    async listCommands(botId) {
      return [...rows.values()].filter((r) => r.botId === botId);
    },
    async upsertCommand(row) {
      rows.set(`${row.botId}:${row.name}`, { ...row });
    },
    async deleteCommand(botId, name) {
      rows.delete(`${botId}:${String(name).toLowerCase()}`);
    },
    async deleteBySource(botId, source) {
      for (const [key, row] of rows) {
        if (row.botId === botId && row.source.kind === source) rows.delete(key);
      }
    },
    async deleteImportedFromRepo(botId, repositoryId) {
      for (const [key, row] of rows) {
        if (row.botId === botId && row.source.kind === "imported" && row.source.repositoryId === repositoryId) {
          rows.delete(key);
        }
      }
    },
    async setCommandEnabled(botId, name, enabled) {
      const row = rows.get(`${botId}:${String(name).toLowerCase()}`);
      if (row) row.enabled = enabled;
    },
    async getMode() {
      return "agent" as const;
    },
    async listRepositories() {
      return [];
    },
    async upsertRepository() {},
    async deleteRepository() {},
    async clearRepositories() {},
  };
}

describe("bot agent tools adapter", () => {
  it("exposes the four command-authoring tools", () => {
    const { tools } = createBotCommandAgentTools({
      repository: memoryStore() as never,
    });
    expect(Object.keys(tools).sort()).toEqual([
      "admin_add_command",
      "admin_edit_command",
      "admin_generate_command",
      "admin_remove_command",
    ]);
  });

  it("isBotAgentMode fails open to Agent Mode (the default)", async () => {
    expect(await isBotAgentMode({ getMode: async () => "agent" as const })).toBe(true);
    expect(await isBotAgentMode({ getMode: async () => "bot" as const })).toBe(false);
    expect(
      await isBotAgentMode({
        getMode: async () => {
          throw new Error("db down");
        },
      }),
    ).toBe(true);
  });

  it("records tool executions", async () => {
    const store = memoryStore();
    const records: { toolName: string; status: string }[] = [];
    const { tools } = createBotCommandAgentTools({
      repository: store as never,
      onRecord: (record) => {
        records.push({ toolName: record.toolName, status: record.status });
      },
    });
    const add = tools.admin_add_command as unknown as {
      execute: (args: unknown) => Promise<{ ok: boolean; name?: string }>;
    };
    const result = await add.execute({ name: "hello", caption: "Hi!" });
    expect(result.ok).toBe(true);
    expect(records).toEqual([{ toolName: "admin_add_command", status: "completed" }]);
    expect((await store.listCommands("default")).map((r) => r.name)).toEqual(["hello"]);
    void vi;
  });
});
