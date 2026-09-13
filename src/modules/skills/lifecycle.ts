/**
 * Skill lifecycle (§19): SKILL.md discovery, versioning, auto-invocation
 * matching, enable/disable. Storage stays in the skills tables; version is
 * derived (frontmatter `version:` else content hash) so no migration is
 * needed for lifecycle metadata.
 *
 * Source provenance: SKILL.md shape follows publicly documented skill
 * conventions; lifecycle rules are [AJIRO ORIGINAL].
 */
import { parseSkillMarkdown } from "@/modules/skills/skill-markdown";
import type { SkillConfig } from "@/core/types/app-state";

export type SkillDraft = {
  title: string;
  description: string | null;
  instructions: string;
  version: string;
  autoMatch: boolean;
  matchKeywords: string[];
};

export function versionForSkillContent(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i += 1) {
    hash = (hash * 31 + content.charCodeAt(i)) | 0;
  }
  return `0.0.0+${(hash >>> 0).toString(16)}`;
}

/** Discover a skill from SKILL.md content (throws on invalid markdown). */
export function discoverSkillFromMarkdown(markdown: string): SkillDraft {
  const parsed = parseSkillMarkdown(markdown);
  const frontmatterVersion =
    /version\s*:\s*["']?([0-9][^"'\s]*)["']?/i.exec(markdown)?.[1] ?? null;
  return {
    title: parsed.title,
    description: parsed.description,
    instructions: parsed.instructions,
    version: frontmatterVersion ?? versionForSkillContent(markdown),
    autoMatch: parsed.autoMatch,
    matchKeywords: parsed.matchKeywords,
  };
}

/** Score a skill against a user prompt for automatic invocation. */
export function scoreSkillForPrompt(
  skill: Pick<SkillConfig, "enabled" | "autoMatch" | "matchKeywords" | "title" | "description">,
  prompt: string,
): number {
  if (!skill.enabled || !skill.autoMatch) return 0;
  const haystack = prompt.toLowerCase();
  let score = 0;
  for (const keyword of skill.matchKeywords) {
    if (keyword.trim() && haystack.includes(keyword.toLowerCase())) {
      score += 2;
    }
  }
  const title = skill.title.toLowerCase();
  if (title && haystack.includes(title)) score += 1;
  return score;
}

/** Rank enabled auto-match skills for a prompt, highest first. */
export function matchSkillsForPrompt<
  T extends Pick<
    SkillConfig,
    "enabled" | "autoMatch" | "matchKeywords" | "title" | "description"
  >,
>(skills: T[], prompt: string): { skill: T; score: number }[] {
  return skills
    .map((skill) => ({ skill, score: scoreSkillForPrompt(skill, prompt) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);
}
