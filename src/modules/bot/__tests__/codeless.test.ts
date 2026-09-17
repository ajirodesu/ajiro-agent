import { describe, expect, it, beforeEach } from "vitest";

import {
  CODELESS_AUTHOR,
  normalizeCodelessConfig,
  validateCodelessConfig,
  type CodelessCommandConfig,
  type NormalizedCodelessConfig,
} from "../../../../packages/cat-bot/src/engine/modules/codeless/command-config.types";
import {
  serializeCommandMarkdown,
  parseCommandMarkdown,
} from "../../../../packages/cat-bot/src/engine/modules/codeless/command-markdown";
import { compileNormalizedCommandModule } from "../../../../packages/cat-bot/src/engine/modules/codeless/command-compile";
import { matchesOnChatMessage } from "../../../../packages/cat-bot/src/engine/modules/codeless/onchat-match";
import {
  commandRegistry,
} from "../../../../packages/cat-bot/src/engine/lib/command-registry";
import { clearCooldowns } from "../../../../packages/cat-bot/src/engine/lib/pipeline";
import { routeMessage } from "../../../../packages/cat-bot/src/engine/handlers/message-router";
import {
  createCommand,
  deleteCommand,
  removeAllImported,
  removeAllManual,
  resetCommands,
  downloadManualPairs,
  buildManualDownloadZip,
  type CommandStore,
} from "../../../../packages/cat-bot/src/engine/modules/codeless/command-service";
import { scanRepositoryFiles } from "../../../../packages/cat-bot/src/engine/modules/codeless/repo-import";
import {
  detectEndpoint,
  classifyResponse,
  extractInputs,
} from "../../../../packages/cat-bot/src/engine/modules/codeless/fetch-detect";
import { canUseBotCommandTools } from "../../../../packages/cat-bot/src/engine/agent/bot-command-tools";

function baseConfig(overrides: Partial<CodelessCommandConfig> = {}): CodelessCommandConfig {
  return {
    name: "bible",
    description: "Fetch Bible passages.",
    category: "random",
    usage: "[passage]",
    cooldown: 3,
    handlers: ["onCommand"],
    responseMedia: "text",
    caption: "📜 **Scripture**",
    displayCommandName: false,
    lineSeparator: false,
    button: { enabled: false, label: "🔄 Action" },
    onChat: null,
    api: null,
    ...overrides,
  };
}

function memoryStore(): CommandStore & { rows: Map<string, { botId: string; name: string; source: { kind: "manual" } | { kind: "imported"; repositoryId: string }; mdText: string; enabled: boolean; updatedAt: string }>; repos: Map<string, { id: string; botId: string; url: string; lastSyncedAt: string }> } {
  const rows = new Map<string, { botId: string; name: string; source: { kind: "manual" } | { kind: "imported"; repositoryId: string }; mdText: string; enabled: boolean; updatedAt: string }>();
  const repos = new Map<string, { id: string; botId: string; url: string; lastSyncedAt: string }>();
  return {
    rows,
    repos,
    async listCommands(botId) {
      return [...rows.values()].filter((r) => r.botId === botId);
    },
    async upsertCommand(row) {
      rows.set(`${row.botId}:${row.name}`, { ...row });
    },
    async deleteCommand(botId, name) {
      rows.delete(`${botId}:${String(name).toLowerCase()}`);
    },
    async deleteBySource(botId, source) {
      for (const [key, row] of rows) {
        if (row.botId === botId && row.source.kind === source) rows.delete(key);
      }
    },
    async deleteImportedFromRepo(botId, repositoryId) {
      for (const [key, row] of rows) {
        if (row.botId === botId && row.source.kind === "imported" && row.source.repositoryId === repositoryId) {
          rows.delete(key);
        }
      }
    },
    async setCommandEnabled(botId, name, enabled) {
      const row = rows.get(`${botId}:${String(name).toLowerCase()}`);
      if (row) row.enabled = enabled;
    },
    async listRepositories(botId) {
      return [...repos.values()].filter((r) => r.botId === botId);
    },
    async upsertRepository(row) {
      repos.set(row.id, { ...row });
    },
    async deleteRepository(_botId, repositoryId) {
      repos.delete(repositoryId);
    },
    async clearRepositories(botId) {
      for (const [key, row] of repos) {
        if (row.botId === botId) repos.delete(key);
      }
    },
  };
}

