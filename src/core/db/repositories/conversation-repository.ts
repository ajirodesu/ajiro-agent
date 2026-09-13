import { desc, eq, isNull, like } from "drizzle-orm";
import * as Crypto from "expo-crypto";

import { nowIso } from "@/core/db/repositories/shared";
import type {
  AppDatabase,
  ConversationRepository,
} from "@/core/db/repositories/types";
import { conversations, messages } from "@/core/db/schema";

export function createConversationRepository(
  db: AppDatabase,
): ConversationRepository {
  return {
    async create(input) {
      const id = input.id ?? Crypto.randomUUID();
      const timestamp = nowIso();

      await db.insert(conversations).values({
        id,
        title: input.title,
        providerId: input.providerId ?? null,
        modelId: input.modelId ?? null,
        pinnedAt: input.pinnedAt ?? null,
        reasoningEffort: "medium",
        agentMode: "build",
        agentId: input.agentId ?? null,
        selectedFileIds: [],
        selectedSkillIds: [],
        skillMode: "auto",
        webSearchMode: "smart",
        externalFolderSession: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        archivedAt: null,
      });

      const row = (
        await db
          .select()
          .from(conversations)
          .where(eq(conversations.id, id))
          .limit(1)
      )[0];

      if (!row) {
        throw new Error("Failed to create conversation");
      }

      return row;
    },
    async getById(id) {
      return (
        (
          await db
            .select()
            .from(conversations)
            .where(eq(conversations.id, id))
            .limit(1)
        )[0] ?? null
      );
    },
    async deleteById(id) {
      await db.delete(conversations).where(eq(conversations.id, id));
    },
    async list() {
      return db
        .select()
        .from(conversations)
        .where(isNull(conversations.archivedAt))
        .orderBy(desc(conversations.pinnedAt), desc(conversations.updatedAt));
    },
    async search(query) {
      const needle = `%${query.trim().replace(/[%_]/g, "")}%`;
      if (!query.trim()) return this.list();
      return db
        .select()
        .from(conversations)
        .where(like(conversations.title, needle))
        .orderBy(desc(conversations.updatedAt));
    },
    async setArchived(id, archivedAt) {
      await db
        .update(conversations)
        .set({ archivedAt, updatedAt: nowIso() })
        .where(eq(conversations.id, id));
    },
    /**
     * Fork/branch a conversation (§§66-68): duplicate the row plus its
     * messages (optionally only up to a sequence for branch-from-message).
     * In-flight streaming messages settle as failed on the copy.
     */
    async fork(id, options) {
      const source = await this.getById(id);
      if (!source) {
        throw new Error(`Conversation not found: ${id}.`);
      }
      const timestamp = nowIso();
      const forkId = Crypto.randomUUID();
      await db.insert(conversations).values({
        id: forkId,
        title: options?.title?.trim() || `${source.title} (branch)`,
        providerId: source.providerId,
        modelId: source.modelId,
        pinnedAt: null,
        reasoningEffort: source.reasoningEffort,
        agentMode: source.agentMode,
        agentId: source.agentId,
        selectedFileIds: source.selectedFileIds,
        selectedMcpServerIds: source.selectedMcpServerIds,
        selectedSkillIds: source.selectedSkillIds,
        skillMode: source.skillMode,
        webSearchMode: source.webSearchMode,
        externalFolderSession: source.externalFolderSession,
        createdAt: timestamp,
        updatedAt: timestamp,
        archivedAt: null,
      });
      const sourceMessages = await db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, id))
        .orderBy(messages.sequence);
      let sequence = 1;
      for (const message of sourceMessages) {
        if (
          options?.upToSequence !== undefined &&
          message.sequence > options.upToSequence
        ) {
          break;
        }
        await db.insert(messages).values({
          id: Crypto.randomUUID(),
          conversationId: forkId,
          content: message.content,
          error: message.error,
          metadata: message.metadata,
          role: message.role,
          sequence,
          status: message.status === "streaming" ? "failed" : message.status,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        sequence += 1;
      }
      const row = await this.getById(forkId);
      if (!row) {
        throw new Error("Failed to fork conversation");
      }
      return row;
    },
    async updateMetadata(id, input) {
      const current = (
        await db
          .select()
          .from(conversations)
          .where(eq(conversations.id, id))
          .limit(1)
      )[0];

      if (!current) {
        return;
      }

      await db
        .update(conversations)
        .set({
          title: input.title ?? current.title,
          providerId: input.providerId ?? current.providerId,
          modelId: input.modelId ?? current.modelId,
          pinnedAt:
            input.pinnedAt !== undefined ? input.pinnedAt : current.pinnedAt,
          reasoningEffort: input.reasoningEffort ?? current.reasoningEffort,
          agentMode: input.agentMode ?? current.agentMode,
          agentId: input.agentId !== undefined ? input.agentId : current.agentId,
          selectedFileIds: input.selectedFileIds ?? current.selectedFileIds,
          selectedMcpServerIds:
            input.selectedMcpServerIds !== undefined
              ? input.selectedMcpServerIds
              : current.selectedMcpServerIds,
          selectedSkillIds: input.selectedSkillIds ?? current.selectedSkillIds,
          skillMode: input.skillMode ?? current.skillMode,
          webSearchMode: input.webSearchMode ?? current.webSearchMode,
          externalFolderSession:
            input.externalFolderSession !== undefined
              ? input.externalFolderSession
              : current.externalFolderSession,
          updatedAt: input.updatedAt ?? nowIso(),
        })
        .where(eq(conversations.id, id));
    },
  };
}
