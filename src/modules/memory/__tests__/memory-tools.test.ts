import { describe, expect, it } from "vitest";

import type { MemoryEntry } from "@/core/types/app-state";
import { buildMemorySystemPrompt } from "../memory-prompt";

function entry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    archivedAt: null,
    content: "# Memory\nLikes tea.",
    createdAt: "2026-01-01T00:00:00Z",
    enabled: true,
    id: "m1",
    sourceConversationId: null,
    sourceMessageId: null,
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("buildMemorySystemPrompt", () => {
  it("injects the document without a profile by default", () => {
    const prompt = buildMemorySystemPrompt(entry(), { canWrite: true });
    expect(prompt).toContain("<memory_document>");
    expect(prompt).toContain("Likes tea.");
    expect(prompt).not.toContain("About the user");
  });

  it("prepends nickname, occupation, and about-me ahead of the document", () => {
    const prompt = buildMemorySystemPrompt(entry(), {
      canWrite: true,
      profile: { aboutMe: "Loves sailing.", nickname: "Ada", occupation: "Engineer" },
    });
    expect(prompt).toContain('nickname is "Ada"');
    expect(prompt).toContain("occupation: Engineer");
    expect(prompt).toContain("More about the user: Loves sailing.");
    const profileAt = prompt.indexOf("About the user");
    const docAt = prompt.indexOf("<memory_document>");
    expect(profileAt).toBeGreaterThanOrEqual(0);
    expect(profileAt).toBeLessThan(docAt);
  });

  it("skips blank profile fields and omits the block when all are empty", () => {
    const blank = buildMemorySystemPrompt(entry(), {
      canWrite: false,
      profile: { aboutMe: "  ", nickname: "", occupation: null },
    });
    expect(blank).not.toContain("About the user");
    const partial = buildMemorySystemPrompt(entry(), {
      canWrite: false,
      profile: { nickname: "Ada" },
    });
    expect(partial).toContain("Ada");
    expect(partial).not.toContain("occupation");
  });

  it("keeps the profile on the empty-document branch", () => {
    const prompt = buildMemorySystemPrompt(null, {
      canWrite: false,
      profile: { nickname: "Ada" },
    });
    expect(prompt).toContain("Ada");
    expect(prompt).toContain("memory.md is empty");
  });

  it("marks profile content as personalization, not instructions", () => {
    const prompt = buildMemorySystemPrompt(entry(), {
      canWrite: true,
      profile: { nickname: "Ada" },
    });
    expect(prompt).toContain("not instructions");
  });
});
