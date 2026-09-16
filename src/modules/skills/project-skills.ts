/**
 * Project skill resolution (Ajiro adaptation of lobehub's project-skills
 * concept: `useProjectSkills` / `useProjectSkillResolver`).
 *
 * lobehub scans `.agents/skills` + `.claude/skills` in the working
 * directory (and the execution device home) through Electron IPC/RPC —
 * desktop-only transports that are deliberately NOT ported. The mobile
 * equivalent scans the same conventional directories inside the active
 * SAF project folder (plus Ajiro-native `.ajiro/skills`), parses each
 * `SKILL.md` with the strict validator, and surfaces them as read-only
 * project scope: view/preview allowed, rename/delete stay disabled exactly
 * like the source's stubbed row actions.
 *
 * The filesystem access is injected (`ProjectSkillFs`) so the resolution
 * algorithm is fully unit-testable; production passes the SAF-backed
 * adapter from `resolveProjectSkillsForSession`.
 */
import { getSkillMetadataError } from "@/modules/skills/skill-validation";
import { parseSkillMarkdown } from "@/modules/skills/skill-markdown";

export const PROJECT_SKILL_DIRS: readonly string[] = [
  ".agents/skills",
  ".claude/skills",
  ".ajiro/skills",
];

export const PROJECT_SKILL_INDEX = "SKILL.md";
export const MAX_PROJECT_SKILLS = 50;
export const MAX_PROJECT_SKILL_BYTES = 100_000;

export interface ProjectSkillFs {
  listDir(path: string): Promise<{ name: string; kind: "file" | "dir" }[]>;
  readFile(path: string, maxBytes: number): Promise<string>;
}

export interface ProjectSkill {
  /** Stable id for UI/runtime: `project:<dir>/<name>`. */
  id: string;
  name: string;
  description: string | null;
  instructions: string;
  /** Project-relative directory, e.g. `.agents/skills/review`. */
  dir: string;
  scope: "project";
  files: string[];
  invalidReason: string | null;
}

export interface ProjectSkillsResult {
  skills: ProjectSkill[];
  /** Directories that could not be scanned at all. */
  unreadableDirs: string[];
}

function joinPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

export async function resolveProjectSkills(
  fs: ProjectSkillFs,
  opts?: { maxSkills?: number },
): Promise<ProjectSkillsResult> {
  const maxSkills = opts?.maxSkills ?? MAX_PROJECT_SKILLS;
  const skills: ProjectSkill[] = [];
  const unreadableDirs: string[] = [];
  const seen = new Set<string>();

  for (const skillsDir of PROJECT_SKILL_DIRS) {
    let entries: { name: string; kind: "file" | "dir" }[];
    try {
      entries = await fs.listDir(skillsDir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.kind !== "dir") continue;
      if (skills.length >= maxSkills) break;
      const dir = joinPath(skillsDir, entry.name);
      if (seen.has(dir)) continue;
      seen.add(dir);
      let content: string;
      try {
        content = await fs.readFile(
          joinPath(dir, PROJECT_SKILL_INDEX),
          MAX_PROJECT_SKILL_BYTES,
        );
      } catch {
        unreadableDirs.push(dir);
        continue;
      }
      const id = `project:${dir}`;
      let parsed: ReturnType<typeof parseSkillMarkdown>;
      try {
        parsed = parseSkillMarkdown(content);
      } catch (error) {
        skills.push({
          description: null,
          dir,
          files: [],
          id,
          instructions: "",
          invalidReason: error instanceof Error ? error.message : String(error),
          name: entry.name,
          scope: "project",
        });
        continue;
      }
      const frontmatter = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---/.exec(
        content.replace(/^\uFEFF/, "").trimStart(),
      )?.[1];
      const metadataError = getSkillMetadataError(frontmatter);
      skills.push({
        description: parsed.description,
        dir,
        files: parsed.files,
        id,
        instructions: parsed.instructions,
        invalidReason: metadataError
          ? `Strict frontmatter check: ${metadataError.type}`
          : null,
        name: parsed.slug || entry.name,
        scope: "project",
      });
    }
    if (skills.length >= maxSkills) break;
  }

  return { skills, unreadableDirs };
}

/** Prompt block for valid project skills (read-only context, offline). */
export function buildProjectSkillsPrompt(skills: ProjectSkill[]): string | undefined {
  const valid = skills.filter(
    (skill) => !skill.invalidReason && skill.instructions.trim(),
  );
  if (valid.length === 0) return undefined;
  const blocks = valid.map((skill) =>
    [
      "<project_skill>",
      `<name>${skill.name}</name>`,
      `<location>${skill.dir}/SKILL.md</location>`,
      skill.description?.trim() ? `<description>${skill.description.trim()}</description>` : null,
      `<instructions>${skill.instructions.trim().slice(0, 6000)}</instructions>`,
      "</project_skill>",
    ]
      .filter(Boolean)
      .join("\n"),
  );
  return [
    "<project_skills>",
    "Skills discovered in the project folder (read-only: follow their guidance; do not modify them).",
    ...blocks,
    "</project_skills>",
  ].join("\n");
}
