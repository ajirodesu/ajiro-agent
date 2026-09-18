/**
 * Editor revision repository: durable snapshots of a file's Edit History so
 * revision timelines survive app restarts. The in-memory `RevisionLog` in
 * `@/editor/editorRevisions` is the session cache; this is its SQLite mirror
 * (every captured snapshot is appended here, hydration reads the latest N).
 *
 * Author: AjiroDesu
 */
import * as Crypto from "expo-crypto";
import { and, desc, eq } from "drizzle-orm";

import type { AppDatabase } from "@/core/db/repositories/types";
import { editorFileRevisions } from "@/core/db/schema";

export type EditorRevisionRecord = {
  id: string;
  projectUri: string;
  path: string;
  content: string;
  authorName: string | null;
  authorAvatarUri: string | null;
  createdAt: string;
};

export interface EditorRevisionRepository {
  append(input: {
    id?: string;
    createdAt?: string;
    projectUri: string;
    path: string;
    content: string;
    authorName?: string | null;
    authorAvatarUri?: string | null;
  }): Promise<EditorRevisionRecord>;
  /** Latest `limit` snapshots for a file, oldest-first (timeline order). */
  listByFile(
    projectUri: string,
    path: string,
    limit?: number,
  ): Promise<EditorRevisionRecord[]>;
  /** Every revision, oldest-first (backup use). */
  listAll(): Promise<EditorRevisionRecord[]>;
  deleteForFile(projectUri: string, path: string): Promise<void>;
}

export function createEditorRevisionRepository(
  db: AppDatabase,
): EditorRevisionRepository {
  function rowToRecord(row: typeof editorFileRevisions.$inferSelect) {
    return {
      authorAvatarUri: row.authorAvatarUri,
      authorName: row.authorName,
      content: row.content,
      createdAt: row.createdAt,
      id: row.id,
      path: row.path,
      projectUri: row.projectUri,
    } satisfies EditorRevisionRecord;
  }

  return {
    async append(input) {
      const record = {
        id: input.id ?? Crypto.randomUUID(),
        createdAt: input.createdAt ?? new Date().toISOString(),
        projectUri: input.projectUri,
        path: input.path,
        content: input.content,
        authorName: input.authorName ?? null,
        authorAvatarUri: input.authorAvatarUri ?? null,
      };

      await db
        .insert(editorFileRevisions)
        .values(record)
        .onConflictDoNothing();

      return record;
    },
    async listAll() {
      const rows = await db
        .select()
        .from(editorFileRevisions)
        .orderBy(editorFileRevisions.createdAt);
      return rows.map(rowToRecord);
    },
    async listByFile(projectUri, path, limit = 100) {
      const rows = await db
        .select()
        .from(editorFileRevisions)
        .where(
          and(
            eq(editorFileRevisions.projectUri, projectUri),
            eq(editorFileRevisions.path, path),
          ),
        )
        .orderBy(desc(editorFileRevisions.createdAt))
        .limit(limit);

      // Stored newest-first for the bounded "latest N" window; the timeline
      // consumes chronological order, so reverse here.
      return rows.map(rowToRecord).reverse();
    },
    async deleteForFile(projectUri, path) {
      await db
        .delete(editorFileRevisions)
        .where(
          and(
            eq(editorFileRevisions.projectUri, projectUri),
            eq(editorFileRevisions.path, path),
          ),
        );
    },
  };
}