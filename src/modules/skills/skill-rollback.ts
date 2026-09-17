/**
 * Skill rollback snapshots (Dynamic Updates prompt §25).
 *
 * Updates validate before writing, so a failed update keeps the old copy —
 * but a *successful* update that later proves bad (wrong content, broken
 * instructions) needs a way back. This store snapshots the pre-update
 * installed copy (markdown + files) so `rollbackSkill` can restore it.
 * Memory-backed by default; the app may persist snapshots if it wants them
 * to survive restarts.
 */
import type { SkillRepository } from "@/core/db/repositories/types";
import type { SkillConfig, SkillFile } from "@/core/types/app-state";
import { normalizeSkillSlug, parseSkillMarkdown } from "./skill-markdown";

export type SkillSnapshot = {
  skillFiles: SkillFile[];
  slug: string;
  sourceMarkdown: string | null;
  updatedAt: string;
};

export type SkillRollbackStore = {
  clear(slug: string): void;
  has(slug: string): boolean;
  rollback(repository: SkillRepository, slug: string): Promise<SkillConfig>;
  snapshot(repository: SkillRepository, slug: string): Promise<boolean>;
};

export function createSkillRollbackStore(): SkillRollbackStore {
  const snapshots = new Map<string, SkillSnapshot>();

  return {
    clear(slug: string): void {
      snapshots.delete(normalizeSkillSlug(slug));
    },

    has(slug: string): boolean {
      return snapshots.has(normalizeSkillSlug(slug));
    },

    async snapshot(repository: SkillRepository, slug: string): Promise<boolean> {
      const normalized = normalizeSkillSlug(slug);
      const skills = await repository.list();
      const installed =
        skills.find(
          (skill) => normalizeSkillSlug(skill.title) === normalized,
        ) ?? null;
      if (!installed || !installed.sourceMarkdown) return false;
      snapshots.set(normalized, {
        skillFiles: installed.skillFiles.map((file) => ({ ...file })),
        slug: normalized,
        sourceMarkdown: installed.sourceMarkdown,
        updatedAt: installed.updatedAt,
      });
      return true;
    },

    async rollback(repository: SkillRepository, slug: string): Promise<SkillConfig> {
      const normalized = normalizeSkillSlug(slug);
      const snapshot = snapshots.get(normalized);
      if (!snapshot) {
        throw new Error(`No rollback snapshot for skill "${slug}".`);
      }
      const skills = await repository.list();
      const installed =
        skills.find((skill) => normalizeSkillSlug(skill.title) === normalized) ??
        null;
      if (!installed) {
        throw new Error(`Skill "${slug}" is no longer installed.`);
      }
      const current = await repository.getById(installed.id);
      if (!current) throw new Error(`Skill "${slug}" is no longer installed.`);
      // The snapshot is a previously validated install; re-parse for the
      // derived fields, keeping the current row's fields on any surprise so
      // a rollback can never wipe a skill.
      let title = current.title;
      let description = current.description;
      let instructions = current.instructions;
      try {
        const parsed = parseSkillMarkdown(snapshot.sourceMarkdown ?? "");
        if (parsed.title) title = parsed.title;
        if (parsed.description) description = parsed.description;
        if (parsed.instructions) instructions = parsed.instructions;
      } catch {
        // Keep the current row's derived fields.
      }
      await repository.update(installed.id, {
        description,
        instructions,
        skillFiles: snapshot.skillFiles,
        sourceMarkdown: snapshot.sourceMarkdown,
        title,
      });
      const skill = await repository.getById(installed.id);
      if (!skill) throw new Error(`Skill "${slug}" could not be restored.`);
      snapshots.delete(normalized);
      return skill;
    },
  };
}