beforeEach(() => {
  commandRegistry.clear();
  clearCooldowns();
});

describe("codeless meta contract", () => {
  it("emits only the narrowed meta subset with hardcoded author", () => {
    const config = normalizeCodelessConfig(baseConfig());
    const src = compileNormalizedCommandModule(config);
    expect(src).toContain(`author: ${JSON.stringify(CODELESS_AUTHOR)}`);
    for (const banned of ["version", "role", "aliases", "platform", "hasPrefix"]) {
      expect(src).not.toMatch(new RegExp(`\\b${banned}\\b\\s*:`));
    }
    expect(src).toContain("cooldown: 3");
  });
});

describe("compiler shapes", () => {
  it("plain command behaves like example_command.ts", () => {
    const src = compileNormalizedCommandModule(normalizeCodelessConfig(baseConfig()));
    expect(src).toContain("export const onCommand");
    expect(src).toContain("chat.replyMessage");
    expect(src).toContain("MessageStyle.MARKDOWN");
    expect(src).toContain("📜 **Scripture**");
  });

  it("API command behaves like bible.ts (fetch, extract path, error handling)", () => {
    const src = compileNormalizedCommandModule(
      normalizeCodelessConfig(
        baseConfig({
          handlers: ["onCommand"],
          api: {
            endpoint: "https://bible-api.com/${text}?translation=${version}",
            method: "GET",
            inputs: [{ name: "text" }, { name: "version" }],
            headers: {},
            params: {},
            body: "",
            responsePath: "text",
            responseType: "Text",
            apiKeySendAs: null,
            requiresApiKey: false,
          },
        }),
      ),
    );
    expect(src).toContain("API_ENDPOINT");
    expect(src).toContain("runApiFetch");
    expect(src).toContain("formatApiError");
    expect(src).toContain("⚠️ **Error:**");
  });

  it("button command follows the button.generateID map pattern", () => {
    const src = compileNormalizedCommandModule(
      normalizeCodelessConfig(baseConfig({ handlers: ["onCommand", "onButton"], button: { enabled: true, label: "🔄 Switch" } })),
    );
    expect(src).toContain("export const button");
    expect(src).toContain("btn.generateID");
    expect(src).toContain("ButtonStyle.SECONDARY");
  });

  it("onReply registers a single-step state", () => {
    const src = compileNormalizedCommandModule(
      normalizeCodelessConfig(baseConfig({ handlers: ["onCommand", "onReply"] })),
    );
    expect(src).toContain("export const onReply");
    expect(src).toContain("awaiting_reply");
    expect(src).toContain("state.create");
    expect(src).not.toContain("awaiting_age");
  });

  it("onChat triggers on content match with the same styled output", () => {
    const config = normalizeCodelessConfig(
      baseConfig({
        handlers: ["onChat"],
        caption: "hi there",
        onChat: { detectionMode: "contains", keyword: "hello", caseSensitive: false },
      }),
    );
    const src = compileNormalizedCommandModule(config);
    expect(src).toContain("export const onChat");
    expect(src).toContain("matchesOnChat");
    expect(src).toContain("hi there");
    expect(validateCodelessConfig(config)).toEqual([]);
  });

  it("Display Command Name and Line Separator are independent, off by default", () => {
    const def = normalizeCodelessConfig(baseConfig());
    expect(def.displayCommandName).toBe(false);
    expect(def.lineSeparator).toBe(false);
    const plain = compileNormalizedCommandModule(def);
    expect(plain).not.toContain("────────────");

    const titleOnly = compileNormalizedCommandModule(normalizeCodelessConfig(baseConfig({ displayCommandName: true })));
    expect(titleOnly).toContain("**/bible**");
    expect(titleOnly).not.toContain("────────────");

    const sepOnly = compileNormalizedCommandModule(normalizeCodelessConfig(baseConfig({ lineSeparator: true })));
    expect(sepOnly).toContain("────────────");
    expect(sepOnly).not.toContain("**/bible**");

    const both = compileNormalizedCommandModule(
      normalizeCodelessConfig(baseConfig({ displayCommandName: true, lineSeparator: true })),
    );
    expect(both).toContain("**/bible**");
    expect(both).toContain("────────────");
  });
});

