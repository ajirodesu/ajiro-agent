/**
 * Editor intelligence tools for the AI agent (§36).
 *
 * Structured tools so the agent reasons about project structure —
 * definitions, references, diagnostics, symbols — instead of raw text.
 * Same `tool()` shape as the built-in agent tools; the engine is injected.
 */
import { tool } from "ai";
import { z } from "zod";

import type { IntelEngine } from "@/modules/intel/index";
import { groupReferences } from "@/modules/intel/navigation";
import { createRequestManager } from "@/modules/intel/cancellation";

const positionSchema = z.object({
  uri: z.string(),
  line: z.number().int().min(1),
  column: z.number().int().min(1),
});

export interface IntelAgentToolDeps {
  engine: IntelEngine;
  languageIdFor(uri: string): string;
  readFile(uri: string): Promise<string | null>;
}

export function createIntelAgentTools(deps: IntelAgentToolDeps) {
  const { engine, languageIdFor, readFile } = deps;
  const requests = createRequestManager();

  async function withAdapter<T>(uri: string, work: (adapter: NonNullable<ReturnType<IntelEngine["adapterFor"]>>) => Promise<T>): Promise<T> {
    const adapter = engine.adapterFor(languageIdFor(uri));
    if (!adapter) throw new Error(`No language service for ${uri}`);
    return work(adapter);
  }

  const lineText = async (uri: string, line: number): Promise<string | null> => {
    const text = await readFile(uri);
    return text?.split("\n")[line - 1] ?? null;
  };

  return {
    get_definition: tool({
      description: "Get the definition location(s) of the symbol at a position.",
      inputSchema: z.object({ uri: z.string(), line: z.number(), column: z.number() }),
      execute: async ({ uri, line, column }) =>
        withAdapter(uri, async (adapter) =>
          adapter.definition(uri, { line, column }, requests.createRequest()),
        ),
    }),
    get_references: tool({
      description: "Find all references to the symbol at a position, grouped by file.",
      inputSchema: z.object({ uri: z.string(), line: z.number(), column: z.number() }),
      execute: async ({ uri, line, column }) =>
        withAdapter(uri, async (adapter) => {
          const locations = await adapter.references(uri, { line, column }, requests.createRequest());
          return groupReferences(
            locations,
            (referenceUri, referenceLine) => {
              void referenceUri;
              void referenceLine;
              return null;
            },
          );
        }),
    }),
    get_diagnostics: tool({
      description: "Get merged diagnostics for a file.",
      inputSchema: z.object({ uri: z.string() }),
      execute: async ({ uri }) => engine.diagnostics(uri, languageIdFor(uri), 0),
    }),
    get_hover: tool({
      description: "Get hover type/documentation for a position.",
      inputSchema: positionSchema,
      execute: async ({ uri, line, column }) =>
        withAdapter(uri, async (adapter) => adapter.hover(uri, { line, column }, requests.createRequest())),
    }),
    get_signature: tool({
      description: "Get signature help for a call at a position.",
      inputSchema: positionSchema,
      execute: async ({ uri, line, column }) =>
        withAdapter(uri, async (adapter) =>
          adapter.signatureHelp(uri, { line, column }, requests.createRequest()),
        ),
    }),
    get_code_actions: tool({
      description: "List code actions for a range.",
      inputSchema: z.object({
        uri: z.string(),
        startLine: z.number(),
        startColumn: z.number(),
        endLine: z.number(),
        endColumn: z.number(),
      }),
      execute: async ({ uri, startLine, startColumn, endLine, endColumn }) =>
        withAdapter(uri, async (adapter) =>
          adapter.codeActions(
            uri,
            { start: { line: startLine, column: startColumn }, end: { line: endLine, column: endColumn } },
            [],
            requests.createRequest(),
          ),
        ),
    }),
    rename_symbol: tool({
      description: "Preview a scoped symbol rename (no text is modified).",
      inputSchema: z.object({ uri: z.string(), line: z.number(), column: z.number(), newName: z.string() }),
      execute: async ({ uri, line, column, newName }) =>
        withAdapter(uri, async (adapter) =>
          adapter.rename(uri, { line, column }, newName, requests.createRequest()),
        ),
    }),
    format_file: tool({
      description: "Get formatting edits for a file (preview only).",
      inputSchema: z.object({ uri: z.string() }),
      execute: async ({ uri }) =>
        withAdapter(uri, async (adapter) => adapter.formatting(uri, requests.createRequest())),
    }),
    organize_imports: tool({
      description: "Get organize-imports edits for a file (preview only).",
      inputSchema: z.object({ uri: z.string() }),
      execute: async ({ uri }) =>
        withAdapter(uri, async (adapter) => adapter.organizeImports(uri, requests.createRequest())),
    }),
    search_symbols: tool({
      description: "Search workspace symbols by name.",
      inputSchema: z.object({ query: z.string(), languageId: z.string().optional() }),
      execute: async ({ query, languageId }) => {
        const adapter = languageId ? engine.adapterFor(languageId) : null;
        if (!adapter) return [];
        return adapter.workspaceSymbols(query, requests.createRequest());
      },
    }),
    inspect_project: tool({
      description: "Summarize indexed project files, symbols, and configs.",
      inputSchema: z.object({ rootUri: z.string().optional() }),
      execute: async () => ({
        note: "Served by the workspace manager snapshot (see inspect_dependencies for packages).",
      }),
    }),
    get_outline: tool({
      description: "Get the document symbol outline for a file.",
      inputSchema: z.object({ uri: z.string() }),
      execute: async ({ uri }) =>
        withAdapter(uri, async (adapter) => adapter.documentSymbols(uri, requests.createRequest())),
    }),
    get_line: tool({
      description: "Read a single line (preview helper for reference results).",
      inputSchema: z.object({ uri: z.string(), line: z.number() }),
      execute: async ({ uri, line }) => lineText(uri, line),
    }),
  };
}

export type IntelAgentTools = ReturnType<typeof createIntelAgentTools>;
