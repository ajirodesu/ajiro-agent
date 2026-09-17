import { describe, expect, it, vi } from "vitest";

import {
  fetchSkillRegistry,
  filterRevokedSkillEntries,
  parseSkillRegistry,
  resetSkillRegistryCache,
  SKILL_REGISTRY_TTL_MS,
} from "../skill-registry";

const REMOTE = {
  skills: [
    {
      author: "Anthropic",
      category: "Documents",
      channel: "beta",
      description: "Reads PDFs.",
      name: "PDF",
      slug: "pdf",
      sourceUrl: "https://example.com/pdf/SKILL.md",
      version: "1.2.0",
    },
    {
      author: "Anthropic",
      category: "Documents",
      description: "Reads Word docs.",
      name: "Word",
      revoked: true,
      slug: "docx",
      sourceUrl: "https://example.com/docx/SKILL.md",
    },
    { broken: true },
  ],
  version: 1,
};

function fetchOk(body: unknown, headers: Record<string, string> = {}) {
  return vi.fn(async () => ({
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
    ok: true,
    status: 200,
  }));
}

describe("skill registry", () => {
  it("parses extended entries and drops invalid ones", () => {
    const entries = parseSkillRegistry(REMOTE);
    expect(entries.map((entry) => entry.slug)).toEqual(["pdf", "docx"]);
    expect(entries[0]).toMatchObject({
      channel: "beta",
      revoked: false,
      version: "1.2.0",
    });
    expect(entries[1]).toMatchObject({ channel: null, revoked: true, version: null });
    expect(filterRevokedSkillEntries(entries).map((entry) => entry.slug)).toEqual([
      "pdf",
    ]);
  });

  it("drops entries with bad channels and rollouts", () => {
    expect(
      parseSkillRegistry({
        skills: [{ ...REMOTE.skills[0], channel: "nightly" }],
      }),
    ).toEqual([]);
    expect(
      parseSkillRegistry({
        skills: [{ ...REMOTE.skills[0], rolloutPercent: 101 }],
      }),
    ).toEqual([]);
  });

  it("fetches remotely, revalidates conditionally, and falls back bundled", async () => {
    resetSkillRegistryCache();
    const fetchImpl = fetchOk(REMOTE, { etag: '"v1"' });
    const first = await fetchSkillRegistry({ fetchImpl, now: () => 0 });
    expect(first.source).toBe("remote");
    expect(first.entries.map((entry) => entry.slug)).toEqual(["pdf", "docx"]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    // Fresh cache: no second fetch.
    await fetchSkillRegistry({ fetchImpl, now: () => 1_000 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    // Stale cache: conditional headers ride along; a 304 extends it.
    let seenHeaders: Record<string, string> = {};
    const notModified = async (
      _url: string,
      init?: { headers?: Record<string, string> },
    ) => {
      seenHeaders = init?.headers ?? {};
      return {
        headers: { get: () => null },
        json: async () => null,
        ok: false,
        status: 304,
      };
    };
    const second = await fetchSkillRegistry({
      fetchImpl: notModified,
      now: () => SKILL_REGISTRY_TTL_MS + 1,
    });
    expect(second.source).toBe("remote");
    expect(second.entries).toHaveLength(2);
    expect(seenHeaders).toMatchObject({ "If-None-Match": '"v1"' });

    // Total failure: the bundled catalog keeps the Store usable.
    resetSkillRegistryCache();
    const failing = vi.fn(async () => {
      throw new Error("offline");
    });
    const third = await fetchSkillRegistry({ fetchImpl: failing, now: () => 0 });
    expect(third.source).toBe("bundled");
    expect(third.entries.length).toBeGreaterThan(0);
    resetSkillRegistryCache();
  });
});
