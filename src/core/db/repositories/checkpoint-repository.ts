/**
 * Checkpoint repository: stores pre-edit snapshots of project files so an
 * agent-made change set can be reverted (undo) from the UI.
 *
 * Author: AjiroDesu
 */
import * as Crypto from "expo-crypto";
import { and, desc, eq } from "drizzle-orm";

import type { AppDatabase } from "@/core/db/repositories/types";
import { codingCheckpoints } from "@/core/db/schema";

export type CheckpointSnapshotEntry = {
  path: string;
  previousContent: string | null;
};

export type CodingCheckpoint = {
  id: string;
  conversationId: string;
  runId: string | null;
  projectUri: string;
  label: string;
  snapshot: CheckpointSnapshotEntry[];
  createdAt: string;
};

export interface CheckpointRepository {
  create(input: {
    conversationId: string;
    id?: string;
    label: string;
    projectUri: string;
    runId?: string | null;
    snapshot: CheckpointSnapshotEntry[];
  }): Promise<CodingCheckpoint>;
  getLatestForConversation(
    conversationId: string,
    projectUri: string,
  ): Promise<CodingCheckpoint | null>;
  listByConversation(
    conversationId: string,
    projectUri: string,
    limit?: number,
  ): Promise<CodingCheckpoint[]>;
  /** Every checkpoint, oldest-first (backup use). */
  listAll(): Promise<CodingCheckpoint[]>;
  deleteForConversation(conversationId: string, projectUri: string): Promise<void>;
}

export function createCheckpointRepository(
  db: AppDatabase,
): CheckpointRepository {
  function rowToCheckpoint(row: typeof codingCheckpoints.$inferSelect) {
    return {
      conversationId: row.conversationId,
      createdAt: row.createdAt,
      id: row.id,
      label: row.label,
      projectUri: row.projectUri,
      runId: row.runId,
      snapshot: row.snapshot,
    } satisfies CodingCheckpoint;
  }

  return {
    async create(input) {
      const now = new Date().toISOString();
      const record = {
        conversationId: input.conversationId,
        createdAt: now,
        id: input.id ?? Crypto.randomUUID(),
        label: input.label,
        projectUri: input.projectUri,
        runId: input.runId ?? null,
        snapshot: input.snapshot,
      };

      await db.insert(codingCheckpoints).values(record);

      return record;
    },
    async getLatestForConversation(conversationId, projectUri) {
      const rows = await db
        .select()
        .from(codingCheckpoints)
        .where(
          and(
            eq(codingCheckpoints.conversationId, conversationId),
            eq(codingCheckpoints.projectUri, projectUri),
          ),
        )
        .orderBy(desc(codingCheckpoints.createdAt))
        .limit(1);

      return rows[0] ? rowToCheckpoint(rows[0]) : null;
    },
    async listAll() {
      const rows = await db
        .select()
        .from(codingCheckpoints)
        .orderBy(codingCheckpoints.createdAt);
      return rows.map(rowToCheckpoint);
    },
    async listByConversation(conversationId, projectUri, limit = 20) {
      const rows = await db
        .select()
        .from(codingCheckpoints)
        .where(
          and(
            eq(codingCheckpoints.conversationId, conversationId),
            eq(codingCheckpoints.projectUri, projectUri),
          ),
        )
        .orderBy(desc(codingCheckpoints.createdAt))
        .limit(limit);

      return rows.map(rowToCheckpoint);
    },
    async deleteForConversation(conversationId, projectUri) {
      await db
        .delete(codingCheckpoints)
        .where(
          and(
            eq(codingCheckpoints.conversationId, conversationId),
            eq(codingCheckpoints.projectUri, projectUri),
          ),
        );
    },
  };
}
