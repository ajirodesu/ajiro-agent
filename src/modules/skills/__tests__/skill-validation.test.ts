import { describe, expect, it } from "vitest";

import {
  describeSkillMetadataError,
  getSkillMetadataError,
  isValidSkillName,
  validateSkillDraft,
} from "@/modules/skills/skill-validation";

describe("skill-validation", () => {
  it("accepts a well-formed name", () => {
    expect(isValidSkillName("pdf-helper")).toBe(true);
    expect(isValidSkillName("PDF")).toBe(false);
    expect(isValidSkillName("a/b")).toBe(false);
    expect(isValidSkillName("..")).toBe(false);
    expect(isValidSkillName("x".repeat(81))).toBe(false);
  });

  it("requires frontmatter, name, and single-line description", () => {
    expect(getSkillMetadataError(null)).toEqual({ type: "required" });
    expect(getSkillMetadataError("name: ok")).toEqual({ type: "descriptionRequired" });
    expect(getSkillMetadataError("description: ok")).toEqual({ type: "nameRequired" });
    expect(getSkillMetadataError("name: Bad_Name\ndescription: ok")).toEqual({
      type: "nameInvalid",
    });
    expect(getSkillMetadataError("name: ok\ndescription: |\n  line one\n  line two")).toEqual(
      { type: "descriptionInvalid" },
    );
    expect(getSkillMetadataError("- just\n- a\n- list")).toEqual({ type: "mapping" });
    expect(getSkillMetadataError("name: [unclosed")).toEqual({ type: "syntax" });
    expect(
      getSkillMetadataError("name: ok\ndescription: Use for pdf work."),
    ).toBeUndefined();
  });

  it("locks the bundle name on import", () => {
    expect(
      getSkillMetadataError("name: other\ndescription: ok", { expectedName: "pdf" }),
    ).toEqual({ expectedName: "pdf", type: "nameLocked" });
    expect(
      getSkillMetadataError("name: pdf\ndescription: ok", { expectedName: "pdf" }),
    ).toBeUndefined();
  });

  it("describes every error for UI", () => {
    const described = describeSkillMetadataError({ type: "nameLocked", expectedName: "pdf" });
    expect(described).toContain("pdf");
  });

  it("validates editor drafts", () => {
    expect(
      validateSkillDraft({ title: "", description: null, instructions: "", matchKeywords: [] }),
    ).toHaveLength(2);
    expect(
      validateSkillDraft({
        title: "Pdf",
        description: "two\nlines",
        instructions: "do things",
        matchKeywords: Array.from({ length: 21 }, (_, i) => `k${i}`),
      }),
    ).toHaveLength(2);
    expect(
      validateSkillDraft({
        title: "Pdf",
        description: "Read pdf files.",
        instructions: "Do the thing.",
        matchKeywords: ["pdf"],
      }),
    ).toEqual([]);
  });
});
