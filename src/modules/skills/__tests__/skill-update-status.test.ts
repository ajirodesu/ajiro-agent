import { describe, expect, it, vi } from "vitest";

import { fetchSkillFiles } from "@/modules/skills/skill-files";
import { fetchSkillMarkdownFromUrl } from "@/modules/skills/skill-github";
import { installSkillFromEntry } from "@/modules/skills/skill-install";
import { createSkillRollbackStore } from "@/modules/skills/skill-rollback";
import {
  deriveSkillUpdateStatus,
  findMissingSkillDependencies,
  findRevokedInstalledSkills,
} from "@/modules/skills/skill-update-status";
import type { SkillRegistryEntry } from "@/modules/skills/skill-registry";
import { createMemorySkillRepository } from "@/modules/skills/__tests__/skill-store.test";

vi.mock("@/modules/skills/skill-github", () => ({
  fetchSkillMarkdownFromUrl: vi.fn(),
}));

vi.mock("@/modules/skills/skill-files", () => ({
  fetchSkillFiles: vi.fn(),
}));

const MARKDOWN_V1 = `---
name: pdf
description: Work with PDF files.
---
# Pdf
Read them.`;

const MARKDOWN_V2 = `---
name: pdf
description: Work with PDF files well.
---
# Pdf
Read them carefully.`;

function mockFetch(content: string) {
  vi.mocked(fetchSkillMarkdownFromUrl).mockResolvedValue({
    content,
    displayName: "SKILL.md",
  });
  vi.mocked(fetchSkillFiles).mockResolvedValue([]);
}

function entry(overrides: Partial<SkillRegistryEntry> = {}): SkillRegistryEntry {
  const base: SkillRegistryEntry = {
    author: "Anthropic",
    category: "Documents",
    channel: null,
    changelog: null,
    dependencies: [],
    deprecated: false,
    description: "Reads PDFs.",
    hash: null,
    maxAppVersion: null,
    minAppVersion: null,
    name: "PDF",
    platforms: [],
    publishedAt: null,
    requiredCapabilities: [],
    revoked: false,
    rolloutPercent: null,
    signature: null,
    slug: "pdf",
    sourceUrl: "https://example.com/pdf/SKILL.md",
    updatedAt: null,
    version: null,
  };
  return Object.assign(base, overrides);
}

describe("skill update statuses", () => {
  it("orders revocation, rollout, support, and install state", () => {
    expect(deriveSkillUpdateStatus(entry({ revoked: true }), null).status).toBe(
      "revoked",
    );
    expect(
      deriveSkillUpdateStatus(entry({ channel: "beta" }), null, { channel: "stable" })
        .status,
    ).toBe("not-installed");
    expect(
      deriveSkillUpdateStatus(entry({ minAppVersion: "9.0.0" }), null, {
        appVersion: "1.1.5",
      }).status,
    ).toBe("requires-app-update");
    expect(
      deriveSkillUpdateStatus(entry({ requiredCapabilities: ["arKit"] }), null)
        .status,
    ).toBe("requires-app-update");
    expect(deriveSkillUpdateStatus(entry({ deprecated: true }), null).status).toBe(
      "deprecated",
    );
    expect(deriveSkillUpdateStatus(entry(), null).status).toBe("not-installed");
    expect(deriveSkillUpdateStatus(entry(), { enabled: false }).status).toBe(
      "disabled",
    );
    expect(deriveSkillUpdateStatus(entry(), { enabled: true }).status).toBe(
      "installed",
    );
    expect(
      deriveSkillUpdateStatus(entry({ version: "2.0.0" }), {
        enabled: true,
        version: "1.0.0",
      }).status,
    ).toBe("update-available");
    expect(
      deriveSkillUpdateStatus(entry(), { enabled: true }, { updateAvailable: true })
        .status,
    ).toBe("update-available");
  });

  it("finds revoked installed skills for the disable flow", () => {
    expect(
      findRevokedInstalledSkills(
        [entry({ slug: "a" }), entry({ revoked: true, slug: "b" })],
        ["a", "b"],
      ),
    ).toEqual(["b"]);
  });

  it("separates platform and ceiling incompatibility", () => {
    expect(
      deriveSkillUpdateStatus(entry({ platforms: ["ios"] }), null, {
        platform: "android",
      }).status,
    ).toBe("incompatible");
    expect(
      deriveSkillUpdateStatus(entry({ maxAppVersion: "1.0.0" }), null, {
        appVersion: "1.1.5",
      }).status,
    ).toBe("incompatible");
    expect(
      deriveSkillUpdateStatus(
        entry({ maxAppVersion: "2.0.0", platforms: ["android"] }),
        null,
        { appVersion: "1.1.5", platform: "android" },
      ).status,
    ).toBe("not-installed");
  });

  it("lists missing skill dependencies", () => {
    expect(
      findMissingSkillDependencies(entry({ dependencies: ["b", "c"], slug: "a" }), [
        "b",
      ]),
    ).toEqual(["c"]);
    expect(findMissingSkillDependencies(entry({ slug: "a" }), [])).toEqual([]);
  });

  it("refuses platform, floor, and ceiling mismatches at install", async () => {
    mockFetch(MARKDOWN_V1);
    const repository = createMemorySkillRepository();
    const base = { slug: "pdf", sourceUrl: "https://example.com/pdf/SKILL.md" };
    await expect(
      installSkillFromEntry({ repository }, base, {
        platform: "android",
        platforms: ["ios"],
      }),
    ).rejects.toThrow(/does not support/);
    await expect(
      installSkillFromEntry({ repository }, base, {
        appVersion: "1.0.0",
        minAppVersion: "2.0.0",
      }),
    ).rejects.toThrow(/newer/);
    await expect(
      installSkillFromEntry({ repository }, base, {
        appVersion: "3.0.0",
        maxAppVersion: "2.0.0",
      }),
    ).rejects.toThrow(/up to/);
    expect(repository.rows).toHaveLength(0);
  });
});

