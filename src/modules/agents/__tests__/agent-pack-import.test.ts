import { describe, expect, it } from "vitest";

import {
  importAgentPackFromUrls,
  splitPackUrls,
  type PackImportDeps,
} from "@/modules/agents/agent-pack-import";

const AGENT_MD = (name: string) =>
  `---\nname: ${name}\ndescription: Test agent.\n---\n\nDo things.`;

function stubDeps(overrides?: Partial<PackImportDeps>): PackImportDeps & {
  stored: { markdown: string; replaceById?: string | null; sourceUrl: string }[];
} {
  const stored: {
    markdown: string;
    replaceById?: string | null;
    sourceUrl: string;
  }[] = [];
  return {
    stored,
    fetchMarkdown: async () => ({ content: AGENT_MD("fetched") }),
    importMarkdown: async (input) => {
      stored.push(input);
      return { name: "fetched" };
    },
    listAgents: () => [],
    ...overrides,
  };
}

describe("agent-pack-import", () => {
  it("splits pasted text into deduped urls", () => {
    expect(
      splitPackUrls("https://a/x.md\n\nhttps://a/x.md\n  https://b/y.md  "),
    ).toEqual(["https://a/x.md", "https://b/y.md"]);
    expect(splitPackUrls("   \n ")).toEqual([]);
    expect(splitPackUrls(Array.from({ length: 30 }, (_, i) => `https://x/${i}.md`).join("\n"))).toHaveLength(20);
  });

  it("imports every url independently and reports skips", async () => {
    const deps = stubDeps({
      fetchMarkdown: async (url: string) => {
        if (!url.startsWith("https://x/")) throw new Error("Not a valid URL.");
        if (url.includes("bad")) throw new Error("HTTP 404");
        return { content: AGENT_MD(url.includes("one") ? "one" : "two") };
      },
      importMarkdown: async (input) => {
        const name = /name: (\S+)/.exec(input.markdown)?.[1] ?? "?";
        return { name };
      },
    });
    const summary = await importAgentPackFromUrls(
      ["https://x/one.md", "https://x/bad.md", "not markdown at all"],
      deps,
    );
    expect(summary.imported).toEqual(["one"]);
    expect(summary.skipped).toHaveLength(2);
    expect(summary.skipped[0]?.error).toMatch(/404/);
  });

  it("rejects invalid markdown without aborting the pack", async () => {
    const deps = stubDeps({
      fetchMarkdown: async () => ({ content: "no frontmatter here" }),
    });
    const summary = await importAgentPackFromUrls(["https://x/a.md"], deps);
    expect(summary.imported).toEqual([]);
    expect(summary.skipped[0]?.error).toMatch(/AGENT\.md/);
    expect(deps.stored).toHaveLength(0);
  });

  it("replaces same-name user agents but never native ones", async () => {
    const deps = stubDeps({
      listAgents: () => [
        { id: "user-1", name: "mine" },
        { id: "build", name: "build" },
      ],
      fetchMarkdown: async (url: string) => ({
        content: AGENT_MD(url.includes("mine") ? "mine" : "build"),
      }),
      importMarkdown: async (input) => {
        deps.stored.push(input);
        return { name: /name: (\S+)/.exec(input.markdown)?.[1] ?? "?" };
      },
    });
    const summary = await importAgentPackFromUrls(
      ["https://x/mine.md", "https://x/build.md"],
      deps,
    );
    expect(summary.imported).toEqual(["mine"]);
    expect(deps.stored[0]?.replaceById).toBe("user-1");
    expect(deps.stored[0]?.sourceUrl).toBe("https://x/mine.md");
    expect(summary.skipped[0]?.error).toMatch(/Built-in/);
  });
});
