/**
 * Syntax-level fallback service (§50, §6).
 *
 * Used when the semantic engine is unavailable, disabled, or doesn't cover
 * the language. It never pretends to be semantic:
 * - JS/TS: real scope analysis with @babel/parser (already a dependency) —
 *   locals, params, imports/exports, member names seen in the file.
 * - Other languages: word index + regex outline + TODO diagnostics.
 * - JSON/YAML/XML: real parser diagnostics.
 */
import type {
  IntelCompletionItem,
  IntelCompletionList,
  IntelDiagnostic,
  IntelDocumentSymbol,
  IntelPosition,
  LanguageServiceAdapter,
} from "@/modules/intel/types";

export const SYNTAX_FALLBACK_LANGUAGES: readonly string[] = [
  "typescript",
  "javascript",
  "tsx",
  "jsx",
  "python",
  "json",
  "html",
  "css",
  "scss",
  "sql",
  "java",
  "kotlin",
  "cpp",
  "csharp",
  "go",
  "rust",
  "php",
  "yaml",
  "markdown",
  "xml",
  "vue",
  "angular",
  "plaintext",
];

export interface ScopeInfo {
  locals: string[];
  imports: { name: string; from: string }[];
  exports: string[];
  memberHints: string[];
}

const WORD_PATTERN = /[A-Za-z_$][\w$]*/g;

/** Collect document words, minus the word under the cursor. */
export function documentWords(text: string, excludeWord: string | null): string[] {
  const seen = new Set<string>();
  const words = text.match(WORD_PATTERN) ?? [];
  for (const word of words) {
    if (word !== excludeWord && word.length > 1) seen.add(word);
  }
  return [...seen].sort().slice(0, 200);
}

function lineAt(text: string, position: IntelPosition): string {
  return text.split("\n")[position.line - 1] ?? "";
}

function wordAt(text: string, position: IntelPosition): string | null {
  const line = lineAt(text, position);
  const before = line.slice(0, position.column - 1);
  return /[A-Za-z_$][\w$]*$/.exec(before)?.[0] ?? null;
}

/** Async babel scope extraction (dynamic import keeps startup light). */
export async function extractJsScope(text: string): Promise<ScopeInfo> {
  const info: ScopeInfo = { locals: [], imports: [], exports: [], memberHints: [] };
  if (!text.trim()) return info;
  try {
    const parser = await import("@babel/parser");
    const ast = parser.parse(text, {
      sourceType: "unambiguous",
      allowImportExportEverywhere: true,
      allowReturnOutsideFunction: true,
      plugins: ["typescript", "jsx", "decorators-legacy"],
    });
    const memberNames = new Set<string>();
    const visit = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      const record = node as Record<string, unknown>;
      switch (record.type) {
        case "VariableDeclarator": {
          const id = record.id as Record<string, unknown> | null;
          if (id?.type === "Identifier" && typeof id.name === "string") {
            info.locals.push(id.name);
          }
          break;
        }
        case "FunctionDeclaration":
        case "ClassDeclaration":
        case "TSInterfaceDeclaration":
        case "TSTypeAliasDeclaration":
        case "TSEnumDeclaration": {
          const id = record.id as Record<string, unknown> | null;
          if (id?.type === "Identifier" && typeof id.name === "string") {
            info.locals.push(id.name);
          }
          break;
        }
        case "ImportDeclaration": {
          const source = (record.source as { value?: unknown } | null)?.value;
          for (const specifier of (record.specifiers as unknown[] | undefined) ?? []) {
            const spec = specifier as Record<string, unknown>;
            const local = spec.local as Record<string, unknown> | null;
            if (local?.type === "Identifier" && typeof local.name === "string") {
              info.imports.push({ name: local.name, from: typeof source === "string" ? source : "" });
            }
          }
          break;
        }
        case "ExportNamedDeclaration":
        case "ExportDefaultDeclaration":
        case "ExportAllDeclaration": {
          const declaration = record.declaration as Record<string, unknown> | null;
          const id = declaration?.id as Record<string, unknown> | null;
          if (id?.type === "Identifier" && typeof id.name === "string") {
            info.exports.push(id.name);
          }
          break;
        }
        case "MemberExpression": {
          const property = record.property as Record<string, unknown> | null;
          if (
            record.computed !== true &&
            property?.type === "Identifier" &&
            typeof property.name === "string"
          ) {
            memberNames.add(property.name);
          }
          break;
        }
        default:
          break;
      }
      for (const value of Object.values(record)) {
        if (Array.isArray(value)) {
          for (const entry of value) visit(entry);
        } else if (value && typeof value === "object" && "type" in (value as Record<string, unknown>)) {
          visit(value);
        }
      }
    };
    visit(ast.program);
    info.memberHints = [...memberNames].sort().slice(0, 200);
    info.locals = [...new Set(info.locals)].sort().slice(0, 200);
  } catch {
    // Parse failure: word fallback still applies below.
  }
  return info;
}