describe("skill install guards", () => {
  it("refuses revoked skills before any fetch", async () => {
    mockFetch(MARKDOWN_V1);
    const repository = createMemorySkillRepository();
    await expect(
      installSkillFromEntry(
        { repository },
        { slug: "pdf", sourceUrl: "https://example.com/pdf/SKILL.md" },
        { revokedSlugs: new Set(["pdf"]) },
      ),
    ).rejects.toThrow(/revoked/);
    expect(vi.mocked(fetchSkillMarkdownFromUrl)).not.toHaveBeenCalled();
    expect(repository.rows).toHaveLength(0);
  });

  it("refuses missing native capabilities as Requires App Update", async () => {
    mockFetch(MARKDOWN_V1);
    const repository = createMemorySkillRepository();
    await expect(
      installSkillFromEntry(
        { repository },
        { slug: "pdf", sourceUrl: "https://example.com/pdf/SKILL.md" },
        { requiredCapabilities: ["mcp:stdio"] },
      ),
    ).rejects.toThrow(/Ajiro Agent update|missing native/);
    expect(repository.rows).toHaveLength(0);
  });

  it("fails closed on hash mismatch", async () => {
    mockFetch(MARKDOWN_V1);
    const repository = createMemorySkillRepository();
    await expect(
      installSkillFromEntry(
        { repository },
        { slug: "pdf", sourceUrl: "https://example.com/pdf/SKILL.md" },
        { expectedHash: "deadbeef" },
      ),
    ).rejects.toThrow(/integrity|hash mismatch/);
    expect(repository.rows).toHaveLength(0);
  });

  it("records trust and snapshots the replaced copy for rollback", async () => {
    mockFetch(MARKDOWN_V1);
    const repository = createMemorySkillRepository();
    const rollback = createSkillRollbackStore();
    const first = await installSkillFromEntry(
      { repository },
      { slug: "pdf", sourceUrl: "https://example.com/pdf/SKILL.md" },
      { rollback },
    );
    expect(first.trust).toBe("unknown");
    expect(rollback.has("pdf")).toBe(false);

    mockFetch(MARKDOWN_V2);
    const second = await installSkillFromEntry(
      { repository },
      { slug: "pdf", sourceUrl: "https://example.com/pdf/SKILL.md" },
      { expectedHash: undefined, rollback },
    );
    expect(second.replaced).toBe(true);
    expect(rollback.has("pdf")).toBe(true);

    const restored = await rollback.rollback(repository, "pdf");
    expect(restored.description).toContain("PDF files.");
    expect(restored.description).not.toContain("well");
    expect(rollback.has("pdf")).toBe(false);
  });

  it("rollback refuses without a snapshot", async () => {
    const repository = createMemorySkillRepository();
    const rollback = createSkillRollbackStore();
    await expect(rollback.rollback(repository, "pdf")).rejects.toThrow(/snapshot/);
  });
});
