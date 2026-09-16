import { describe, expect, it } from "vitest";

import type { AgentConfig } from "@/core/types/app-state";
import {
  parseAgentMarkdown,
  serializeAgentToMarkdown,
} from "@/modules/agents/agent-markdown";
import {
  agentAllowsSkillId,
  agentDeniedSkillIds,
} from "@/modules/agents/permissions";

function agent(toolPermissions: AgentConfig["toolPermissions"]): AgentConfig {
  return {
    createdAt: "",
    description: null,
    enabled: true,
    hidden: false,
    id: "a",
    mode: "all",
    modelModelId: null,
    modelProviderId: null,
    name: "agent",
    prompt: null,
    sourceMarkdown: null,
    sourceUrl: null,
    lastSyncedAt: null,
    temperature: null,
    toolPermissions,
    updatedAt: "",
  };
}

describe("agent skill permissions", () => {
  it("allows by default and denies explicitly", () => {
    expect(agentAllowsSkillId(agent({}), "s1")).toBe(true);
    expect(agentAllowsSkillId(agent({ skills: { s1: false } }), "s1")).toBe(false);
    expect(agentAllowsSkillId(agent({ skills: { s1: true } }), "s1")).toBe(true);
    expect(agentDeniedSkillIds(agent({ skills: { s1: false, s2: true } }))).toEqual([
      "s1",
    ]);
  });

  it("round-trips skill permissions through agent markdown", () => {
    const markdown = serializeAgentToMarkdown({
      description: null,
      mode: "all",
      modelModelId: null,
      modelProviderId: null,
      name: "reviewer",
      prompt: "Review.",
      temperature: null,
      toolPermissions: { skills: { "skill-1": false } },
    });
    expect(markdown).toContain("skill:skill-1");
    const parsed = parseAgentMarkdown(markdown);
    expect(parsed.toolPermissions.skills).toEqual({ "skill-1": false });
  });
});
