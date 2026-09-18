import * as Crypto from "expo-crypto";
import { desc, eq } from "drizzle-orm";

import { memories } from "@/core/db/schema";
import { nowIso } from "@/core/db/repositories/shared";
import type {
  AppDatabase,
  MemoryEntryRepository,
} from "@/core/db/repositories/types";

export function createMemoryEntryRepository(
  db: AppDatabase,
): MemoryEntryRepository {
  return {
    async create(input) {
      const timestamp = nowIso();
      const id = input.id ?? Crypto.randomUUID();
      await db.insert(memories).values({
        archivedAt: null,
        content: input.content,
        createdAt: timestamp,
        enabled: input.enabled ?? true,
        id,
        sourceConversationId: input.sourceConversationId ?? null,
        sourceMessageId: input.sourceMessageId ?? null,
        updatedAt: timestamp,
      });
      const row = await this.getById(id);
      if (!row) throw new Error("Failed to create memory entry");
      return row;
    },
    async delete(id) {
      await db.delete(memories).where(eq(memories.id, id));
    },
    async deleteAll() {
      await db.delete(memories);
    },
    async getById(id) {
      return (
        (await db.select().from(memories).where(eq(memories.id, id)).limit(1))[0] ??
        null
      );
    },
    async list() {
      return db.select().from(memories).orderBy(desc(memories.updatedAt));
    },
    async setEnabled(id, enabled) {
      await db
        .update(memories)
        .set({ enabled, updatedAt: nowIso() })
        .where(eq(memories.id, id));
    },
  };
}
