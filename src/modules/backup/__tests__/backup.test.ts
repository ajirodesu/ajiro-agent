import { describe, expect, it } from "vitest";

import {
  applyBackupBundle,
  BACKUP_SCHEMA_VERSION,
  clearChatHistory,
  collectBackup,
  parseBackupBundle,
  scanForCredentials,
  type BackupReader,
  type BackupRow,
  type BackupTableName,
  type BackupWriter,
} from "../backup";

function rows(count: number, extra: Record<string, unknown> = {}): BackupRow[] {
  return Array.from({ length: count }, (_, index) => ({
    createdAt: "2026-01-01T00:00:00Z",
    id: `row-${index}`,
    updatedAt: "2026-01-01T00:00:00Z",
    ...extra,
  }));
}

function fakeReader(overrides: Partial<Record<BackupTableName, BackupRow[]>> = {}): BackupReader {
  return {
    async readMemoryDocument() {
      return { content: "# Memory\n", enabled: true };
    },
    async readSettings(keys: string[]) {
      const all: Record<string, string | null> = {
        memory_enabled: "true",
        theme_mode: "dark",
        user_nickname: "Ada",
      };
      if (keys.length === 0) return { ...all };
      return Object.fromEntries(keys.map((key) => [key, all[key] ?? null]));
    },
    async readTable(table: BackupTableName) {
      return overrides[table] ?? [];
    },
  };
}

function fakeWriter(
  seed: Partial<Record<BackupTableName, BackupRow[]>> = {},
  options: { failOn?: BackupTableName } = {},
): BackupWriter & { tables: Record<string, BackupRow[]> } {
  const tables: Record<string, BackupRow[]> = {};
  for (const [table, list] of Object.entries(seed)) {
    tables[table] = [...(list ?? [])];
  }
  const matchRow = (row: BackupRow, match: Record<string, unknown | unknown[]>) =>
    Object.entries(match).every(([field, expected]) =>
      Array.isArray(expected)
        ? expected.includes(row[field])
        : row[field] === expected,
    );
  return {
    tables,
    async readTable(table: BackupTableName) {
      return [...(tables[table] ?? [])];
    },
    async deleteAll(table: BackupTableName) {
      if (options.failOn === table) throw new Error(`boom:${table}`);
      tables[table] = [];
    },
    async deleteMatching(
      table: BackupTableName,
      match: Record<string, unknown | unknown[]>,
    ) {
      tables[table] = (tables[table] ?? []).filter((row) => !matchRow(row, match));
    },
    async readWhere(table: BackupTableName, field: string, values: unknown[]) {
      return (tables[table] ?? []).filter((row) => values.includes(row[field]));
    },
    async replaceTable(table: BackupTableName, next: BackupRow[]) {
      if (options.failOn === table) throw new Error(`boom:${table}`);
      tables[table] = [...next];
    },
    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      const snapshot = JSON.parse(JSON.stringify(tables)) as typeof tables;
      try {
        return await fn();
      } catch (error) {
        for (const key of Object.keys(tables)) delete tables[key];
        Object.assign(tables, snapshot);
        throw error;
      }
    },
    async upsertRows(table: BackupTableName, matchFields: string[], next: BackupRow[]) {
      if (options.failOn === table) throw new Error(`boom:${table}`);
      const current = tables[table] ?? [];
      for (const row of next) {
        const index = current.findIndex((existing) =>
          matchFields.every((field) => existing[field] === row[field]),
        );
        if (index >= 0) current[index] = row;
        else current.push(row);
      }
      tables[table] = current;
    },
  };
}

describe("backup collect + validate", () => {
  it("collects all files with matching manifest checksums", async () => {
    const collected = await collectBackup({
      appVersion: "1.1.5",
      deviceInfo: "test",
      exportedAt: "2026-01-02T00:00:00Z",
      reader: fakeReader({
        conversations: rows(2),
        memories: rows(1),
        providerConfigs: rows(1),
      }),
    });
    expect(collected.manifest.schemaVersion).toBe(BACKUP_SCHEMA_VERSION);
    expect(collected.manifest.exportedAt).toBe("2026-01-02T00:00:00Z");
    const parsed = parseBackupBundle(
      Object.fromEntries([
        ["manifest.json", JSON.stringify(collected.manifest)],
        ...Object.entries(collected.files).map(([name, file]) => [name, file.json]),
      ]),
    );
    expect(Object.keys(parsed.files)).toContain("conversations.json");
    expect(
      (parsed.files["conversations.json"] as { conversations: BackupRow[] })
        .conversations,
    ).toHaveLength(2);
  });

  it("rejects missing files, bad checksums, and newer schemas", async () => {
    const collected = await collectBackup({
      appVersion: null,
      reader: fakeReader(),
    });
    const files: Record<string, string> = {
      ["manifest.json"]: JSON.stringify(collected.manifest),
      ...Object.fromEntries(
        Object.entries(collected.files).map(([name, file]) => [name, file.json]),
      ),
    };
    const tampered = { ...files, "memory.json": '{"tampered":true}' };
    expect(() => parseBackupBundle(tampered)).toThrow(/memory\.json/);
    const { ["prompts.json"]: _dropped, ...missing } = files;
    expect(() => parseBackupBundle(missing)).toThrow(/prompts\.json/);
    const newer = {
      ...files,
      ["manifest.json"]: JSON.stringify({
        ...collected.manifest,
        schemaVersion: BACKUP_SCHEMA_VERSION + 1,
      }),
    };
    expect(() => parseBackupBundle(newer)).toThrow(/Update the app/);
  });
});

