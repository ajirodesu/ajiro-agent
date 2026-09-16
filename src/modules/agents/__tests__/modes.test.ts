import { describe, expect, it } from "vitest";

import {
  AGENT_MODES,
  getAgentModeDefinition,
  isReadOnlyModeName,
  resolveMaxIterations,
} from "@/modules/agents/modes";
import { isReadOnlyAgent } from "@/modules/agents/permissions";
import {
  NATIVE_AGENTS,
  resolveAgent,
} from "@/modules/agents/registry";
import type { AgentConfig } from "@/core/types/app-state";

function makeAgent(name: string): AgentConfig {
  return {
    id: name,
    name,
    description: null,
    prompt: null,
    mode: "all",
    modelProviderId: null,
    modelModelId: null,
    temperature: null,
    enabled: true,
    hidden: false,
    sourceMarkdown: null,
    sourceUrl: null,
    lastSyncedAt: null,
    toolPermissions: {},
    createdAt: "",
    updatedAt: "",
  };
}

describe("agent modes", () => {
  it("defines all required modes with complete profiles", () => {
    const required = [
      "build",
      "plan",
      "explore",
      "general",
      "review",
      "debug",
      "test",
      "android",
      "git",
      "security",
      "documentation",
      "explorer",
      "planner",
      "code-analyst",
      "test-agent",
      "security-reviewer",
      "android-agent",
      "documentation-agent",
    ];
    for (const name of required) {
      const mode = getAgentModeDefinition(name);
      expect(mode, name).toBeDefined();
      if (!mode) continue;
      expect(mode.description.length).toBeGreaterThan(0);
      expect(mode.instructions.length).toBeGreaterThan(0);
      expect(mode.maxIterations).toBeGreaterThan(0);
      expect(mode.contextPolicy.length).toBeGreaterThan(0);
      expect(["android_local", "linux"]).toContain(mode.runtime);
    }
  });

  it("marks plan, explore, and analysis subagents read-only", () => {
    for (const name of [
      "plan",
      "explore",
      "explorer",
      "planner",
      "code-analyst",
      "security-reviewer",
    ]) {
      expect(isReadOnlyModeName(name)).toBe(true);
    }
    for (const name of ["build", "debug", "test", "general"]) {
      expect(isReadOnlyModeName(name)).toBe(false);
    }
    expect(isReadOnlyModeName("nope")).toBe(false);
  });

  it("registers every mode as a native agent", () => {
    for (const name of Object.keys(AGENT_MODES)) {
      expect(
        NATIVE_AGENTS.some((agent) => agent.name === name),
        name,
      ).toBe(true);
      expect(resolveAgent([], name).name).toBe(name);
    }
  });

  it("treats read-only agents as read-only", () => {
    expect(isReadOnlyAgent(makeAgent("plan"))).toBe(true);
    expect(isReadOnlyAgent(makeAgent("explore"))).toBe(true);
    expect(isReadOnlyAgent(makeAgent("build"))).toBe(false);
  });

  it("caps iterations at the mode budget", () => {
    expect(resolveMaxIterations("explorer", 50)).toBe(15);
    expect(resolveMaxIterations("build", 50)).toBe(50);
    expect(resolveMaxIterations("build", 10)).toBe(10);
    expect(resolveMaxIterations("unknown", 50)).toBe(50);
  });

  it("keeps plan detection intact", () => {
    expect(resolveAgent([], "plan").name).toBe("plan");
    expect(resolveAgent([], "build").name).toBe("build");
  });
});
