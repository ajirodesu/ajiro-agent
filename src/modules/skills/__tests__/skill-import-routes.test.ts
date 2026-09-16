import { describe, expect, it } from "vitest";

import {
  extractSkillImportRoutes,
  formatSkillImportRoutes,
} from "@/modules/skills/skill-import-routes";

describe("skill-import-routes", () => {
  it("detects SKILL.md links without install intent", () => {
    const routes = extractSkillImportRoutes(
      "Check https://raw.githubusercontent.com/anthropics/skills/main/skills/pdf/SKILL.md please.",
    );
    expect(routes).toEqual([
      {
        method: "importSkill",
        type: "skill-md",
        url: "https://raw.githubusercontent.com/anthropics/skills/main/skills/pdf/SKILL.md",
      },
    ]);
  });

  it("detects GitHub skills directories", () => {
    const routes = extractSkillImportRoutes(
      "See https://github.com/anthropics/skills/tree/main/skills/pdf for docs.",
    );
    expect(routes[0]?.type).toBe("github-dir");
  });

  it("requires install intent for bare repos and zips", () => {
    expect(
      extractSkillImportRoutes("Review https://github.com/foo/bar some time."),
    ).toEqual([]);
    expect(
      extractSkillImportRoutes("Please install https://github.com/foo/bar for me.")[0]?.type,
    ).toBe("github-dir");
    expect(
      extractSkillImportRoutes("Import this pack https://example.com/skills.zip now.")[0]?.type,
    ).toBe("zip");
  });

  it("dedupes, strips punctuation, and caps at five", () => {
    const text = Array.from(
      { length: 7 },
      (_, i) => `https://example.com/s${i}/SKILL.md`,
    ).join(" ");
    const routes = extractSkillImportRoutes(`${text} ${text.split(" ")[0]}.`);
    expect(routes).toHaveLength(5);
    expect(routes[0]?.url.endsWith(".")).toBe(false);
  });

  it("formats an Ajiro-native hint block with no foreign branding", () => {
    const block = formatSkillImportRoutes([
      { method: "importSkill", type: "skill-md", url: "https://x/SKILL.md" },
    ]);
    expect(block).toContain("importSkillFromUrl");
    expect(block).not.toMatch(/lobe/i);
    expect(formatSkillImportRoutes([])).toBeNull();
  });

  it("tells the model zips are unsupported instead of routing them", () => {
    const block = formatSkillImportRoutes([
      { method: "importSkill", type: "zip", url: "https://x/pack.zip" },
    ]);
    expect(block).toContain("ZIP");
    expect(block).not.toContain("pack.zip");
  });
});