describe("credential regression guard", () => {
  it("flags credential-named values and allows flags and endpoint urls", () => {
    expect(
      scanForCredentials({
        "mcp-servers.json": {
          mcpServers: [
            {
              headerNames: ["Authorization"],
              oauthTokenUrl: "https://idp.example/token",
            },
          ],
        },
        "commands.json": { botCommandSecrets: [{ hasApiKey: true }] },
      }),
    ).toEqual([]);
    expect(
      scanForCredentials({
        "providers.json": { providerConfigs: [{ apiKey: "sk-live-123" }] },
        "settings.json": { settings: { some_token: null, other: true } },
      }),
    ).toEqual([
      { field: "providerConfigs[0].apiKey", file: "providers.json" },
    ]);
  });
});

describe("backup apply", () => {
  async function bundle() {
    const collected = await collectBackup({
      appVersion: null,
      reader: fakeReader({
        conversations: rows(1, { id: "c1" }),
        providerConfigs: rows(1, { id: "p1" }),
      }),
    });
    return parseBackupBundle(
      Object.fromEntries([
        ["manifest.json", JSON.stringify(collected.manifest)],
        ...Object.entries(collected.files).map(([name, file]) => [name, file.json]),
      ]),
    );
  }

  it("merges rows and reports credential counts", async () => {
    const writer = fakeWriter({
      conversations: rows(1, { id: "old" }),
      providerConfigs: rows(2),
    });
    const counts = await applyBackupBundle(writer, await bundle(), "merge");
    expect(writer.tables.conversations).toHaveLength(2);
    expect(writer.tables.providerConfigs).toHaveLength(3);
    expect(counts).toEqual({
      appSettings: expect.any(Number),
      botCommands: 0,
      mcpServers: 0,
      providers: 1,
    });
    expect(writer.tables.appSettings?.length).toBeGreaterThan(0);
  });

  it("replaces tables wholesale in replace mode", async () => {
    const writer = fakeWriter({ conversations: rows(5, { id: "stale" }) });
    await applyBackupBundle(writer, await bundle(), "replace");
    expect(writer.tables.conversations).toHaveLength(1);
    expect(writer.tables.conversations?.[0]?.id).toBe("c1");
  });

  it("rolls back everything when a table fails mid-apply", async () => {
    const writer = fakeWriter(
      { conversations: rows(1, { id: "keep" }) },
      { failOn: "messages" },
    );
    await expect(
      applyBackupBundle(writer, await bundle(), "replace"),
    ).rejects.toThrow();
    expect(writer.tables.conversations).toHaveLength(1);
    expect(writer.tables.conversations?.[0]?.id).toBe("keep");
  });
});

describe("clear chat history", () => {
  it("deletes conversations, messages, runs, and orphaned checkpoints only", async () => {
    const writer = fakeWriter({
      agentRuns: rows(2),
      codingCheckpoints: [
        ...rows(1, { conversationId: "c1", id: "k1" }),
        ...rows(1, { conversationId: "c2", id: "k2" }),
      ],
      conversations: [...rows(1, { id: "c1" }), ...rows(1, { id: "c2" })],
      editorFileRevisions: rows(3),
      memories: rows(2),
      messages: rows(4),
      skills: rows(1),
    });
    const counts = await clearChatHistory(writer, writer);
    expect(counts).toEqual({
      agentRuns: 2,
      checkpoints: 2,
      conversations: 2,
      messages: 4,
    });
    expect(writer.tables.conversations).toEqual([]);
    expect(writer.tables.messages).toEqual([]);
    expect(writer.tables.agentRuns).toEqual([]);
    expect(writer.tables.codingCheckpoints).toEqual([]);
    // Project-scoped history and everything else survives.
    expect(writer.tables.editorFileRevisions).toHaveLength(3);
    expect(writer.tables.memories).toHaveLength(2);
    expect(writer.tables.skills).toHaveLength(1);
  });
});
