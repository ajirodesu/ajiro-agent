import { describe, expect, it } from "vitest";

import {
  assembleContext,
  contextRestorePoint,
  estimateTokens,
} from "@/modules/context/engine";
import {
  createCapabilityRegistry,
  discoverTools,
  discoveryTokenCost,
  registerCapability,
} from "@/modules/tools/deferred";
import {
  advanceStagedWrite,
  proposeStagedWrite,
  validateStagedWrite,
} from "@/modules/safety/staged-writes";
import {
  isRestrictedHost,
  redactSecrets,
  validateProjectPath,
} from "@/modules/safety/guards";
import {
  discoverSkillFromMarkdown,
  matchSkillsForPrompt,
  versionForSkillContent,
} from "@/modules/skills/lifecycle";

describe("context engine", () => {
  it("estimates tokens and assembles within budget", () => {
    expect(estimateTokens("abcd")).toBe(1);
    const assembled = assembleContext(
      [
        { id: "sys", kind: "instructions", text: "sys", priority: 0, pinned: true },
        { id: "a", kind: "file", text: "x".repeat(400), priority: 1 },
        { id: "b", kind: "file", text: "y".repeat(400), priority: 2 },
      ],
      150,
    );
    expect(assembled.sources.map((source) => source.id)).toContain("sys");
    expect(assembled.totalTokens).toBeLessThanOrEqual(150 + 100);
    expect(assembled.truncated).toContain("b");
    expect(contextRestorePoint(assembled)).toContain("sys");
  });

  it("hard-truncates oversized sources", () => {
    const assembled = assembleContext(
      [{ id: "big", kind: "file", text: "z".repeat(40000), priority: 0 }],
      100000,
      100,
    );
    expect(assembled.truncated).toContain("big");
    expect(assembled.sources[0]?.text).toContain("[truncated]");
  });
});

describe("deferred tool discovery", () => {
  it("discovers relevant schemas and budgets cost", () => {
    const registry = createCapabilityRegistry([
      { toolName: "read", capabilities: ["read file"], schemaTokens: 50 },
      { toolName: "git", capabilities: ["git commit branch"], schemaTokens: 80 },
    ]);
    registerCapability(registry, {
      toolName: "write",
      capabilities: ["write file create"],
      schemaTokens: 60,
    });
    const found = discoverTools(registry, ["commit", "branch"]);
    expect(found.map((tool) => tool.toolName)).toEqual(["git"]);
    expect(discoveryTokenCost(found)).toBe(80);
    expect(discoverTools(registry, ["zzz"])).toEqual([]);
  });
});

describe("staged writes", () => {
  it("walks proposal to approval", () => {
    const proposed = proposeStagedWrite({
      kind: "filesystem-delete",
      summary: "Remove scratch dir",
      detail: { paths: ["scratch/old"] },
    });
    const validated = advanceStagedWrite(proposed, "validated");
    expect(validated.status).toBe("validated");
    const awaiting = advanceStagedWrite(validated, "awaiting-review");
    const approved = advanceStagedWrite(awaiting, "approved");
    expect(advanceStagedWrite(approved, "applied").status).toBe("applied");
  });

  it("fails validation without required detail", () => {
    const proposed = proposeStagedWrite({
      kind: "filesystem-delete",
      summary: "Remove things",
      detail: {},
    });
    expect(validateStagedWrite(proposed)).toContain("paths");
    expect(advanceStagedWrite(proposed, "validated").status).toBe("failed");
    expect(() => advanceStagedWrite(proposed, "approved")).toThrow();
  });
});

describe("safety guards", () => {
  it("redacts secrets from text", () => {
    expect(redactSecrets('api_key: "abcdef123456"')).toContain("[REDACTED]");
    expect(redactSecrets("nothing here")).toBe("nothing here");
    expect(redactSecrets("ghp_abcdefghijklmnopqrstuv")).toBe("[REDACTED]");
  });

  it("validates project paths", () => {
    expect(validateProjectPath("src/a.ts")).toBe("src/a.ts");
    expect(validateProjectPath("./src//a.ts")).toBe("src/a.ts");
    expect(() => validateProjectPath("../escape")).toThrow();
    expect(() => validateProjectPath("/abs")).toThrow();
    expect(() => validateProjectPath("C:\\win")).toThrow();
    expect(() => validateProjectPath("")).toThrow();
  });

  it("flags restricted hosts", () => {
    expect(isRestrictedHost("localhost")).toBe(true);
    expect(isRestrictedHost("127.0.0.1")).toBe(true);
    expect(isRestrictedHost("169.254.169.254")).toBe(true);
    expect(isRestrictedHost("api.github.com")).toBe(false);
  });
});

describe("skill lifecycle", () => {
  const markdown = [
    "---",
    "name: review",
    "description: Review code",
    "version: 1.4.0",
    "match-keywords: review, audit",
    "auto-match: true",
    "---",
    "",
    "# Review",
    "",
    "Review the code carefully.",
  ].join("\n");

  it("discovers skills from SKILL.md", () => {
    const draft = discoverSkillFromMarkdown(markdown);
    expect(draft.title.length).toBeGreaterThan(0);
    expect(draft.instructions).toContain("Review the code");
    expect(draft.version).toBe("1.4.0");
  });

  it("falls back to a content hash version", () => {
    expect(versionForSkillContent("abc")).toMatch(/^0\.0\.0\+[0-9a-f]+$/);
  });

  it("matches skills against prompts", () => {
    const skill = {
      enabled: true,
      autoMatch: true,
      matchKeywords: ["review", "audit"],
      title: "Review",
      description: "Review code",
    };
    const ranked = matchSkillsForPrompt(
      [skill, { ...skill, title: "Other", matchKeywords: ["zzz"] }],
      "please review this audit",
    );
    expect(ranked[0]?.skill.title).toBe("Review");
    expect(
      matchSkillsForPrompt([{ ...skill, enabled: false }], "review"),
    ).toEqual([]);
  });
});
