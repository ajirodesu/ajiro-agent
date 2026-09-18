import { and, eq } from "drizzle-orm";
import * as Crypto from "expo-crypto";

import type { AppDatabase } from "@/core/db/repositories/types";
import {
  botCommandConfigs,
  botCommandRepositories,
  botCommandSecrets,
  botModes,
} from "@/core/db/schema";

export type BotCommandRow = {
  botId: string;
  name: string;
  source: { kind: "manual" } | { kind: "imported"; repositoryId: string };
  mdText: string;
  enabled: boolean;
  updatedAt: string;
};

export type BotRepositoryRow = {
  id: string;
  botId: string;
  url: string;
  lastSyncedAt: string;
};

function toRow(row: typeof botCommandConfigs.$inferSelect): BotCommandRow {
  const source = String(row.source);
  return {
    botId: row.botId,
    name: row.name,
    source: source.startsWith("imported:")
      ? {
          kind: "imported",
          repositoryId: row.repositoryId ?? source.slice("imported:".length),
        }
      : { kind: "manual" },
    mdText: row.mdText,
    enabled: row.enabled,
    updatedAt: row.updatedAt,
  };
}

export interface BotCommandRepository {
  /** Raw rows for backup (schema shape, all bots). */
  listAllConfigs(): Promise<(typeof botCommandConfigs.$inferSelect)[]>;
  listAllRepositories(): Promise<(typeof botCommandRepositories.$inferSelect)[]>;
  listAllModes(): Promise<(typeof botModes.$inferSelect)[]>;
  listAllSecrets(): Promise<(typeof botCommandSecrets.$inferSelect)[]>;
  listCommands(botId: string): Promise<BotCommandRow[]>;
  upsertCommand(row: BotCommandRow): Promise<void>;
  deleteCommand(botId: string, name: string): Promise<void>;
  deleteBySource(botId: string, source: "manual" | "imported"): Promise<void>;
  deleteImportedFromRepo(botId: string, repositoryId: string): Promise<void>;
  setCommandEnabled(botId: string, name: string, enabled: boolean): Promise<void>;
  listRepositories(botId: string): Promise<BotRepositoryRow[]>;
  upsertRepository(row: BotRepositoryRow): Promise<void>;
  deleteRepository(botId: string, repositoryId: string): Promise<void>;
  clearRepositories(botId: string): Promise<void>;
  getMode(botId: string): Promise<"bot" | "agent">;
  setMode(botId: string, mode: "bot" | "agent"): Promise<void>;
  setHasApiKey(botId: string, commandName: string, has: boolean): Promise<void>;
  getHasApiKey(botId: string, commandName: string): Promise<boolean>;
}

