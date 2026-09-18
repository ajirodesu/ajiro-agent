/**
 * Drizzle-backed backup store: adapts the real database to the
 * BackupReader/BackupWriter interfaces the backup engine unit-tests
 * against. Table-name mapping lives in exactly one place (TABLES below),
 * so schema renames surface here first.
 */
import { and, eq, inArray, type AnyColumn } from "drizzle-orm";

import { schema } from "@/core/db/schema";
import type { AppDatabase } from "@/core/db/repositories/types";
import type {
  BackupRow,
  BackupTableName,
  BackupTableStore,
} from "./backup";

type SchemaTable = (typeof schema)[keyof typeof schema];

const TABLES: Record<BackupTableName, SchemaTable> = {
  agentRuns: schema.agentRuns,
  agents: schema.agents,
  appSettings: schema.appSettings,
  botCommandConfigs: schema.botCommandConfigs,
  botCommandRepositories: schema.botCommandRepositories,
  botCommandSecrets: schema.botCommandSecrets,
  botModes: schema.botModes,
  codingCheckpoints: schema.codingCheckpoints,
  conversations: schema.conversations,
  editorFileRevisions: schema.editorFileRevisions,
  mcpServers: schema.mcpServers,
  memories: schema.memories,
  messages: schema.messages,
  modelPresets: schema.modelPresets,
  providerConfigs: schema.providerConfigs,
  savedPrompts: schema.savedPrompts,
  scheduleRuns: schema.scheduleRuns,
  schedules: schema.schedules,
  skillFiles: schema.skillFiles,
  skills: schema.skills,
  workspaceFiles: schema.workspaceFiles,
};

function columnOf(table: SchemaTable, field: string): AnyColumn {
  const column = (table as unknown as Record<string, unknown>)[field];
  if (!column || typeof column !== "object") {
    throw new Error(`Unknown column "${field}" for backup table.`);
  }
  return column as AnyColumn;
}

type Executor = {
  delete(table: SchemaTable): {
    where(condition?: unknown): Promise<unknown>;
  };
  insert(table: SchemaTable): {
    values(rows: BackupRow[] | BackupRow): unknown;
  };
  select(): {
    from(table: SchemaTable): {
      where(condition?: unknown): Promise<BackupRow[]>;
    } & PromiseLike<BackupRow[]>;
  };
};

export function drizzleBackupStore(db: AppDatabase): BackupTableStore {
  let executor: Executor = db as unknown as Executor;

  const conditions = (
    table: SchemaTable,
    match: Record<string, unknown | unknown[]>,
  ) => {
    const parts = Object.entries(match).map(([field, expected]) => {
      const column = columnOf(table, field);
      return Array.isArray(expected)
        ? inArray(column, expected as unknown[])
        : eq(column, expected);
    });
    if (parts.length === 0) {
      throw new Error("Refusing backup delete with an empty match.");
    }
    return parts.length === 1 ? parts[0] : and(...parts);
  };

  const store = {
    async deleteAll(table: BackupTableName): Promise<void> {
      await executor.delete(TABLES[table]);
    },
    async deleteMatching(
      table: BackupTableName,
      match: Record<string, unknown | unknown[]>,
    ): Promise<void> {
      await executor.delete(TABLES[table]).where(conditions(TABLES[table], match));
    },
    async readTable(table: BackupTableName): Promise<BackupRow[]> {
      return executor.select().from(TABLES[table]) as unknown as BackupRow[];
    },
    async readWhere(
      table: BackupTableName,
      field: string,
      values: unknown[],
    ): Promise<BackupRow[]> {
      if (values.length === 0) return [];
      return (await executor
        .select()
        .from(TABLES[table])
        .where(inArray(columnOf(TABLES[table], field), values))) as BackupRow[];
    },
    async replaceTable(table: BackupTableName, rows: BackupRow[]): Promise<void> {
      await executor.delete(TABLES[table]);
      if (rows.length > 0) {
        await executor.insert(TABLES[table]).values(rows);
      }
    },
    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      return db.transaction(async (tx) => {
        const previous = executor;
        executor = tx as unknown as Executor;
        try {
          return await fn();
        } finally {
          executor = previous;
        }
      });
    },
    async upsertRows(
      table: BackupTableName,
      matchFields: string[],
      rows: BackupRow[],
    ): Promise<void> {
      const schemaTable = TABLES[table];
      for (const row of rows) {
        const match: Record<string, unknown> = {};
        for (const field of matchFields) {
          if (row[field] === undefined) {
            throw new Error(`Backup row is missing match field "${field}".`);
          }
          match[field] = row[field];
        }
        await executor.delete(schemaTable).where(conditions(schemaTable, match));
        await executor.insert(schemaTable).values(row);
      }
    },
  };
  return store;
}