describe("MD interchange", () => {
  it("round-trips config, including onChat and API sections", () => {
    const config = normalizeCodelessConfig(
      baseConfig({
        handlers: ["onCommand", "onChat", "onButton"],
        displayCommandName: true,
        lineSeparator: true,
        button: { enabled: true, label: "Go" },
        onChat: { detectionMode: "startsWith", keyword: "!hi", caseSensitive: true },
        api: {
          endpoint: "https://x.test/${q}",
          method: "GET",
          inputs: [{ name: "q" }],
          headers: { Authorization: "Bearer ${API_KEY}" },
          params: { lang: "en" },
          body: "",
          responsePath: "data.text",
          responseType: "JSON",
          apiKeySendAs: { kind: "header", name: "Authorization" },
          requiresApiKey: true,
        },
      }),
    );
    const md = serializeCommandMarkdown(config);
    const back = parseCommandMarkdown(md);
    expect(back.name).toBe("bible");
    expect(back.onChat?.keyword).toBe("!hi");
    expect(back.displayCommandName).toBe(true);
    expect(back.lineSeparator).toBe(true);
    expect(back.api?.responsePath).toBe("data.text");
    expect(back.api?.apiKeySendAs).toEqual({ kind: "header", name: "Authorization" });
    // Secrets never travel: the raw key value must not appear.
    expect(md).not.toContain("sk-");
  });
});

describe("onChat matcher", () => {
  it("supports all detection modes", () => {
    expect(matchesOnChatMessage("Hello", { detectionMode: "exact", keyword: "hello", caseSensitive: false })).toBe(true);
    expect(matchesOnChatMessage("say hello now", { detectionMode: "contains", keyword: "hello", caseSensitive: false })).toBe(true);
    expect(matchesOnChatMessage("hello world", { detectionMode: "startsWith", keyword: "hello", caseSensitive: false })).toBe(true);
    expect(matchesOnChatMessage("order 123", { detectionMode: "regex", keyword: "^order \\d+$", caseSensitive: false })).toBe(true);
    expect(matchesOnChatMessage("Hello", { detectionMode: "exact", keyword: "hello", caseSensitive: true })).toBe(false);
    expect(matchesOnChatMessage("bye", { detectionMode: "contains", keyword: "hello", caseSensitive: false })).toBe(false);
  });
});

describe("narrowed pipeline (cooldown is the only gate)", () => {
  function seed(name = "bible", cooldown = 60) {
    commandRegistry.register({
      meta: { name, cooldown },
      onCommand: () => {},
      config: normalizeCodelessConfig(baseConfig({ name, cooldown })),
    });
  }

  it("runs onCommand then suppresses repeat within cooldown (single notice semantics)", async () => {
    seed();
    let runs = 0;
    const deps = {
      senderId: "u1",
      resolveCommand: (n: string) => commandRegistry.get(n),
      runHandler: async () => {
        runs += 1;
      },
    };
    const first = await routeMessage({ text: "bible John 3:16", senderId: "u1", mode: "bot", deps });
    expect(first.kind).toBe("command");
    expect(runs).toBe(1);
    const second = await routeMessage({ text: "bible John 3:16", senderId: "u1", mode: "bot", deps });
    expect(second).toEqual({ kind: "silent", reason: "cooldown-notice-suppressed" });
    expect(runs).toBe(1);
  });

  it("onChat matches by content with the same cooldown gate", async () => {
    commandRegistry.register({
      meta: { name: "greeter", cooldown: 60 },
      onChat: () => {},
      matchesOnChat: (message: string) => matchesOnChatMessage(message, { detectionMode: "contains", keyword: "hello", caseSensitive: false }),
      config: normalizeCodelessConfig(baseConfig({ name: "greeter", handlers: ["onChat"], onChat: { detectionMode: "contains", keyword: "hello", caseSensitive: false } })),
    });
    let runs = 0;
    const outcome = await routeMessage({
      text: "well hello there",
      senderId: "u9",
      mode: "bot",
      deps: {
        senderId: "u9",
        resolveCommand: (n: string) => commandRegistry.get(n),
        runHandler: async () => {
          runs += 1;
        },
      },
    });
    expect(outcome).toEqual({ kind: "onchat", command: "greeter" });
    expect(runs).toBe(1);
  });

  it("Bot Mode stays silent on unmatched; Agent Mode routes to the agent", async () => {
    const resolveCommand = () => undefined;
    let agentCalls = 0;
    const silent = await routeMessage({
      text: "just chatting",
      senderId: "u1",
      mode: "bot",
      deps: { senderId: "u1", resolveCommand, onAgentReply: async () => {
        agentCalls += 1;
      } },
    });
    expect(silent).toEqual({ kind: "silent", reason: "bot-mode" });
    const agent = await routeMessage({
      text: "just chatting",
      senderId: "u1",
      mode: "agent",
      deps: { senderId: "u1", resolveCommand, onAgentReply: async () => {
        agentCalls += 1;
      } },
    });
    expect(agent).toEqual({ kind: "agent", reason: "unmatched" });
    expect(agentCalls).toBe(1);
  });

  it("pending onReply states resolve before command matching", async () => {
    commandRegistry.register({
      meta: { name: "ask", cooldown: 0 },
      onCommand: () => {},
      onReply: { awaiting_reply: () => {} },
      config: normalizeCodelessConfig(baseConfig({ name: "ask", handlers: ["onCommand", "onReply"] })),
    });
    let lane: string | undefined;
    const outcome = await routeMessage({
      text: "my answer",
      senderId: "u1",
      mode: "bot",
      replyToMessageId: "msg-1",
      deps: {
        senderId: "u1",
        resolveCommand: (n: string) => commandRegistry.get(n),
        pendingReplies: { findByMessageId: () => ({ command: "ask", stateKey: "awaiting_reply" }) },
        runHandler: async (_mod, l) => {
          lane = l;
        },
      },
    });
    expect(outcome.kind).toBe("reply-state");
    expect(lane).toBe("onReply");
  });
});

