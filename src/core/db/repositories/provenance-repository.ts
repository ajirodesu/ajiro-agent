import * as Crypto from "expo-crypto";
import { and, desc, eq, isNull, lt } from "drizzle-orm";

import { provenanceEvents } from "@/core/db/schema";
import { nowIso } from "@/core/db/repositories/shared";
import type {
  AppDatabase,
  ProvenanceRepository,
} from "@/core/db/repositories/types";

export function createProvenanceRepository(
  db: AppDatabase,
): ProvenanceRepository {
  return {
    async record(input) {
      const id = input.id ?? Crypto.randomUUID();
      const now = nowIso();
      await db.insert(provenanceEvents).values({
        id,
        action: input.action,
        agentId: input.agentId ?? null,
        tool: input.tool ?? null,
        runtime: input.runtime ?? null,
        permission: input.permission,
        input: input.input ?? null,
        result: input.result ?? null,
        ok: input.ok,
        sessionId: input.sessionId ?? null,
        createdAt: now,
      });
      const row = await this.getById(id);
      if (!row) {
        throw new Error("Failed to record provenance event");
      }
      return row;
    },
    async getById(id) {
      return (
        await db
          .select()
          .from(provenanceEvents)
          .where(eq(provenanceEvents.id, id))
          .limit(1)
      )[0] ?? null;
    },
    async list(input) {
      const conditions = [];
      if (input.sessionId !== undefined) {
        conditions.push(
          input.sessionId === null
            ? isNull(provenanceEvents.sessionId)
            : eq(provenanceEvents.sessionId, input.sessionId),
        );
      }
      if (input.action !== undefined) {
        conditions.push(eq(provenanceEvents.action, input.action));
      }
      const limit = input.limit ?? 100;
      if (conditions.length > 0) {
        return db
          .select()
          .from(provenanceEvents)
          .where(and(...conditions))
          .orderBy(desc(provenanceEvents.createdAt))
          .limit(limit);
      }
      return db
        .select()
        .from(provenanceEvents)
        .orderBy(desc(provenanceEvents.createdAt))
        .limit(limit);
    },
    async prune(beforeIso) {
      await db
        .delete(provenanceEvents)
        .where(lt(provenanceEvents.createdAt, beforeIso));
    },
  };
}
