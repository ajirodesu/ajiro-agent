import { describe, expect, it, vi } from "vitest";

import { fetchSkillFiles } from "@/modules/skills/skill-files";
import { fetchSkillMarkdownFromUrl } from "@/modules/skills/skill-github";
import * as installer from "@/modules/skills/skill-install";
import { createMemorySkillRepository } from "@/modules/skills/__tests__/skill-store.test";

vi.mock("@/modules/skills/skill-github", () => ({
  fetchSkillMarkdownFromUrl: vi.fn(),
}));

vi.mock("@/modules/skills/skill-files", () => ({
  fetchSkillFiles: vi.fn(),
}));

describe("debug guards", () => {
  it("prints what happens", async () => {
    vi.mocked(fetchSkillMarkdownFromUrl).mockResolvedValue({
      content: "---\nname: pdf\ndescription: d\n---\n# Pdf\nHi.",
      displayName: "SKILL.md",
    });
    vi.mocked(fetchSkillFiles).mockResolvedValue([]);
    const repository = createMemorySkillRepository();
    console.log(
      "FN:",
      installer.installSkillFromEntry.toString().slice(0, 400),
    );
    try {
      const result = await installer.installSkillFromEntry(
        { repository },
        { slug: "pdf", sourceUrl: "https://example.com/pdf/SKILL.md" },
        { platform: "android", platforms: ["ios"] },
      );
      console.log("RESOLVED:", JSON.stringify(result).slice(0, 200));
    } catch (error) {
      console.log("THREW:", error instanceof Error ? error.message : String(error));
    }
    expect(true).toBe(true);
  });
});