export function createBotCommandRepository(db: AppDatabase): BotCommandRepository {
  return {
    async listAllConfigs() {
      return db.select().from(botCommandConfigs);
    },
    async listAllRepositories() {
      return db.select().from(botCommandRepositories);
    },
    async listAllModes() {
      return db.select().from(botModes);
    },
    async listAllSecrets() {
      return db.select().from(botCommandSecrets);
    },
    async listCommands(botId) {
      const rows = await db
        .select()
        .from(botCommandConfigs)
        .where(eq(botCommandConfigs.botId, botId));
      return rows.map(toRow);
    },
    async upsertCommand(row) {
      const now = new Date().toISOString();
      const source =
        row.source.kind === "manual" ? "manual" : `imported:${row.source.repositoryId}`;
      const existing = await db
        .select({ id: botCommandConfigs.id })
        .from(botCommandConfigs)
        .where(
          and(
            eq(botCommandConfigs.botId, row.botId),
            eq(botCommandConfigs.name, row.name),
          ),
        );
      if (existing.length > 0) {
        await db
          .update(botCommandConfigs)
          .set({
            source,
            repositoryId:
              row.source.kind === "imported" ? row.source.repositoryId : null,
            mdText: row.mdText,
            enabled: row.enabled,
            updatedAt: now,
          })
          .where(
            and(
              eq(botCommandConfigs.botId, row.botId),
              eq(botCommandConfigs.name, row.name),
            ),
          );
        return;
      }
      await db.insert(botCommandConfigs).values({
        id: Crypto.randomUUID(),
        botId: row.botId,
        name: row.name,
        source,
        repositoryId:
          row.source.kind === "imported" ? row.source.repositoryId : null,
        mdText: row.mdText,
        enabled: row.enabled,
        createdAt: now,
        updatedAt: now,
      });
    },
    async deleteCommand(botId, name) {
      await db
        .delete(botCommandConfigs)
        .where(
          and(
            eq(botCommandConfigs.botId, botId),
            eq(botCommandConfigs.name, String(name).toLowerCase()),
          ),
        );
    },
    async deleteBySource(botId, source) {
      const rows = await db
        .select()
        .from(botCommandConfigs)
        .where(eq(botCommandConfigs.botId, botId));
      for (const row of rows) {
        const isImported = String(row.source).startsWith("imported:");
        if ((source === "imported") === isImported) {
          await db
            .delete(botCommandConfigs)
            .where(eq(botCommandConfigs.id, row.id));
        }
      }
    },
    async deleteImportedFromRepo(botId, repositoryId) {
      const rows = await db
        .select()
        .from(botCommandConfigs)
        .where(eq(botCommandConfigs.botId, botId));
      for (const row of rows) {
        if (
          String(row.source) === `imported:${repositoryId}` ||
          row.repositoryId === repositoryId
        ) {
          await db
            .delete(botCommandConfigs)
            .where(eq(botCommandConfigs.id, row.id));
        }
      }
    },
    async setCommandEnabled(botId, name, enabled) {
      await db
        .update(botCommandConfigs)
        .set({ enabled, updatedAt: new Date().toISOString() })
        .where(
          and(
            eq(botCommandConfigs.botId, botId),
            eq(botCommandConfigs.name, String(name).toLowerCase()),
          ),
        );
    },
    async listRepositories(botId) {
      const rows = await db
        .select()
        .from(botCommandRepositories)
        .where(eq(botCommandRepositories.botId, botId));
      return rows.map((r) => ({
        id: r.id,
        botId: r.botId,
        url: r.url,
        lastSyncedAt: r.lastSyncedAt ?? r.updatedAt,
      }));
    },
    async upsertRepository(row) {
      const now = new Date().toISOString();
      const existing = await db
        .select({ id: botCommandRepositories.id })
        .from(botCommandRepositories)
        .where(eq(botCommandRepositories.id, row.id));
      if (existing.length > 0) {
        await db
          .update(botCommandRepositories)
          .set({ url: row.url, lastSyncedAt: row.lastSyncedAt, updatedAt: now })
          .where(eq(botCommandRepositories.id, row.id));
        return;
      }
      await db.insert(botCommandRepositories).values({
        id: row.id,
        botId: row.botId,
        url: row.url,
        lastSyncedAt: row.lastSyncedAt,
        createdAt: now,
        updatedAt: now,
      });
    },
    async deleteRepository(botId, repositoryId) {
      await db
        .delete(botCommandRepositories)
        .where(
          and(
            eq(botCommandRepositories.id, repositoryId),
            eq(botCommandRepositories.botId, botId),
          ),
        );
    },
    async clearRepositories(botId) {
      await db
        .delete(botCommandRepositories)
        .where(eq(botCommandRepositories.botId, botId));
    },
    async getMode(botId) {
      const rows = await db
        .select()
        .from(botModes)
        .where(eq(botModes.botId, botId));
      const mode = rows[0]?.mode;
      return mode === "bot" ? "bot" : "agent";
    },
    async setMode(botId, mode) {
      const now = new Date().toISOString();
      const existing = await db
        .select({ botId: botModes.botId })
        .from(botModes)
        .where(eq(botModes.botId, botId));
      if (existing.length > 0) {
        await db
          .update(botModes)
          .set({ mode, updatedAt: now })
          .where(eq(botModes.botId, botId));
        return;
      }
      await db.insert(botModes).values({ botId, mode, updatedAt: now });
    },
    async setHasApiKey(botId, commandName, has) {
      const now = new Date().toISOString();
      const existing = await db
        .select()
        .from(botCommandSecrets)
        .where(
          and(
            eq(botCommandSecrets.botId, botId),
            eq(botCommandSecrets.commandName, String(commandName).toLowerCase()),
          ),
        );
      if (existing.length > 0) {
        await db
          .update(botCommandSecrets)
          .set({ hasApiKey: has, updatedAt: now })
          .where(
            and(
              eq(botCommandSecrets.botId, botId),
              eq(botCommandSecrets.commandName, String(commandName).toLowerCase()),
            ),
          );
        return;
      }
      await db.insert(botCommandSecrets).values({
        botId,
        commandName: String(commandName).toLowerCase(),
        hasApiKey: has,
        updatedAt: now,
      });
    },
    async getHasApiKey(botId, commandName) {
      const rows = await db
        .select()
        .from(botCommandSecrets)
        .where(
          and(
            eq(botCommandSecrets.botId, botId),
            eq(botCommandSecrets.commandName, String(commandName).toLowerCase()),
          ),
        );
      return rows[0]?.hasApiKey ?? false;
    },
  };
}
