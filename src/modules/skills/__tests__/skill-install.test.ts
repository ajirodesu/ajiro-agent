import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchSkillFiles } from "@/modules/skills/skill-files";
import { fetchSkillMarkdownFromUrl } from "@/modules/skills/skill-github";
import {
  findInstalledBySlug,
  installSkillFromEntry,
  isSkillUpdateAvailable,
  uninstallSkill,
} from "@/modules/skills/skill-install";
import { createMemorySkillRepository } from "@/modules/skills/__tests__/skill-store.test";

vi.mock("@/modules/skills/skill-github", () => ({
  fetchSkillMarkdownFromUrl: vi.fn(),
}));

vi.mock("@/modules/skills/skill-files", () => ({
  fetchSkillFiles: vi.fn(),
}));

const MARKDOWN_V1 = `---
name: pdf
description: Work with PDF files.
---
# Pdf
Read them.`;

const MARKDOWN_V2 = `---
name: pdf
description: Work with PDF files well.
---
# Pdf
Read them carefully.`;

const MARKDOWN_BAD = `No frontmatter at all.`;

function mockFetch(content: string) {
  vi.mocked(fetchSkillMarkdownFromUrl).mockResolvedValue({
    content,
    displayName: "SKILL.md",
  });
  vi.mocked(fetchSkillFiles).mockResolvedValue([]);
}

describe("skill-install", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("installs a new skill from a store entry", async () => {
    mockFetch(MARKDOWN_V1);
    const repository = createMemorySkillRepository();
    const phases: string[] = [];
    const result = await installSkillFromEntry(
      {
        repository,
        onProgress: (progress) => {
          phases.push(progress.phase);
        },
      },
      { slug: "pdf", sourceUrl: "https://example.com/pdf/SKILL.md" },
    );
    expect(result.replaced).toBe(false);
    expect(result.skill.title).toBe("pdf");
    expect(phases).toEqual(["fetching", "parsing", "saving", "done"]);
    expect(await findInstalledBySlug(repository, "pdf")).not.toBeNull();
  });

  it("replaces on duplicate slug and detects updates by hash", async () => {
    mockFetch(MARKDOWN_V1);
    const repository = createMemorySkillRepository();
    const first = await installSkillFromEntry(
      { repository },
      {
        author: "Anthropic",
        slug: "pdf",
        sourceUrl: "https://example.com/pdf/SKILL.md",
      },
    );
    expect(first.unchanged).toBe(false);
    expect(first.skill.author).toBe("Anthropic");
    expect(first.skill.sourceUrl).toBe("https://example.com/pdf/SKILL.md");
    mockFetch(MARKDOWN_V2);
    const installed = (await findInstalledBySlug(repository, "pdf"))!;
    expect(
      await isSkillUpdateAvailable(installed, "https://example.com/pdf/SKILL.md"),
    ).toBe(true);
    const second = await installSkillFromEntry(
      { repository },
      { slug: "pdf", sourceUrl: "https://example.com/pdf/SKILL.md" },
    );
    expect(second.replaced).toBe(true);
    expect(second.unchanged).toBe(false);
    expect(repository.rows).toHaveLength(1);
    expect(second.skill.description).toContain("well");
  });

  it("reports unchanged without rewriting", async () => {
    mockFetch(MARKDOWN_V1);
    const repository = createMemorySkillRepository();
    await installSkillFromEntry(
      { repository },
      { slug: "pdf", sourceUrl: "https://example.com/pdf/SKILL.md" },
    );
    const before = repository.rows[0]?.updatedAt;
    const repeat = await installSkillFromEntry(
      { repository },
      { slug: "pdf", sourceUrl: "https://example.com/pdf/SKILL.md" },
    );
    expect(repeat.unchanged).toBe(true);
    expect(repository.rows[0]?.updatedAt).toBe(before);
  });

  it("fails closed on invalid content with nothing persisted", async () => {
    mockFetch(MARKDOWN_BAD);
    const repository = createMemorySkillRepository();
    await expect(
      installSkillFromEntry(
        { repository },
        { slug: "pdf", sourceUrl: "https://example.com/pdf/SKILL.md" },
      ),
    ).rejects.toThrow(/invalid/i);
    expect(repository.rows).toHaveLength(0);
  });

  it("rejects bundle name mismatch", async () => {
    mockFetch(MARKDOWN_V1);
    const repository = createMemorySkillRepository();
    await expect(
      installSkillFromEntry(
        { repository },
        { slug: "other", sourceUrl: "https://example.com/pdf/SKILL.md" },
      ),
    ).rejects.toThrow(/nameLocked|metadata invalid/);
    expect(repository.rows).toHaveLength(0);
  });

  it("uninstalls and verifies removal", async () => {
    mockFetch(MARKDOWN_V1);
    const repository = createMemorySkillRepository();
    const result = await installSkillFromEntry(
      { repository },
      { slug: "pdf", sourceUrl: "https://example.com/pdf/SKILL.md" },
    );
    await uninstallSkill(repository, result.skill.id);
    expect(await findInstalledBySlug(repository, "pdf")).toBeNull();
  });
});
