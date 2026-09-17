import { describe, expect, it } from "vitest";

import { createIntelEngine } from "@/modules/intel/index";
import { createRequestManager } from "@/modules/intel/cancellation";
import type {
  IntelCompletionItem,
  LanguageServiceAdapter,
} from "@/modules/intel/types";
import { emptyCompletionList } from "@/modules/intel/types";

function fakeAdapter(): LanguageServiceAdapter {
  const text = new Map<string, string>();
  const item = (label: string, source: IntelCompletionItem["source"]): IntelCompletionItem => ({
    label,
    kind: "property",
    detail: null,
    documentation: null,
    sortPriority: 5,
    filterText: null,
    insertText: label,
    replaceRange: null,
    commitCharacters: [],
    additionalEdits: [],
    source,
    deprecated: false,
    resolveId: null,
  });
  return {
    languageIds: ["typescript"],
    initialize: () => Promise.resolve(),
    dispose: () => Promise.resolve(),
    openDocument: (uri, _languageId, _version, content) => {
      text.set(uri, content);
    },
    updateDocument: (uri, _version, content) => {
      text.set(uri, content);
    },
    closeDocument: (uri) => {
      text.delete(uri);
    },
    diagnostics: () => Promise.resolve([]),
    completion: () => Promise.resolve({ items: [item("semanticOne", "semantic")], incomplete: false }),
    resolveCompletion: (_uri, completionItem) => Promise.resolve(completionItem),
    hover: () => Promise.resolve(null),
    signatureHelp: () => Promise.resolve(null),
    definition: () => Promise.resolve([]),
    declaration: () => Promise.resolve([]),
    typeDefinition: () => Promise.resolve([]),
    references: () => Promise.resolve([]),
    documentSymbols: () => Promise.resolve([]),
    workspaceSymbols: () => Promise.resolve([]),
    prepareRename: () => Promise.resolve(null),
    rename: () => Promise.resolve(null),
    codeActions: () => Promise.resolve([]),
    formatting: () => Promise.resolve([]),
    rangeFormatting: () => Promise.resolve([]),
    organizeImports: () => Promise.resolve([]),
    semanticTokens: () => Promise.resolve([]),
    inlayHints: () => Promise.resolve([]),
    capabilities: () => ({ semantic: true, syntax: true, formatting: true, diagnostics: true, navigation: true }),
    status: () => ({ state: "ready" }),
  };
}

describe("intel engine", () => {
  it("merges adapter completions and respects toggles", async () => {
    const engine = createIntelEngine({ adapters: [fakeAdapter()], getText: () => "" });
    const context = { inString: false, stringPrefix: "", wordPrefix: "", invoked: true, triggerCharacter: null };
    const first = await engine.completion("f.ts", "typescript", { line: 1, column: 1 }, context, 1);
    expect(first.items.map((entry) => entry.label)).toContain("semanticOne");
    engine.updateSettings({ ...engine.settings, semanticCompletionEnabled: false });
    const second = await engine.completion("f.ts", "typescript", { line: 1, column: 1 }, context, 1);
    expect(second.items.map((entry) => entry.label)).not.toContain("semanticOne");
  });

  it("returns empty when completion is disabled or no adapter matches", async () => {
    const engine = createIntelEngine({ adapters: [fakeAdapter()], getText: () => "" });
    const context = { inString: false, stringPrefix: "", wordPrefix: "", invoked: true, triggerCharacter: null };
    expect(await engine.completion("f.py", "python", { line: 1, column: 1 }, context, 1)).toEqual(
      emptyCompletionList(),
    );
    engine.updateSettings({ ...engine.settings, completionEnabled: false });
    expect(await engine.completion("f.ts", "typescript", { line: 1, column: 1 }, context, 1)).toEqual(
      emptyCompletionList(),
    );
  });

  it("survives a failing adapter (syntax fallback path)", async () => {
    const failing = fakeAdapter();
    failing.completion = () => Promise.reject(new Error("boom"));
    const engine = createIntelEngine({ adapters: [failing], getText: () => "" });
    const context = { inString: false, stringPrefix: "", wordPrefix: "", invoked: true, triggerCharacter: null };
    const result = await engine.completion("f.ts", "typescript", { line: 1, column: 1 }, context, 1);
    expect(result.items).toEqual([]);
    expect(engine.perf.snapshot().counters["completion.semantic-failure"]).toBe(1);
  });

  it("merges diagnostics across adapter and plugins", async () => {
    const engine = createIntelEngine({ adapters: [fakeAdapter()], getText: () => "x" });
    engine.plugins.registerDiagnostics({
      id: "extra",
      languageIds: "all",
      provide: () =>
        Promise.resolve([
          {
            severity: "warning",
            message: "plugin note",
            source: "plugin",
            code: null,
            range: { start: { line: 1, column: 1 }, end: { line: 1, column: 2 } },
            related: [],
            fixable: false,
          },
        ]),
    });
    const diagnostics = await engine.diagnostics("f.ts", "typescript", 1);
    expect(diagnostics.map((entry) => entry.source)).toEqual(["plugin"]);
  });

  it("exposes adapter lookup", () => {
    const engine = createIntelEngine({ adapters: [fakeAdapter()], getText: () => "" });
    expect(engine.adapterFor("typescript")).not.toBeNull();
    expect(engine.adapterFor("rust")).toBeNull();
    expect(createRequestManager).toBeDefined();
  });
});