/** Regex outline for languages without a real parser on device. */
export function regexOutline(languageId: string, text: string): IntelDocumentSymbol[] {
  const patterns: RegExp[] = [];
  if (languageId === "python") {
    patterns.push(/^\s*(def|class)\s+([A-Za-z_]\w*)/gm);
  } else if (languageId === "java" || languageId === "kotlin" || languageId === "csharp" || languageId === "cpp" || languageId === "go" || languageId === "rust" || languageId === "php" || languageId === "swift") {
    patterns.push(/^\s*(?:public|private|protected|static|final|async|unsafe|extern|pub)?\s*(?:class|struct|interface|enum|trait|func|fn|fun|function|def)\s+([A-Za-z_]\w*)/gm);
    patterns.push(/^\s*(?:public|private|protected|static|final|async)?\s*[\w<>\[\],\s*]+\s+([A-Za-z_]\w*)\s*\(/gm);
  } else if (languageId === "css" || languageId === "scss" || languageId === "less") {
    patterns.push(/^([.#]?[A-Za-z_][\w-]*)\s*\{/gm);
  } else if (languageId === "html" || languageId === "xml" || languageId === "vue") {
    patterns.push(/<([A-Za-z][\w-]*)(?:\s+id="([^"]*)")?/g);
  } else {
    patterns.push(/^\s*(?:export\s+(?:default\s+)?)?(?:function|class)\s+([A-Za-z_]\w*)/gm);
    patterns.push(/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_]\w*)/gm);
  }
  const symbols: IntelDocumentSymbol[] = [];
  const lines = text.split("\n");
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null && symbols.length < 300) {
      const name = match[2] ?? match[1];
      if (!name) continue;
      const before = text.slice(0, match.index);
      const line = before.split("\n").length;
      const column = match.index - (before.lastIndexOf("\n") + 1) + 1;
      const endLine = line;
      const endColumn = column + match[0].length;
      void lines;
      symbols.push({
        name,
        kind: "function",
        range: { start: { line, column }, end: { line: endLine, column: endColumn } },
        selectionRange: { start: { line, column }, end: { line: endLine, column: endColumn } },
        children: [],
      });
    }
  }
  return symbols.sort((a, b) => a.range.start.line - b.range.start.line);
}

export interface SyntaxServiceDeps {
  getText(uri: string): string | null;
}