describe("repository import + service scoping", () => {
  const mdFor = (name: string): string =>
    serializeCommandMarkdown(normalizeCodelessConfig(baseConfig({ name, caption: `hi from ${name}` })));

  it("imports every .md and compiles each to the real module format", async () => {
    const store = memoryStore();
    const { imported, skipped } = scanRepositoryFiles([
      { path: "one.md", content: mdFor("one") },
      { path: "two.md", content: mdFor("two") },
      { path: "notes.txt", content: "ignore me" },
      { path: "bad.md", content: "# command: Bad Name With Spaces !!" },
    ]);
    expect(imported).toHaveLength(2);
    expect(skipped).toHaveLength(1);
    for (const item of imported) {
      expect(item.moduleSource).toContain("export const onCommand");
      expect(item.moduleSource).not.toMatch(/\bhasPrefix\b\s*:/);
      await createCommand(store, "default", item.config, { kind: "imported", repositoryId: "r1" });
    }
    expect((await store.listCommands("default")).filter((r) => r.source.kind === "imported")).toHaveLength(2);
  });

  it("delete removes one command; scoped bulk actions behave exactly", async () => {
    const store = memoryStore();
    await createCommand(store, "b", baseConfig({ name: "m1" }), { kind: "manual" });
    await createCommand(store, "b", baseConfig({ name: "m2" }), { kind: "manual" });
    await createCommand(store, "b", baseConfig({ name: "i1" }), { kind: "imported", repositoryId: "r" });
    await deleteCommand(store, "b", "m1");
    expect((await store.listCommands("b")).map((r) => r.name).sort()).toEqual(["i1", "m2"]);
    await removeAllImported(store, "b");
    expect((await store.listCommands("b")).map((r) => r.name)).toEqual(["m2"]);
    await createCommand(store, "b", baseConfig({ name: "i2" }), { kind: "imported", repositoryId: "r" });
    await removeAllManual(store, "b");
    expect((await store.listCommands("b")).map((r) => r.name)).toEqual(["i2"]);
    await resetCommands(store, "b");
    expect(await store.listCommands("b")).toEqual([]);
  });

  it("download pairs .ts + .md per manual command; md matches the import schema", async () => {
    const store = memoryStore();
    await createCommand(store, "b", baseConfig({ name: "alpha", caption: "A" }), { kind: "manual" });
    await createCommand(store, "b", baseConfig({ name: "beta", caption: "B" }), { kind: "imported", repositoryId: "r" });
    const pairs = await downloadManualPairs(store, "b");
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.name).toBe("alpha");
    expect(pairs[0]?.ts).toContain("export const onCommand");
    // The paired .md re-parses through the same scanner path.
    const back = parseCommandMarkdown(pairs[0]?.md ?? "");
    expect(back.name).toBe("alpha");
    const zip = buildManualDownloadZip(pairs);
    expect(zip[0]).toBe(0x50);
    expect(zip[1]).toBe(0x4b);
    expect(zip.length).toBeGreaterThan(100);
  });
});

