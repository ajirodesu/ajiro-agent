/**
 * Strict SKILL.md frontmatter validation.
 *
 * Adapted from the lobehub source of truth
 * (`src/utils/skillMarkdown.ts` +
 * `apps/server/src/services/skillManagement/frontmatter.ts`):
 * a managed skill requires a kebab-case `name` (≤80 chars, locked to the
 * bundle slug on import) and a single-line `description` (multi-line
 * scalars are rejected: they break listings and enable frontmatter
 * injection through crafted line breaks).
 *
 * Ajiro's `parseSkillMarkdown` stays the lenient reader for already-stored
 * skills; this module is the gate for NEW imports and editor saves, with
 * typed errors so UI can explain exactly what to fix.
 */
import { parse as parseYaml } from "yaml";

import { normalizeSkillSlug } from "@/modules/skills/skill-markdown";

export const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const MAX_SKILL_NAME_LENGTH = 80;
export const MAX_SKILL_TITLE_LENGTH = 64;
export const MAX_SKILL_DESCRIPTION_LENGTH = 1024;
export const MAX_SKILL_INSTRUCTIONS_LENGTH = 40_000;
export const MAX_SKILL_KEYWORDS = 20;
const UNSAFE_SCALAR_PATTERN = /[\r\n]/;

export type SkillMetadataError =
  | { type: "required" }
  | { type: "mapping" }
  | { type: "syntax" }
  | { type: "nameRequired" }
  | { type: "nameInvalid" }
  | { expectedName: string; type: "nameLocked" }
  | { type: "descriptionRequired" }
  | { type: "descriptionInvalid" };

export function isValidSkillName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= MAX_SKILL_NAME_LENGTH &&
    SKILL_NAME_PATTERN.test(name) &&
    !name.includes("/") &&
    !name.includes("\\") &&
    name !== "." &&
    name !== ".."
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read a single scalar frontmatter field (e.g. `license:`) from raw
 * SKILL.md content. Returns null when absent or non-scalar — used for
 * display (license notices) rather than validation.
 */
export function extractFrontmatterField(
  content: string,
  field: string,
): string | null {
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---/.exec(
    content.replace(/^\uFEFF/, "").trimStart(),
  )?.[1];
  if (!match) return null;
  let parsed: unknown;
  try {
    parsed = parseYaml(match);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const value = parsed[field];
  if (typeof value !== "string" || !value.trim()) return null;
  return value.trim().slice(0, 200);
}

/**
 * Validate raw frontmatter YAML. When `expectedName` is given (imported
 * bundle slug), a differing `name:` is a `nameLocked` error instead of
 * silently renaming the skill.
 */
export function getSkillMetadataError(
  frontmatter: string | null | undefined,
  options?: { expectedName?: string },
): SkillMetadataError | undefined {
  if (!frontmatter?.trim()) return { type: "required" };
  let parsed: unknown;
  try {
    parsed = parseYaml(frontmatter);
  } catch {
    return { type: "syntax" };
  }
  if (!isRecord(parsed)) return { type: "mapping" };

  const nameValue = parsed.name;
  if (nameValue === undefined || (typeof nameValue === "string" && !nameValue.trim())) {
    return { type: "nameRequired" };
  }
  if (typeof nameValue !== "string") return { type: "nameInvalid" };
  const name = nameValue.trim();
  if (!isValidSkillName(name)) return { type: "nameInvalid" };

  const expectedName = options?.expectedName?.trim() ?? "";
  if (expectedName && isValidSkillName(expectedName) && name !== expectedName) {
    return { expectedName, type: "nameLocked" };
  }

  const descriptionValue = parsed.description;
  if (
    descriptionValue === undefined ||
    (typeof descriptionValue === "string" && !descriptionValue.trim())
  ) {
    return { type: "descriptionRequired" };
  }
  if (typeof descriptionValue !== "string") return { type: "descriptionInvalid" };
  if (UNSAFE_SCALAR_PATTERN.test(descriptionValue.trim())) {
    return { type: "descriptionInvalid" };
  }
  return undefined;
}

export function describeSkillMetadataError(error: SkillMetadataError): string {
  switch (error.type) {
    case "required":
      return "SKILL.md must start with YAML frontmatter between '---' markers.";
    case "mapping":
      return "Frontmatter must be a YAML map.";
    case "syntax":
      return "Frontmatter could not be parsed as YAML.";
    case "nameRequired":
      return "Frontmatter needs a `name:` (lowercase letters, digits, hyphens).";
    case "nameInvalid":
      return "Invalid skill name: use lowercase letters, digits, and hyphens (max 80 characters).";
    case "nameLocked":
      return `This bundle must keep the name \`${error.expectedName}\`.`;
    case "descriptionRequired":
      return "Frontmatter needs a one-line `description:` of when to use the skill.";
    case "descriptionInvalid":
      return "Description must be a single line of text.";
  }
}

export type SkillDraftInput = {
  title: string;
  description: string | null;
  instructions: string;
  matchKeywords: string[];
};

export type SkillDraftError = {
  field: "title" | "description" | "instructions" | "matchKeywords";
  message: string;
};

/** Validate editor input before it ever reaches storage. */
export function validateSkillDraft(input: SkillDraftInput): SkillDraftError[] {
  const errors: SkillDraftError[] = [];
  const slug = normalizeSkillSlug(input.title);
  if (!input.title.trim()) {
    errors.push({ field: "title", message: "Give the skill a title." });
  } else if (slug === "skill" && !isValidSkillName(input.title.trim().toLowerCase())) {
    errors.push({
      field: "title",
      message: "Title must produce a valid skill name (letters, digits, hyphens).",
    });
  }
  if (input.title.trim().length > MAX_SKILL_TITLE_LENGTH) {
    errors.push({
      field: "title",
      message: `Title must be at most ${MAX_SKILL_TITLE_LENGTH} characters.`,
    });
  }
  if (input.description !== null) {
    if (UNSAFE_SCALAR_PATTERN.test(input.description)) {
      errors.push({ field: "description", message: "Description must be a single line." });
    }
    if (input.description.trim().length > MAX_SKILL_DESCRIPTION_LENGTH) {
      errors.push({
        field: "description",
        message: `Description must be at most ${MAX_SKILL_DESCRIPTION_LENGTH} characters.`,
      });
    }
  }
  if (!input.instructions.trim()) {
    errors.push({ field: "instructions", message: "Instructions cannot be empty." });
  } else if (input.instructions.trim().length > MAX_SKILL_INSTRUCTIONS_LENGTH) {
    errors.push({
      field: "instructions",
      message: `Instructions must be at most ${MAX_SKILL_INSTRUCTIONS_LENGTH} characters.`,
    });
  }
  if (input.matchKeywords.length > MAX_SKILL_KEYWORDS) {
    errors.push({
      field: "matchKeywords",
      message: `Use at most ${MAX_SKILL_KEYWORDS} keywords.`,
    });
  }
  return errors;
}
