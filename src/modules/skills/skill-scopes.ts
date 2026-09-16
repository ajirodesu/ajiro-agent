/**
 * Skill scope model + runtime resolution (pure, unit-tested).
 *
 * Scopes stay distinct — never one enabled flag:
 * - available: known to the app (installed catalog entry or store entry).
 * - installed: persisted in the skills table (`SkillConfig`).
 * - global: installed + enabled (the default pool).
 * - project: pinned to a project (`ProjectCodingSettings.skillIds`) or
 *   discovered under the project's skill directories (see project-skills).
 * - agent: allowed for the active agent (`toolPermissions.skills`, deny-wins).
 * - conversation-selected: pinned via the composer for this chat.
 * - runtime-active: the resolved set actually injected this turn.
 *
 * Resolution order per turn: agent-deny filter → manual/conversation pinning
 * (manual mode) or global pool (auto mode) → agent/project/conversation
 * additions → dedupe → split into `inline` (full instructions, for
 * explicitly activated skills) and `catalog` (name+description refs for the
 * skill tool). Inline skills are excluded from the catalog block so the
 * model never sees the same skill twice (§duplicate prevention).
 */
import type { AgentConfig, SkillConfig } from "@/core/types/app-state";
import { agentAllowsSkillId } from "@/modules/agents/permissions";

export type SkillScope =
  | "available"
  | "installed"
  | "global"
  | "project"
  | "agent"
  | "conversation"
  | "runtime-active";

export interface McpServerRef {
  id: string;
  label: string;
  enabled: boolean;
}

export interface SkillMcpStatus {
  /** Recommended servers that are enabled and usable. */
  available: McpServerRef[];
  /** Recommended servers that exist but are disabled. */
  disabled: McpServerRef[];
  /** Recommended ids with no matching configured server. */
  missing: string[];
  /** True when every recommended server is enabled. */
  satisfied: boolean;
}

export function resolveSkillMcpStatus(
  skill: Pick<SkillConfig, "recommendedMcpServerIds">,
  servers: McpServerRef[],
): SkillMcpStatus {
  const byId = new Map(servers.map((server) => [server.id, server]));
  const available: McpServerRef[] = [];
  const disabled: McpServerRef[] = [];
  const missing: string[] = [];
  for (const id of skill.recommendedMcpServerIds) {
    const server = byId.get(id);
    if (!server) {
      if (!missing.includes(id)) missing.push(id);
    } else if (server.enabled) {
      if (!available.some((entry) => entry.id === id)) available.push(server);
    } else if (!disabled.some((entry) => entry.id === id)) {
      disabled.push(server);
    }
  }
  return {
    available,
    disabled,
    missing,
    satisfied: disabled.length === 0 && missing.length === 0,
  };
}

export interface RuntimeSkillInput {
  skills: SkillConfig[];
  agent: AgentConfig | null;
  /** Skill ids pinned to the active project. */
  projectSkillIds: string[];
  /** Detected project-directory skills (not yet installed). */
  projectDetectedIds?: string[];
  skillMode: "auto" | "manual";
  selectedSkillIds: string[];
}

export interface ResolvedRuntimeSkills {
  /** Fully injected skills (instructions included). */
  inline: SkillConfig[];
  /** Catalog references for the skill tool (name + description). */
  catalog: SkillConfig[];
  /** Ids denied by the active agent (excluded everywhere). */
  denied: string[];
}

export function resolveRuntimeSkills(input: RuntimeSkillInput): ResolvedRuntimeSkills {
  const denied: string[] = [];
  const allowed = input.skills.filter((skill) => {
    if (!skill.enabled) return false;
    if (input.agent && !agentAllowsSkillId(input.agent, skill.id)) {
      denied.push(skill.id);
      return false;
    }
    return true;
  });
  const byId = new Map(allowed.map((skill) => [skill.id, skill]));

  // Explicit activation wins: conversation pins + project pins (+ detected
  // project skills resolve separately as read-only context).
  const inlineIds = new Set<string>();
  if (input.skillMode === "manual") {
    for (const id of input.selectedSkillIds) {
      if (byId.has(id)) inlineIds.add(id);
    }
  } else {
    for (const id of input.selectedSkillIds) {
      if (byId.has(id)) inlineIds.add(id);
    }
  }
  for (const id of input.projectSkillIds) {
    if (byId.has(id)) inlineIds.add(id);
  }

  const inline = [...inlineIds]
    .map((id) => byId.get(id))
    .filter((skill): skill is SkillConfig => Boolean(skill));

  // Catalog: manual mode lists only explicitly selected skills (the agent
  // must not freelance with unpinned skills); auto mode lists the pool.
  // Inline skills are excluded to prevent duplicate injection.
  const catalog =
    input.skillMode === "manual"
      ? inline
      : allowed.filter((skill) => !inlineIds.has(skill.id));

  return { catalog, denied, inline };
}

/** Prompt block for fully-activated skills (instructions inline, once). */
export function buildActiveSkillsPrompt(skills: SkillConfig[]): string | undefined {
  if (skills.length === 0) return undefined;
  const blocks = skills.map((skill) =>
    [
      "<active_skill>",
      `<name>${skill.title}</name>`,
      skill.description?.trim() ? `<description>${skill.description.trim()}</description>` : null,
      `<instructions>${skill.instructions.trim()}</instructions>`,
      "</active_skill>",
    ]
      .filter(Boolean)
      .join("\n"),
  );
  return [
    "<active_skills>",
    "The following skills are activated for this conversation. Follow their instructions directly; do not call the skill tool to load them again.",
    ...blocks,
    "</active_skills>",
  ].join("\n");
}
