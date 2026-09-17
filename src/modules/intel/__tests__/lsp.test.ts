import { describe, expect, it } from "vitest";

import {
  createLineFraming,
  createLspClient,
  createLspServer,
  createMemoryTransportPair,
} from "@/modules/intel/lsp";
import { createRequestManager } from "@/modules/intel/cancellation";
import type { LanguageServiceAdapter } from "@/modules/intel/types";

function stubAdapter(): LanguageServiceAdapter {
  const requests = createRequestManager();
  const req = () => requests.createRequest(1);
  void req;
  return {
    languageIds: ["typescript"],
    initialize: () => Promise.resolve(),
    dispose: () => Promise.resolve(),
    openDocument: () => {},
    updateDocument: () => {},
    closeDocument: () => {},
    diagnostics: () => Promise.resolve([]),
    completion: () =>
      Promise.resolve({
        items: [
          {
            label: "length",
            kind: "property",
            detail: "(property) length: number",
            documentation: null,
            sortPriority: 11,
            filterText: null,
            insertText: "length",
            replaceRange: null,
            commitCharacters: [],
            additionalEdits: [],
            source: "semantic",
            deprecated: false,
            resolveId: "length@@0",
          },
        ],
        incomplete: false,
      }),
    resolveCompletion: (_uri, item) => Promise.resolve({ ...item, detail: "resolved" }),
    hover: () =>
      Promise.resolve({
        contents: ["```ts\nconst x: number\n```"],
        range: null,
      }),
    signatureHelp: () => Promise.resolve(null),
    definition: () =>
      Promise.resolve([
        { uri: "file:///a.ts", range: { start: { line: 1, column: 7 }, end: { line: 1, column: 8 } } },
      ]),
    declaration: () => Promise.resolve([]),
    typeDefinition: () => Promise.resolve([]),
    references: () => Promise.resolve([]),
    documentSymbols: () => Promise.resolve([]),
    workspaceSymbols: () => Promise.resolve([]),
    prepareRename: () =>
      Promise.resolve({
        range: { start: { line: 1, column: 7 }, end: { line: 1, column: 8 } },
        placeholder: "x",
      }),
    rename: () =>
      Promise.resolve({
        edit: {
          edits: [{ uri: "file:///a.ts", range: { start: { line: 1, column: 7 }, end: { line: 1, column: 8 } }, newText: "y" }],
          summary: "1 change in 1 file",
        },
        fileChangeCounts: [{ uri: "file:///a.ts", changes: 1 }],
      }),
    codeActions: () => Promise.resolve([]),
    formatting: () =>
      Promise.resolve([
        { uri: "file:///a.ts", range: { start: { line: 1, column: 9 }, end: { line: 1, column: 9 } }, newText: ";" },
      ]),
    rangeFormatting: () => Promise.resolve([]),
    organizeImports: () => Promise.resolve([]),
    semanticTokens: () => Promise.resolve([]),
    inlayHints: () => Promise.resolve([]),
    capabilities: () => ({ semantic: true, syntax: true, formatting: true, diagnostics: true, navigation: true }),
    status: () => ({ state: "ready" }),
  };
}

describe("LSP over memory transport", () => {
  it("initializes and serves completion/hover/definition/rename", async () => {
    const pair = createMemoryTransportPair();
    const server = createLspServer(pair.server, { adapter: stubAdapter(), getText: () => null });
    const client = createLspClient(pair.client);
    const init = (await client.request("initialize", {})) as { capabilities: object };
    expect(init.capabilities).toBeDefined();

    const completion = (await client.request("textDocument/completion", {
      textDocument: { uri: "file:///a.ts" },
      position: { line: 0, character: 5 },
    })) as { items: { label: string }[] };
    expect(completion.items.map((item) => item.label)).toContain("length");

    const hover = (await client.request("textDocument/hover", {
      textDocument: { uri: "file:///a.ts" },
      position: { line: 0, character: 5 },
    })) as { contents: { value: string } };
    expect(hover.contents.value).toContain("const x: number");

    const definitions = (await client.request("textDocument/definition", {
      textDocument: { uri: "file:///a.ts" },
      position: { line: 0, character: 5 },
    })) as { uri: string }[];
    expect(definitions[0]?.uri).toBe("file:///a.ts");

    const edit = (await client.request("textDocument/rename", {
      textDocument: { uri: "file:///a.ts" },
      position: { line: 0, character: 5 },
      newName: "y",
    })) as { changes: Record<string, unknown[]> };
    expect(Object.keys(edit.changes)).toEqual(["file:///a.ts"]);

    await expect(client.request("nope/unknown", {})).rejects.toThrow(/not found/i);
    client.dispose();
    server.dispose();
  });

  it("rejects requests before initialize", async () => {
    const pair = createMemoryTransportPair();
    const server = createLspServer(pair.server, { adapter: stubAdapter(), getText: () => null });
    const client = createLspClient(pair.client);
    await expect(
      client.request("textDocument/hover", { textDocument: { uri: "x" }, position: { line: 0, character: 0 } }),
    ).rejects.toThrow(/not initialized/i);
    client.dispose();
    server.dispose();
  });
});

describe("LSP document lifecycle", () => {
  it("tracks didOpen/didChange/didClose and publishes diagnostics", async () => {
    const pair = createMemoryTransportPair();
    const opened: string[] = [];
    const adapter = stubAdapter();
    const published: { uri: string; count: number }[] = [];
    const server = createLspServer(pair.server, {
      adapter: {
        ...adapter,
        openDocument: (uri) => {
          opened.push(uri);
        },
        diagnostics: () =>
          Promise.resolve([
            {
              severity: "error",
              message: "boom",
              source: "test",
              code: 1,
              range: { start: { line: 1, column: 1 }, end: { line: 1, column: 2 } },
              related: [],
              fixable: false,
            },
          ]),
      },
      getText: () => null,
      onPublishDiagnostics: (uri, diagnostics) => {
        published.push({ uri, count: diagnostics.length });
      },
    });
    const client = createLspClient(pair.client);
    await client.request("initialize", {});
    client.notify("textDocument/didOpen", {
      textDocument: { uri: "file:///a.ts", languageId: "typescript", version: 1, text: "const x = 1;" },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(opened).toEqual(["file:///a.ts"]);
    expect(published).toEqual([{ uri: "file:///a.ts", count: 1 }]);
    client.notify("textDocument/didChange", {
      textDocument: { uri: "file:///a.ts", version: 2 },
      contentChanges: [{ text: "const x = 2;" }],
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(published).toEqual([
      { uri: "file:///a.ts", count: 1 },
      { uri: "file:///a.ts", count: 1 },
    ]);
    const highlights = (await client.request("textDocument/documentHighlight", {
      textDocument: { uri: "file:///a.ts" },
      position: { line: 0, character: 5 },
    })) as unknown[];
    expect(Array.isArray(highlights)).toBe(true);
    client.dispose();
    server.dispose();
  });
});

describe("line framing", () => {
  it("frames and parses newline-delimited messages, skipping garbage", () => {
    const framing = createLineFraming();
    const seen: unknown[] = [];
    framing.onMessage((message) => seen.push(message));
    framing.pushChunk("garbage\n");
    framing.pushChunk(`${framing.frame({ jsonrpc: "2.0", method: "exit" }).slice(0, 10)}`);
    framing.pushChunk(`${framing.frame({ jsonrpc: "2.0", method: "exit" }).slice(10)}`);
    expect(seen).toHaveLength(1);
  });
});
