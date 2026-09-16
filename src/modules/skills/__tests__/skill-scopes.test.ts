import { describe, expect, it } from "vitest";

import type { AgentConfig, SkillConfig } from "@/core/types/app-state";
import {
  buildActiveSkillsPrompt,
  resolveRuntimeSkills,
  resolveSkillMcpStatus,
} from "@/modules/skills/skill-scopes";

function skill(overrides: Partial<SkillConfig> = {}): SkillConfig {
  const base: SkillConfig = {
    autoMatch: true,
    author: null,
    createdAt: "2026-01-01",
    description: "Does things.",
    enabled: true,
    id: "s1",
    instructions: "Do the thing.",
    matchKeywords: [],
    recommendedBuiltInToolKeys: [],
    recommendedMcpServerIds: [],
    skillFiles: [],
    sourceMarkdown: null,
    sourceUrl: null,
    title: "Skill",
    updatedAt: "2026-01-01",
  };
  return { ...base, ...overrides };
}

function agent(overrides: Partial<AgentConfig> = {}): AgentConfig {
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
    toolPermissions: {},
    updatedAt: "",
    ...overrides,
  };
}

describe("skill-scopes", () => {
  it("manual mode injects only selected skills and excludes them from catalog", () => {
    const skills = [skill({ id: "a" }), skill({ id: "b" })];
    const resolved = resolveRuntimeSkills({
      agent: agent(),
      projectSkillIds: [],
      selectedSkillIds: ["a"],
      skillMode: "manual",
      skills,
    });
    expect(resolved.inline.map((entry) => entry.id)).toEqual(["a"]);
    expect(resolved.catalog.map((entry) => entry.id)).toEqual(["a"]);
    expect(resolved.denied).toEqual([]);
  });

  it("auto mode catalogs the pool and inlines pins without duplication", () => {
    const skills = [skill({ id: "a" }), skill({ id: "b" })];
    const resolved = resolveRuntimeSkills({
      agent: agent(),
      projectSkillIds: ["b"],
      selectedSkillIds: ["a"],
      skillMode: "auto",
      skills,
    });
    expect(resolved.inline.map((entry) => entry.id).sort()).toEqual(["a", "b"]);
    expect(resolved.catalog).toEqual([]);
  });

  it("excludes disabled and agent-denied skills everywhere", () => {
    const skills = [
      skill({ id: "a" }),
      skill({ id: "b", enabled: false }),
      skill({ id: "c" }),
    ];
    const resolved = resolveRuntimeSkills({
      agent: agent({ toolPermissions: { skills: { c: false } } }),
      projectSkillIds: [],
      selectedSkillIds: ["a", "b", "c"],
      skillMode: "manual",
      skills,
    });
    expect(resolved.inline.map((entry) => entry.id)).toEqual(["a"]);
    expect(resolved.denied).toEqual(["c"]);
  });

  it("builds a single inline prompt block", () => {
    const prompt = buildActiveSkillsPrompt([skill({ id: "a", title: "Pdf" })]);
    expect(prompt).toContain("<active_skills>");
    expect(prompt).toContain("Do the thing.");
    expect(buildActiveSkillsPrompt([])).toBeUndefined();
  });

  it("resolves MCP dependency status", () => {
    const status = resolveSkillMcpStatus(
      { recommendedMcpServerIds: ["on", "off", "ghost"] },
      [
        { enabled: true, id: "on", label: "On" },
        { enabled: false, id: "off", label: "Off" },
      ],
    );
    expect(status.satisfied).toBe(false);
    expect(status.available.map((entry) => entry.id)).toEqual(["on"]);
    expect(status.disabled.map((entry) => entry.id)).toEqual(["off"]);
    expect(status.missing).toEqual(["ghost"]);
  });
});
