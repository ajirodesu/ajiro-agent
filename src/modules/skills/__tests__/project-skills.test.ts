import { describe, expect, it } from "vitest";

import {
  buildProjectSkillsPrompt,
  resolveProjectSkills,
  type ProjectSkillFs,
} from "@/modules/skills/project-skills";

function fs(files: Record<string, string>, failDirs: string[] = []): ProjectSkillFs {
  return {
    async listDir(path: string) {
      if (failDirs.includes(path)) throw new Error("no access");
      const prefix = `${path}/`;
      const seen = new Map<string, "file" | "dir">();
      for (const key of Object.keys(files)) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        const [head, ...tail] = rest.split("/");
        if (!head) continue;
        if (tail.length === 0) {
          seen.set(head, "file");
        } else if (!seen.has(head)) {
          seen.set(head, "dir");
        }
      }
      return [...seen.entries()].map(([name, kind]) => ({ kind, name }));
    },
    async readFile(path: string) {
      const content = files[path];
      if (content === undefined) throw new Error(`missing: ${path}`);
      return content;
    },
  };
}

const REVIEW = `---
name: review
description: Review pull requests for quality.
---
# Review
Check tests first.`;

describe("project-skills", () => {
  it("discovers SKILL.md skills across conventional dirs", async () => {
    const adapter = fs({
      ".agents/skills/review/SKILL.md": REVIEW,
      ".claude/skills/plan/SKILL.md": REVIEW.replace("review", "plan").replace(
        "Review pull requests",
        "Plan the work",
      ),
    });
    const result = await resolveProjectSkills(adapter);
    expect(result.skills.map((skill) => skill.name).sort()).toEqual([
      "plan",
      "review",
    ]);
    expect(result.skills.every((skill) => skill.scope === "project")).toBe(true);
    expect(result.skills.every((skill) => skill.invalidReason === null)).toBe(true);
    expect(result.unreadableDirs).toEqual([]);
  });

  it("reports invalid and unreadable skills without aborting", async () => {
    const adapter = fs(
      {
        ".agents/skills/broken/SKILL.md": "no frontmatter here",
        ".agents/skills/strict/SKILL.md": "---\nname: ok\n---\nBody here.",
      },
      [],
    );
    const result = await resolveProjectSkills(adapter);
    const broken = result.skills.find((skill) => skill.name === "broken");
    expect(broken?.invalidReason).toMatch(/SKILL\.md/);
    const strict = result.skills.find((skill) => skill.name === "ok");
    expect(strict?.invalidReason).toContain("descriptionRequired");
  });

  it("builds a read-only prompt block for valid skills", async () => {
    const adapter = fs({ ".agents/skills/review/SKILL.md": REVIEW });
    const result = await resolveProjectSkills(adapter);
    const prompt = buildProjectSkillsPrompt(result.skills);
    expect(prompt).toContain("<project_skills>");
    expect(prompt).toContain("read-only");
    expect(prompt).toContain("Check tests first.");
    expect(buildProjectSkillsPrompt([])).toBeUndefined();
  });
});
