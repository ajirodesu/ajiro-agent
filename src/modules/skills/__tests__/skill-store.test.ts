import { describe, expect, it } from "vitest";

import type { SkillRepository } from "@/core/db/repositories/types";
import type { SkillConfig } from "@/core/types/app-state";
import {
  deriveInstallState,
  filterStoreCatalog,
  loadStoreCatalog,
  searchStoreCatalog,
  skillOriginLabel,
  storeCategories,
} from "@/modules/skills/skill-store-catalog";

describe("skill origin labels", () => {
  const catalog = loadStoreCatalog();
  const pdf = catalog.find((entry) => entry.slug === "pdf")!;

  it("labels store, import, and created origins", () => {
    expect(skillOriginLabel({ sourceUrl: pdf.sourceUrl }, catalog)).toContain("Skill Store");
    expect(skillOriginLabel({ sourceUrl: "https://example.com/s/SKILL.md" }, catalog)).toContain(
      "example.com",
    );
    expect(skillOriginLabel({ sourceUrl: null }, catalog)).toBe("Created in Ajiro");
  });
});

describe("skill-store-catalog", () => {
  it("loads a validated, deduplicated, sorted catalog", () => {
    const entries = loadStoreCatalog();
    expect(entries.length).toBeGreaterThan(10);
    const slugs = entries.map((entry) => entry.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const entry of entries) {
      expect(entry.sourceUrl).toMatch(/^https:\/\//);
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(0);
    }
    expect(slugs).toContain("pdf");
    expect(slugs).toContain("mcp-builder");
  });

  it("exposes categories for filtering", () => {
    const entries = loadStoreCatalog();
    const categories = storeCategories(entries);
    expect(categories).toContain("Documents");
    expect(categories).toContain("Development");
  });

  it("searches across name, description, author, and slug", () => {
    const entries = loadStoreCatalog();
    expect(searchStoreCatalog(entries, "").length).toBe(entries.length);
    const pdf = searchStoreCatalog(entries, "pdf");
    expect(pdf.some((entry) => entry.slug === "pdf")).toBe(true);
    const none = searchStoreCatalog(entries, "zzz-no-such-skill");
    expect(none).toEqual([]);
  });

  it("filters by category and installed-only", () => {
    const entries = loadStoreCatalog();
    const docs = filterStoreCatalog(entries, { category: "Documents" });
    expect(docs.length).toBeGreaterThan(0);
    expect(docs.every((entry) => entry.category === "Documents")).toBe(true);
    const installedOnly = filterStoreCatalog(entries, {
      installedOnly: true,
      installedSlugs: new Set(["pdf"]),
    });
    expect(installedOnly.map((entry) => entry.slug)).toEqual(["pdf"]);
  });

  it("derives install states", () => {
    const entries = loadStoreCatalog();
    const pdf = entries.find((entry) => entry.slug === "pdf")!;
    expect(deriveInstallState(pdf, [])).toBe("not-installed");
    expect(
      deriveInstallState(pdf, [
        { contentHash: "x", enabled: true, id: "1", slug: "pdf", title: "Pdf" },
      ]),
    ).toBe("installed");
    expect(
      deriveInstallState(pdf, [
        { contentHash: "x", enabled: false, id: "1", slug: "pdf", title: "Pdf" },
      ]),
    ).toBe("installed-disabled");
    expect(
      deriveInstallState(
        pdf,
        [{ contentHash: "x", enabled: true, id: "1", slug: "pdf", title: "Pdf" }],
        new Set(["pdf"]),
      ),
    ).toBe("update-available");
  });
});

export function createMemorySkillRepository(): SkillRepository & {
  rows: SkillConfig[];
} {
  const rows: SkillConfig[] = [];
  let seq = 1;
  const stamp = "2026-01-01T00:00:00.000Z";
  return {
    rows,
    async create(input) {
      const skill: SkillConfig = {
        author: input.author ?? null,
        autoMatch: input.autoMatch ?? false,
        createdAt: stamp,
        description: input.description ?? null,
        enabled: input.enabled ?? true,
        id: input.id ?? `skill-${seq++}`,
        instructions: input.instructions,
        matchKeywords: input.matchKeywords ?? [],
        recommendedBuiltInToolKeys: input.recommendedBuiltInToolKeys ?? [],
        recommendedMcpServerIds: input.recommendedMcpServerIds ?? [],
        skillFiles: (input.skillFiles ?? []).map((file, index) => ({
          ...file,
          createdAt: stamp,
          id: `file-${seq}-${index}`,
          updatedAt: stamp,
        })),
        sourceMarkdown: input.sourceMarkdown ?? null,
        sourceUrl: input.sourceUrl ?? null,
        title: input.title,
        updatedAt: stamp,
      };
      rows.push(skill);
      return skill;
    },
    async delete(id) {
      const index = rows.findIndex((skill) => skill.id === id);
      if (index >= 0) rows.splice(index, 1);
    },
    async deleteFilesForSkill() {},
    async getById(id) {
      return rows.find((skill) => skill.id === id) ?? null;
    },
    async list() {
      return [...rows];
    },
    async listFilesForSkill(skillId) {
      return rows.find((skill) => skill.id === skillId)?.skillFiles ?? [];
    },
    async update(id, input) {
      const skill = rows.find((entry) => entry.id === id);
      if (!skill) return;
      Object.assign(skill, {
        ...input,
        skillFiles:
          input.skillFiles !== undefined
            ? input.skillFiles.map((file, index) => ({
                ...file,
                createdAt: stamp,
                id: `file-${id}-${index}`,
                updatedAt: stamp,
              }))
            : skill.skillFiles,
        updatedAt: stamp,
      });
    },
  };
}
