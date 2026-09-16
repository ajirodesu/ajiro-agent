import { describe, expect, it } from "vitest";

import type { AgentConfig, InteractionMode } from "@/core/types/app-state";
import {
  isBotModeInteraction,
  isReadOnlyRun,
} from "@/modules/agents/permissions";

function agent(name: string): AgentConfig {
  return {
    createdAt: "",
    description: null,
    enabled: true,
    hidden: false,
    id: name,
    mode: "all",
    modelModelId: null,
    modelProviderId: null,
    name,
    prompt: null,
    sourceMarkdown: null,
    sourceUrl: null,
    lastSyncedAt: null,
    temperature: null,
    toolPermissions: {},
    updatedAt: "",
  };
}

describe("interaction mode", () => {
  it("detects Bot Mode and fails open on unknown values", () => {
    expect(isBotModeInteraction("bot")).toBe(true);
    expect(isBotModeInteraction("agent")).toBe(false);
    expect(isBotModeInteraction(null)).toBe(false);
    expect(isBotModeInteraction(undefined)).toBe(false);
    expect(isBotModeInteraction("something-else")).toBe(false);
  });

  it("treats Bot Mode conversations as read-only runs", () => {
    const build = agent("build");
    const plan = agent("plan");
    const mode: InteractionMode = "agent";
    expect(isReadOnlyRun(build, mode)).toBe(false);
    expect(isReadOnlyRun(build, "bot")).toBe(true);
    // Plan agents stay read-only in both postures.
    expect(isReadOnlyRun(plan, mode)).toBe(true);
    expect(isReadOnlyRun(plan, "bot")).toBe(true);
    // Missing columns on unmigrated databases fail open to acting.
    expect(isReadOnlyRun(build, null)).toBe(false);
    expect(isReadOnlyRun(build, undefined)).toBe(false);
  });
});
