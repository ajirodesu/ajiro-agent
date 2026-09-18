import { tool, type ToolSet } from "ai";
import * as Crypto from "expo-crypto";
import { z } from "zod";

import type { MemoryStore } from "@/modules/memory/types";
import type { MemoryEntry, MemoryEvent } from "@/core/types/app-state";
import {
  buildMemorySystemPrompt as buildPrompt,
  type MemoryUserProfile,
} from "@/modules/memory/memory-prompt";

export type { MemoryUserProfile } from "@/modules/memory/memory-prompt";

const MAX_MEMORY_DOCUMENT_LENGTH = 20_000;

/** Pure prompt rendering lives in memory-prompt.ts (unit-tested). */
export function buildMemorySystemPrompt(
    memory: MemoryEntry | null,
    input: { canWrite: boolean; profile?: MemoryUserProfile },
): string {
    return buildPrompt(memory, input);
}

export function createMemoryTools(input: {
    conversationId: string;
    memoryStore: MemoryStore;
    onEvent?: (event: MemoryEvent) => void;
    sourceMessageId: string;
}) {
    const createEvent = (
        event: Omit<MemoryEvent, "createdAt" | "id">,
    ): MemoryEvent => ({
        ...event,
        id: Crypto.randomUUID(),
        createdAt: new Date().toISOString(),
    });

    const tools = {
        writeMemory: tool({
            description:
                "Replace memory.md with the complete revised Markdown memory document. Preserve existing durable information unless it is outdated or the user asks to forget it. Never store transcripts, assistant output, temporary tasks, tool results, secrets, or inferred information.",
            inputSchema: z.object({
                content: z.string().trim().min(1).max(MAX_MEMORY_DOCUMENT_LENGTH),
                reason: z.string().optional(),
            }),
            execute: async ({ content, reason }) => {
                const current = await input.memoryStore.read();
                const memory = await input.memoryStore.write(content);

                input.onEvent?.(
                    createEvent({
                        kind: current ? "updated" : "created",
                        memoryId: memory.id,
                        content: memory.content,
                        previousContent: current?.content ?? null,
                        reason: reason?.trim() || null,
                    }),
                );

                return {
                    memoryId: memory.id,
                    status: current ? "updated" : "saved",
                };
            },
        }),
        forgetMemory: tool({
            description:
                "Delete the entire memory.md document only when the user explicitly asks to forget all saved memory. To forget one fact, use writeMemory with the complete revised document instead.",
            inputSchema: z.object({
                reason: z.string().optional(),
            }),
            execute: async ({ reason }) => {
                const current = await input.memoryStore.read();

                if (!current) {
                    return {
                        memoryId: "memory.md",
                        status: "not_found",
                    };
                }

                await input.memoryStore.clear();

                input.onEvent?.(
                    createEvent({
                        kind: "deleted",
                        memoryId: current.id,
                        content: current.content,
                        previousContent: current.content,
                        reason: reason?.trim() || null,
                    }),
                );

                return {
                    memoryId: current.id,
                    status: "removed",
                };
            },
        }),
    } satisfies ToolSet;

    return { tools };
}