describe("fetch auto-detection", () => {
  const stubFetch = (handler: (url: string, init?: RequestInit) => { status: number; contentType: string; body: string }) =>
    (async (url: unknown, init?: RequestInit) => {
      const out = handler(String(url), init);
      return {
        status: out.status,
        headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? out.contentType : null) },
        text: async () => out.body,
      };
    }) as unknown as typeof fetch;

  it("extracts ${variable} inputs from endpoint and body", () => {
    expect(extractInputs("https://bible-api.com/${text}?translation=${version}", '{"q":"${text}"}')).toEqual([
      "text",
      "version",
    ]);
  });

  it("detects the bible endpoint shape (JSON + first string path)", async () => {
    const fetcher = stubFetch(() => ({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ reference: "John 3:16", text: "For God so loved…" }),
    }));
    const result = await detectEndpoint({ endpoint: "https://bible-api.com/${text}?translation=${version}" }, fetcher);
    expect(result.method).toBe("GET");
    expect(result.inputs).toEqual(["text", "version"]);
    expect(result.responseType).toBe("JSON");
    expect(result.responsePath).toBe("reference");
    expect(result.requiresApiKey).toBe(false);
    expect(result.apiKeySendAs).toBeNull();
    expect(result.params).toEqual({ translation: "${version}" });
  });

  it("retries POST on 405 and surfaces API Key + Send As only on 401/403", async () => {
    const fetcher = stubFetch((url, init) => {
      if (init?.method === "GET") return { status: 405, contentType: "text/plain", body: "Method Not Allowed" };
      return { status: 200, contentType: "text/plain", body: "ok" };
    });
    const post = await detectEndpoint({ endpoint: "https://api.test/submit" }, fetcher);
    expect(post.method).toBe("POST");

    const authed = stubFetch(() => ({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "Missing api key" }),
    }));
    const needsKey = await detectEndpoint({ endpoint: "https://api.test/private" }, authed);
    expect(needsKey.requiresApiKey).toBe(true);
    expect(needsKey.apiKeySendAs).not.toBeNull();
  });

  it("classifies text / image-url / binary responses", () => {
    expect(classifyResponse("text/plain", "hello", "hello").responseType).toBe("Text");
    expect(classifyResponse("image/png", "", "").responseType).toBe("Image URL");
    expect(classifyResponse("application/json", { image: "https://x.test/a.png" }, "").responseType).toBe("Image URL");
    expect(classifyResponse("application/octet-stream", "", "").responseType).toBe("Buffer");
  });
});

describe("agent tool guard", () => {
  const guard = {
    isSystemAdmin: (id: string) => id === "root",
    isBotOwner: (id: string, bot: string) => id === "owner" && bot === "b1",
    getBotMode: async (_bot: string) => "agent" as const,
  };
  it("grants system admins everywhere; owners only on their own bot in Agent Mode", async () => {
    expect(await canUseBotCommandTools(guard, "root", "other")).toBe(true);
    expect(await canUseBotCommandTools(guard, "owner", "b1")).toBe(true);
    expect(await canUseBotCommandTools(guard, "owner", "b2")).toBe(false);
    expect(await canUseBotCommandTools({ ...guard, getBotMode: async () => "bot" as const }, "owner", "b1")).toBe(false);
  });
});

describe("api key secrecy", () => {
  it("never writes raw values into portable artifacts", () => {
    const config: NormalizedCodelessConfig = normalizeCodelessConfig(
      baseConfig({
        api: {
          endpoint: "https://api.test/data",
          method: "GET",
          inputs: [],
          headers: { Authorization: "Bearer ${API_KEY}" },
          params: {},
          body: "",
          responsePath: "",
          responseType: "Text",
          apiKeySendAs: { kind: "header", name: "Authorization" },
          requiresApiKey: true,
        },
      }),
    );
    const ts = compileNormalizedCommandModule(config);
    const md = serializeCommandMarkdown(config);
    expect(ts).toContain("${API_KEY}");
    expect(md).toContain("${API_KEY}");
    expect(ts).not.toContain("sk-live");
    expect(md).not.toContain("sk-live");
  });
});