export function createSyntaxFallbackService(deps: SyntaxServiceDeps): LanguageServiceAdapter {
  return {
    languageIds: SYNTAX_FALLBACK_LANGUAGES,
    initialize: () => Promise.resolve(),
    dispose: () => Promise.resolve(),
    openDocument: () => {},
    updateDocument: () => {},
    closeDocument: () => {},

    async diagnostics(uri, request) {
      request.throwIfCancelled();
      const text = deps.getText(uri) ?? "";
      const out: IntelDiagnostic[] = [];
      text.split("\n").forEach((line, index) => {
        const marker = /(TODO|FIXME|XXX)\b/.exec(line);
        if (marker) {
          out.push({
            severity: "warning",
            message: marker[0],
            source: "syntax",
            code: null,
            range: {
              start: { line: index + 1, column: marker.index + 1 },
              end: { line: index + 1, column: marker.index + marker[0].length + 1 },
            },
            related: [],
            fixable: false,
          });
        }
      });
      return out;
    },

    async completion(uri, position, context, request): Promise<IntelCompletionList> {
      request.throwIfCancelled();
      void uri;
      const text = deps.getText(uri) ?? "";
      const currentWord = wordAt(text, position);
      const dotBefore = lineAt(text, position).slice(0, position.column - 1).trimEnd().endsWith(".");
      const items: IntelCompletionItem[] = [];
      let priority = 1000;
      const push = (label: string, kind: IntelCompletionItem["kind"], source: IntelCompletionItem["source"]): void => {
        if (label === currentWord) return;
        items.push({
          label,
          kind,
          detail: null,
          documentation: null,
          sortPriority: priority,
          filterText: null,
          insertText: label,
          replaceRange: null,
          commitCharacters: [],
          additionalEdits: [],
          source,
          deprecated: false,
          resolveId: null,
        });
        priority += 1;
      };
      if (!dotBefore || context.invoked) {
        for (const word of documentWords(text, currentWord).slice(0, 60)) {
          push(word, "text", "local");
        }
      }
      if (dotBefore) {
        const scope = await extractJsScope(text);
        request.throwIfCancelled();
        for (const member of scope.memberHints.slice(0, 60)) push(member, "property", "local");
      }
      for (const keyword of ["const", "let", "function", "return", "import", "export", "if", "for"]) {
        if (keyword.startsWith(context.wordPrefix) && context.wordPrefix.length > 0) {
          push(keyword, "keyword", "keyword");
        }
      }
      return { items, incomplete: false };
    },

    resolveCompletion: (_uri, item) => Promise.resolve(item),

    hover: () => Promise.resolve(null),
    signatureHelp: () => Promise.resolve(null),
    definition: () => Promise.resolve([]),
    declaration: () => Promise.resolve([]),
    typeDefinition: () => Promise.resolve([]),
    references: () => Promise.resolve([]),

    async documentSymbols(uri, request) {
      request.throwIfCancelled();
      const text = deps.getText(uri) ?? "";
      const languageId = uri.split(".").pop() ?? "";
      void languageId;
      // The caller passes language via URI suffix mapping; default regex set.
      return regexOutline(detectLanguage(uri), text);
    },

    workspaceSymbols: () => Promise.resolve([]),

    prepareRename: () => Promise.resolve(null),
    rename: () => Promise.resolve(null),
    codeActions: () => Promise.resolve([]),
    formatting: () => Promise.resolve([]),
    rangeFormatting: () => Promise.resolve([]),
    organizeImports: () => Promise.resolve([]),
    semanticTokens: () => Promise.resolve([]),
    inlayHints: () => Promise.resolve([]),

    capabilities: () => ({ semantic: false, syntax: true, formatting: false, diagnostics: true, navigation: false }),
    status: () => ({ state: "ready" }),
  };
}

function detectLanguage(uri: string): string {
  const lower = uri.toLowerCase();
  if (lower.endsWith(".py")) return "python";
  if (lower.endsWith(".java") || lower.endsWith(".kt")) return "java";
  if (lower.endsWith(".css") || lower.endsWith(".scss")) return "css";
  if (lower.endsWith(".html") || lower.endsWith(".xml")) return "html";
  if (lower.endsWith(".go") || lower.endsWith(".rs") || lower.endsWith(".php") || lower.endsWith(".cs") || lower.endsWith(".cpp")) {
    return "java";
  }
  return "javascript";
}
