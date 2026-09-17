/**
 * First-class TypeScript/JavaScript semantic intelligence (§5).
 *
 * A real `LanguageServiceAdapter` over the TypeScript compiler's language
 * service: semantic completion (with auto-import edits), quickinfo hover,
 * signature help, definition/declaration/type-definition, references with
 * read/write info, scoped rename, quick fixes, refactor edits, formatting,
 * organize imports, navigation-tree symbols, workspace symbol search, and
 * encoded semantic classifications.
 *
 * The compiler runtime is injected (`typeof import("typescript")`): this
 * module has NO static `typescript` import, so the RN bundle never includes
 * the compiler. Node tests and the WebView intel bundle pass the real one.
 */
import type * as ts from "typescript";

import {
  createInMemoryTsHost,
  tsPathToUri,
  uriToTsPath,
  type TsHostFile,
  type TsModule,
} from "@/modules/intel/ts-host";
import type {
  IntelCapabilities,
  IntelCodeAction,
  IntelCompletionContext,
  IntelCompletionItem,
  IntelCompletionKind,
  IntelCompletionList,
  IntelDiagnostic,
  IntelDocumentSymbol,
  IntelHoverInfo,
  IntelInlayHint,
  IntelLocation,
  IntelPosition,
  IntelRange,
  IntelRenameResult,
  IntelRequest,
  IntelSemanticToken,
  IntelServiceStatus,
  IntelSignatureHelp,
  IntelSymbolInfo,
  IntelTextEdit,
} from "@/modules/intel/types";

export interface TypeScriptServiceDeps {
  ts: TsModule;
  libFiles: Map<string, string>;
  rootPath?: string;
  compilerOptions?: ts.CompilerOptions;
  tabSize?: number;
  insertSpaces?: boolean;
}

const FIXABLE_CODES = new Set([
  2304, // Cannot find name (add import)
  2305, // Module has no exported member
  2307, // Cannot find module
  2339, // Property does not exist (did you mean / declare)
  2551, // Property does not exist (did you mean)
  2552, // Cannot find name (did you mean)
  2571, // Object is of type 'unknown'
  6133, // Declared but never read (remove/fix)
  6192, // All imports are unused (remove)
  6196, // Unused label
  7016, // Could not find declaration (install types)
]);

function offsetOf(compiler: TsModule, file: ts.SourceFile, position: IntelPosition): number {
  try {
    return compiler.getPositionOfLineAndCharacter(file, position.line - 1, position.column - 1);
  } catch {
    return 0;
  }
}

function rangeOf(compiler: TsModule, file: ts.SourceFile, span: { start: number; length: number }): IntelRange {
  const start = compiler.getLineAndCharacterOfPosition(file, span.start);
  const end = compiler.getLineAndCharacterOfPosition(file, span.start + span.length);
  return {
    start: { line: start.line + 1, column: start.character + 1 },
    end: { line: end.line + 1, column: end.character + 1 },
  };
}

function flattenMessage(compiler: TsModule, message: string | ts.DiagnosticMessageChain | undefined): string {
  return compiler.flattenDiagnosticMessageText(message ?? "", "\n");
}

function completionKindFor(compiler: TsModule, kind: string): IntelCompletionKind {
  void compiler;
  switch (kind as ts.ScriptElementKind) {
    case compiler.ScriptElementKind.memberFunctionElement:
    case compiler.ScriptElementKind.memberGetAccessorElement:
    case compiler.ScriptElementKind.memberSetAccessorElement:
      return "method";
    case compiler.ScriptElementKind.functionElement:
    case compiler.ScriptElementKind.localFunctionElement:
      return "function";
    case compiler.ScriptElementKind.constructorImplementationElement:
      return "constructor";
    case compiler.ScriptElementKind.memberVariableElement:
      return "field";
    case compiler.ScriptElementKind.variableElement:
    case compiler.ScriptElementKind.localVariableElement:
    case compiler.ScriptElementKind.parameterElement:
    case compiler.ScriptElementKind.indexSignatureElement:
      return "variable";
    case compiler.ScriptElementKind.classElement:
      return "class";
    case compiler.ScriptElementKind.interfaceElement:
      return "interface";
    case compiler.ScriptElementKind.typeElement:
    case compiler.ScriptElementKind.typeParameterElement:
      return "type-parameter";
    case compiler.ScriptElementKind.enumElement:
      return "enum";
    case compiler.ScriptElementKind.enumMemberElement:
      return "enum-member";
    case compiler.ScriptElementKind.moduleElement:
    case compiler.ScriptElementKind.externalModuleName:
      return "module";
    case compiler.ScriptElementKind.keyword:
      return "keyword";
    case compiler.ScriptElementKind.constElement:
      return "constant";
    case compiler.ScriptElementKind.primitiveType:
      return "type-alias";
    case compiler.ScriptElementKind.alias:
      return "reference";
    case compiler.ScriptElementKind.directory:
      return "folder";
    case compiler.ScriptElementKind.scriptElement:
    case compiler.ScriptElementKind.string:
      return "file";
    case compiler.ScriptElementKind.label:
      return "text";
    case compiler.ScriptElementKind.callSignatureElement:
    case compiler.ScriptElementKind.constructSignatureElement:
      return "constructor";
    default:
      return "property";
  }
}

/**
 * Decode the TwentyTwenty classification packing, verified against the
 * compiler source (`getSemanticTokens` collector):
 * `(typeIdx + 1 << 8) + modifierSet`.
 */
const TOKEN_TYPE_LEGEND = [
  "class",
  "enum",
  "interface",
  "namespace",
  "typeParameter",
  "type",
  "parameter",
  "variable",
  "enumMember",
  "property",
  "function",
  "method",
] as const;

const TOKEN_MODIFIER_LEGEND = [
  "declaration",
  "static",
  "async",
  "readonly",
  "defaultLibrary",
  "local",
] as const;

function decode2020Classification(classification: number): {
  tokenType: string;
  tokenModifiers: string[];
} {
  const typeIdx = (classification >>> 8) - 1;
  const tokenType = TOKEN_TYPE_LEGEND[typeIdx] ?? "text";
  const tokenModifiers: string[] = [];
  const modifierSet = classification & 0xff;
  TOKEN_MODIFIER_LEGEND.forEach((modifier, bit) => {
    if (modifierSet & (1 << bit)) tokenModifiers.push(modifier);
  });
  return { tokenType, tokenModifiers };
}

export function createTypeScriptService(deps: TypeScriptServiceDeps) {
  const { ts } = deps;
  const rootPath = deps.rootPath ?? "/project";
  const files = new Map<string, TsHostFile>();
  const host = createInMemoryTsHost({
    ts,
    files,
    libFiles: deps.libFiles,
    rootPath,
    compilerOptions: deps.compilerOptions,
  });
  const service = ts.createLanguageService(host);
  const lastCompletionOffset = new Map<string, number>();
  let disposed = false;

  function sourceFileFor(path: string): ts.SourceFile | null {
    const program = service.getProgram();
    return program?.getSourceFile(path) ?? null;
  }

  function textSpanToEdits(
    uri: string,
    file: ts.SourceFile,
    changes: readonly { span: ts.TextSpan; newText: string }[],
  ): IntelTextEdit[] {
    return changes.map((change) => ({
      uri,
      range: rangeOf(ts, file, change.span),
      newText: change.newText,
    }));
  }

  function toLocations(
    entries: readonly { fileName: string; textSpan: ts.TextSpan }[],
  ): IntelLocation[] {
    const out: IntelLocation[] = [];
    for (const entry of entries) {
      const file = sourceFileFor(entry.fileName);
      if (!file) continue;
      out.push({
        uri: tsPathToUri(entry.fileName),
        range: rangeOf(ts, file, entry.textSpan),
      });
    }
    return out;
  }

  function fresh(request: IntelRequest): void {
    request.throwIfCancelled();
    if (disposed) throw new Error("TypeScript service disposed");
  }

  return {
    readonly: false as const,

    initialize(): Promise<void> {
      return Promise.resolve();
    },

    async dispose(): Promise<void> {
      disposed = true;
      service.dispose();
    },

    openDocument(uri: string, _languageId: string, version: number, text: string): void {
      const path = uriToTsPath(uri, rootPath);
      files.set(path, { version, text });
      host.bumpProjectVersion();
    },

    updateDocument(uri: string, version: number, text: string): void {
      const path = uriToTsPath(uri, rootPath);
      files.set(path, { version, text });
      host.bumpProjectVersion();
    },

    closeDocument(uri: string): void {
      const path = uriToTsPath(uri, rootPath);
      if (files.delete(path)) host.bumpProjectVersion();
    },

    /** Test/host seam: register a non-open project file snapshot. */
    setProjectFile(uri: string, version: number, text: string | null): void {
      const path = uriToTsPath(uri, rootPath);
      if (text === null) {
        if (files.delete(path)) host.bumpProjectVersion();
        return;
      }
      files.set(path, { version, text });
      host.bumpProjectVersion();
    },

    async diagnostics(uri: string, request: IntelRequest): Promise<IntelDiagnostic[]> {
      fresh(request);
      const path = uriToTsPath(uri, rootPath);
      const file = sourceFileFor(path);
      if (!file) return [];
      const syntactic = service.getSyntacticDiagnostics(path);
      request.throwIfCancelled();
      const semantic = service.getSemanticDiagnostics(path);
      const toIntel = (
        diagnostic: ts.Diagnostic,
        source: string,
      ): IntelDiagnostic | null => {
        if (!diagnostic.file || diagnostic.start === undefined || diagnostic.length === undefined) {
          return null;
        }
        const severity =
          diagnostic.category === ts.DiagnosticCategory.Error
            ? "error"
            : diagnostic.category === ts.DiagnosticCategory.Warning
              ? "warning"
              : diagnostic.category === ts.DiagnosticCategory.Message
                ? "info"
                : "hint";
        return {
          severity,
          message: `${flattenMessage(ts, diagnostic.messageText)}${diagnostic.code ? ` (TS${diagnostic.code})` : ""}`,
          source,
          code: diagnostic.code,
          range: rangeOf(ts, diagnostic.file, { start: diagnostic.start, length: diagnostic.length }),
          related: [],
          fixable: FIXABLE_CODES.has(diagnostic.code),
        };
      };
      const out: IntelDiagnostic[] = [];
      for (const diagnostic of syntactic) {
        const mapped = toIntel(diagnostic, "ts-syntax");
        if (mapped) out.push(mapped);
      }
      for (const diagnostic of semantic) {
        const mapped = toIntel(diagnostic, "ts-semantic");
        if (mapped) out.push(mapped);
      }
      return out;
    },

    async completion(
      uri: string,
      position: IntelPosition,
      _context: IntelCompletionContext,
      request: IntelRequest,
    ): Promise<IntelCompletionList> {
      fresh(request);
      const path = uriToTsPath(uri, rootPath);
      const file = sourceFileFor(path);
      if (!file) return { items: [], incomplete: false };
      const offset = offsetOf(ts, file, position);
      const completions = service.getCompletionsAtPosition(path, offset, {
        includeCompletionsForModuleExports: true,
        includeCompletionsWithInsertText: true,
        includeCompletionsWithClassMemberSnippets: true,
        includeCompletionsWithObjectLiteralMethodSnippets: true,
        includeAutomaticOptionalChainCompletions: true,
        useLabelDetailsInCompletionEntries: true,
      });
      if (!completions) return { items: [], incomplete: false };
      lastCompletionOffset.set(path, offset);
      const items: IntelCompletionItem[] = completions.entries.map((entry, index) => {
        const sortPriority = Number(entry.sortText);
        return {
          label: entry.name,
          kind: completionKindFor(ts, entry.kind),
          detail: null,
          documentation: null,
          sortPriority: Number.isFinite(sortPriority) ? sortPriority : 100 + index,
          filterText: entry.filterText ?? null,
          insertText: entry.insertText ?? entry.name,
          replaceRange: entry.replacementSpan
            ? {
                start: positionOf(file, entry.replacementSpan.start),
                end: positionOf(file, entry.replacementSpan.start + entry.replacementSpan.length),
              }
            : null,
          commitCharacters: entry.commitCharacters ?? [],
          additionalEdits: [],
          source: typeof entry.source === "string" ? "imported-symbol" : "semantic",
          deprecated: entry.kindModifiers?.includes("deprecated") ?? false,
          // Every entry is resolvable on demand (detail/docs/auto-import).
          resolveId: `${entry.name}@@${index}`,
        };
      });
      return { items, incomplete: completions.isIncomplete ?? false };
    },

    async resolveCompletion(
      uri: string,
      item: IntelCompletionItem,
      request: IntelRequest,
    ): Promise<IntelCompletionItem> {
      fresh(request);
      if (item.resolveId === null) return item;
      const path = uriToTsPath(uri, rootPath);
      const file = sourceFileFor(path);
      if (!file) return item;
      const separator = item.resolveId.lastIndexOf("@@");
      const name = separator >= 0 ? item.resolveId.slice(0, separator) : item.resolveId;
      // Re-locate the entry by name at the original completion offset.
      const at = lastCompletionOffset.get(path) ?? file.getFullText().length;
      const completions = service.getCompletionsAtPosition(path, at, {});
      const match = completions?.entries.find((entry) => entry.name === name);
      const details = service.getCompletionEntryDetails(
        path,
        at,
        name,
        {},
        match?.source,
        {},
        match?.data,
      );
      if (!details) return item;
      const detailText = details.displayParts.map((part) => part.text).join("");
      const documentation = (details.documentation ?? []).map((part) => part.text).join("");
      const additionalEdits: IntelTextEdit[] = [];
      for (const action of details.codeActions ?? []) {
        for (const change of action.changes) {
          const target = sourceFileFor(change.fileName);
          if (!target) continue;
          additionalEdits.push(
            ...textSpanToEdits(
              tsPathToUri(change.fileName),
              target,
              change.textChanges.map((textChange) => ({
                span: textChange.span,
                newText: textChange.newText,
              })),
            ),
          );
        }
      }
      return {
        ...item,
        detail: detailText || null,
        documentation: documentation || null,
        additionalEdits,
      };
    },

    async hover(uri: string, position: IntelPosition, request: IntelRequest): Promise<IntelHoverInfo | null> {
      fresh(request);
      const path = uriToTsPath(uri, rootPath);
      const file = sourceFileFor(path);
      if (!file) return null;
      const info = service.getQuickInfoAtPosition(path, offsetOf(ts, file, position));
      if (!info || !info.displayParts) return null;
      const signature = info.displayParts.map((part) => part.text).join("");
      const documentation = (info.documentation ?? []).map((part) => part.text).join("");
      const tags = (info.tags ?? [])
        .map((tag) => `@${tag.name} ${tag.text?.map((part) => part.text).join("") ?? ""}`.trim())
        .filter(Boolean);
      const contents = [`\`\`\`ts\n${signature}\n\`\`\``];
      if (documentation) contents.push(documentation);
      contents.push(...tags);
      return {
        contents,
        range: info.textSpan ? rangeOf(ts, file, info.textSpan) : null,
      };
    },

    async signatureHelp(
      uri: string,
      position: IntelPosition,
      request: IntelRequest,
    ): Promise<IntelSignatureHelp | null> {
      fresh(request);
      const path = uriToTsPath(uri, rootPath);
      const file = sourceFileFor(path);
      if (!file) return null;
      const help = service.getSignatureHelpItems(path, offsetOf(ts, file, position), {});
      if (!help || help.items.length === 0) return null;
      return {
        signatures: help.items.map((item) => ({
          label: item.prefixDisplayParts.map((part) => part.text).join("") +
            item.parameters.map((parameter) => parameter.displayParts.map((part) => part.text).join("")).join(item.separatorDisplayParts.map((part) => part.text).join("")) +
            item.suffixDisplayParts.map((part) => part.text).join(""),
          documentation: item.documentation.map((part) => part.text).join("") || null,
          parameters: item.parameters.map((parameter) => ({
            label: parameter.displayParts.map((part) => part.text).join(""),
            documentation: parameter.documentation.map((part) => part.text).join("") || null,
          })),
        })),
        activeSignature: help.selectedItemIndex,
        activeParameter: help.argumentIndex,
      };
    },

    async definition(uri: string, position: IntelPosition, request: IntelRequest): Promise<IntelLocation[]> {
      fresh(request);
      const path = uriToTsPath(uri, rootPath);
      const file = sourceFileFor(path);
      if (!file) return [];
      const result = service.getDefinitionAndBoundSpan(path, offsetOf(ts, file, position));
      if (!result) return [];
      return toLocations(result.definitions ?? []);
    },

    async declaration(uri: string, position: IntelPosition, request: IntelRequest): Promise<IntelLocation[]> {
      fresh(request);
      const path = uriToTsPath(uri, rootPath);
      const file = sourceFileFor(path);
      if (!file) return [];
      const result = service.getDefinitionAndBoundSpan(path, offsetOf(ts, file, position));
      if (!result) return [];
      // Prefer declaration files when the symbol has them; otherwise the
      // definition itself (documented, honest fallback).
      const definitions = result.definitions ?? [];
      const declarations = definitions.filter((definition) => definition.fileName.endsWith(".d.ts"));
      return toLocations(declarations.length > 0 ? declarations : definitions);
    },

    async typeDefinition(uri: string, position: IntelPosition, request: IntelRequest): Promise<IntelLocation[]> {
      fresh(request);
      const path = uriToTsPath(uri, rootPath);
      const file = sourceFileFor(path);
      if (!file) return [];
      return toLocations(service.getTypeDefinitionAtPosition(path, offsetOf(ts, file, position)) ?? []);
    },

    async references(uri: string, position: IntelPosition, request: IntelRequest): Promise<IntelLocation[]> {
      fresh(request);
      const path = uriToTsPath(uri, rootPath);
      const file = sourceFileFor(path);
      if (!file) return [];
      const symbols = service.findReferences(path, offsetOf(ts, file, position));
      if (!symbols) return [];
      const out: IntelLocation[] = [];
      for (const symbol of symbols) {
        for (const reference of symbol.references) {
          const target = sourceFileFor(reference.fileName);
          if (!target) continue;
          out.push({
            uri: tsPathToUri(reference.fileName),
            range: rangeOf(ts, target, reference.textSpan),
          });
        }
      }
      return out;
    },

    /** Read/write-aware reference detail (powers the references panel). */
    referenceDetail(
      uri: string,
      position: IntelPosition,
    ): { uri: string; range: IntelRange; isWrite: boolean; isDefinition: boolean }[] {
      const path = uriToTsPath(uri, rootPath);
      const file = sourceFileFor(path);
      if (!file) return [];
      const symbols = service.findReferences(path, offsetOf(ts, file, position));
      if (!symbols) return [];
      const out: { uri: string; range: IntelRange; isWrite: boolean; isDefinition: boolean }[] = [];
      for (const symbol of symbols) {
        for (const reference of symbol.references) {
          const target = sourceFileFor(reference.fileName);
          if (!target) continue;
          out.push({
            uri: tsPathToUri(reference.fileName),
            range: rangeOf(ts, target, reference.textSpan),
            isWrite: reference.isWriteAccess === true,
            isDefinition: reference.isDefinition === true,
          });
        }
      }
      return out;
    },

    async documentSymbols(uri: string, request: IntelRequest): Promise<IntelDocumentSymbol[]> {
      fresh(request);
      const path = uriToTsPath(uri, rootPath);
      const tree = service.getNavigationTree(path);
      const mapKind = (kind: string): IntelDocumentSymbol["kind"] => {
        switch (kind) {
          case "class":
            return "class";
          case "interface":
            return "interface";
          case "enum":
            return "enum";
          case "enum member":
            return "enum-member";
          case "method":
            return "method";
          case "property":
            return "property";
          case "function":
            return "function";
          case "var":
          case "let":
          case "const":
            return "variable";
          case "module":
            return "module";
          case "type":
            return "type-alias";
          case "getter":
          case "setter":
            return "property";
          case "constructor":
            return "constructor";
          default:
            return "variable";
        }
      };
      const visit = (node: ts.NavigationTree, file: ts.SourceFile): IntelDocumentSymbol => ({
        name: node.text,
        kind: mapKind(node.kind),
        range: node.spans.length > 0
          ? rangeOf(ts, file, { start: node.spans[0].start, length: node.spans[0].length })
          : rangeOf(ts, file, { start: 0, length: 0 }),
        selectionRange: node.nameSpan
          ? rangeOf(ts, file, { start: node.nameSpan.start, length: node.nameSpan.length })
          : rangeOf(ts, file, { start: 0, length: 0 }),
        children: (node.childItems ?? []).map((child) => visit(child, file)),
      });
      const file = sourceFileFor(path);
      if (!file) return [];
      const symbols = (tree.childItems ?? []).map((child) => visit(child, file));
      // Navigation trees omit imports; surface module specifiers so the
      // outline (and breadcrumbs) reflect real dependencies.
      const text = file.getFullText();
      const lines = text.split("\n");
      const seen = new Set<string>();
      lines.forEach((lineText, index) => {
        const importMatch = /^\s*import\s+(?:[^'"]*?\s+from\s+)?["']([^"']+)["']/.exec(lineText);
        const exportMatch = /^\s*export\s+[^'"]*\s+from\s+["']([^"']+)["']/.exec(lineText);
        const specifier = importMatch?.[1] ?? exportMatch?.[1];
        if (!specifier || seen.has(specifier) || symbols.length > 400) return;
        seen.add(specifier);
        const line = index + 1;
        symbols.push({
          name: specifier,
          kind: "module",
          range: { start: { line, column: 1 }, end: { line, column: lineText.length + 1 } },
          selectionRange: { start: { line, column: 1 }, end: { line, column: lineText.length + 1 } },
          children: [],
        });
      });
      return symbols;
    },

    async workspaceSymbols(query: string, request: IntelRequest): Promise<IntelSymbolInfo[]> {
      fresh(request);
      if (!query.trim()) return [];
      const matches = service.getNavigateToItems(query, 50) ?? [];
      const out: IntelSymbolInfo[] = [];
      for (const match of matches) {
        const file = sourceFileFor(match.fileName);
        if (!file) continue;
        out.push({
          name: match.name,
          kind: "variable",
          location: {
            uri: tsPathToUri(match.fileName),
            range: match.textSpan ? rangeOf(ts, file, match.textSpan) : rangeOf(ts, file, { start: 0, length: 0 }),
          },
          containerName: match.containerName ?? null,
        });
      }
      return out;
    },

    async prepareRename(
      uri: string,
      position: IntelPosition,
      request: IntelRequest,
    ): Promise<{ range: IntelRange; placeholder: string } | null> {
      fresh(request);
      const path = uriToTsPath(uri, rootPath);
      const file = sourceFileFor(path);
      if (!file) return null;
      const result = service.getDefinitionAndBoundSpan(path, offsetOf(ts, file, position));
      if (!result?.textSpan) return null;
      const range = rangeOf(ts, file, result.textSpan);
      const placeholder = file.getFullText().slice(result.textSpan.start, result.textSpan.start + result.textSpan.length);
      if (!/^[A-Za-z_$][\w$]*$/.test(placeholder)) return null;
      return { range, placeholder };
    },

    async rename(
      uri: string,
      position: IntelPosition,
      newName: string,
      request: IntelRequest,
    ): Promise<IntelRenameResult | null> {
      fresh(request);
      if (!/^[A-Za-z_$][\w$]*$/.test(newName)) {
        throw new Error(`"${newName}" is not a valid identifier`);
      }
      const path = uriToTsPath(uri, rootPath);
      const file = sourceFileFor(path);
      if (!file) return null;
      const locations = service.findRenameLocations(path, offsetOf(ts, file, position), false, false, false);
      if (!locations || locations.length === 0) return null;
      const edits: IntelTextEdit[] = [];
      const counts = new Map<string, number>();
      for (const location of locations) {
        const target = sourceFileFor(location.fileName);
        if (!target) continue;
        const locationUri = tsPathToUri(location.fileName);
        edits.push({
          uri: locationUri,
          range: rangeOf(ts, target, location.textSpan),
          newText: location.suffixText || location.prefixText ? `${location.prefixText ?? ""}${newName}${location.suffixText ?? ""}` : newName,
        });
        counts.set(locationUri, (counts.get(locationUri) ?? 0) + 1);
      }
      const fileChangeCounts = [...counts.entries()].map(([locationUri, changes]) => ({ uri: locationUri, changes }));
      const total = edits.length;
      const fileCount = fileChangeCounts.length;
      return {
        edit: {
          edits,
          summary: `${total} change${total === 1 ? "" : "s"} in ${fileCount} file${fileCount === 1 ? "" : "s"}`,
        },
        fileChangeCounts,
      };
    },

    async codeActions(
      uri: string,
      range: IntelRange,
      diagnostics: IntelDiagnostic[],
      request: IntelRequest,
    ): Promise<IntelCodeAction[]> {
      fresh(request);
      const path = uriToTsPath(uri, rootPath);
      const file = sourceFileFor(path);
      if (!file) return [];
      const start = offsetOf(ts, file, range.start);
      const end = offsetOf(ts, file, range.end);
      const codes = diagnostics
        .map((diagnostic) => (typeof diagnostic.code === "number" ? diagnostic.code : null))
        .filter((code): code is number => code !== null);
      if (codes.length === 0) return [];
      const fixes = service.getCodeFixesAtPosition(path, start, end, codes, {}, {});
      const actions: IntelCodeAction[] = [];
      for (const fix of fixes) {
        const edits: IntelTextEdit[] = [];
        for (const change of fix.changes) {
          const target = sourceFileFor(change.fileName);
          if (!target) continue;
          edits.push(
            ...textSpanToEdits(
              tsPathToUri(change.fileName),
              target,
              change.textChanges.map((textChange) => ({ span: textChange.span, newText: textChange.newText })),
            ),
          );
        }
        if (edits.length === 0) continue;
        actions.push({
          title: fix.description,
          // fixId is typed `{}` but carries a string at runtime.
          kind: typeof fix.fixId === "string" ? fix.fixId : "quickfix",
          diagnostics,
          edit: { edits, summary: fix.description },
          needsResolve: false,
          actionId: fix.fixName,
        });
      }
      return actions;
    },

    async formatting(uri: string, request: IntelRequest): Promise<IntelTextEdit[]> {
      fresh(request);
      const path = uriToTsPath(uri, rootPath);
      const file = sourceFileFor(path);
      if (!file) return [];
      const edits = service.getFormattingEditsForDocument(path, formatOptions());
      return textSpanToEdits(uri, file, edits.map((edit) => ({ span: edit.span, newText: edit.newText })));
    },

    async rangeFormatting(uri: string, range: IntelRange, request: IntelRequest): Promise<IntelTextEdit[]> {
      fresh(request);
      const path = uriToTsPath(uri, rootPath);
      const file = sourceFileFor(path);
      if (!file) return [];
      const edits = service.getFormattingEditsForRange(
        path,
        offsetOf(ts, file, range.start),
        offsetOf(ts, file, range.end),
        formatOptions(),
      );
      return textSpanToEdits(uri, file, edits.map((edit) => ({ span: edit.span, newText: edit.newText })));
    },

    async organizeImports(uri: string, request: IntelRequest): Promise<IntelTextEdit[]> {
      fresh(request);
      const path = uriToTsPath(uri, rootPath);
      const file = sourceFileFor(path);
      if (!file) return [];
      const changes = service.organizeImports(
        { type: "file", fileName: path },
        {},
        {},
      );
      const edits: IntelTextEdit[] = [];
      for (const change of changes) {
        const target = sourceFileFor(change.fileName);
        if (!target) continue;
        edits.push(
          ...textSpanToEdits(
            tsPathToUri(change.fileName),
            target,
            change.textChanges.map((textChange) => ({ span: textChange.span, newText: textChange.newText })),
          ),
        );
      }
      return edits;
    },

    /** Refactor edits (extract constant/function/…) for the refactor module. */
    refactorEdits(
      uri: string,
      range: IntelRange,
      refactorName: string,
      actionName: string,
    ): { edits: IntelTextEdit[]; renameLocation: IntelRange | null } {
      const path = uriToTsPath(uri, rootPath);
      const file = sourceFileFor(path);
      if (!file) return { edits: [], renameLocation: null };
      // NB: refactor APIs take a TextRange ({ pos, end }), not a TextSpan.
      const start = offsetOf(ts, file, range.start);
      const result = service.getEditsForRefactor(
        path,
        {},
        { pos: start, end: offsetOf(ts, file, range.end) },
        refactorName,
        actionName,
        undefined,
      );
      if (!result) return { edits: [], renameLocation: null };
      const edits: IntelTextEdit[] = [];
      for (const change of result.edits) {
        const target = sourceFileFor(change.fileName);
        if (!target) continue;
        edits.push(
          ...textSpanToEdits(
            tsPathToUri(change.fileName),
            target,
            change.textChanges.map((textChange) => ({ span: textChange.span, newText: textChange.newText })),
          ),
        );
      }
      return {
        edits,
        renameLocation: result.renameLocation
          ? rangeOf(ts, file, { start: result.renameLocation, length: 0 })
          : null,
      };
    },

    /** Applicable refactors at a range (powers the refactor picker). */
    applicableRefactors(uri: string, range: IntelRange): { name: string; description: string; actions: { name: string; description: string; notApplicableReason?: string }[] }[] {
      const path = uriToTsPath(uri, rootPath);
      const file = sourceFileFor(path);
      if (!file) return [];
      const start = offsetOf(ts, file, range.start);
      const end = offsetOf(ts, file, range.end);
      try {
        // NB: TextRange ({ pos, end }) here, not a TextSpan.
        return service.getApplicableRefactors(path, { pos: start, end }, {}, undefined) ?? [];
      } catch {
        return [];
      }
    },

    async semanticTokens(uri: string, request: IntelRequest): Promise<IntelSemanticToken[]> {
      fresh(request);
      const path = uriToTsPath(uri, rootPath);
      const file = sourceFileFor(path);
      if (!file) return [];
      const end = file.getFullText().length;
      if (end === 0) return [];
      const result = service.getEncodedSemanticClassifications(
        path,
        { start: 0, length: end },
        ts.SemanticClassificationFormat.TwentyTwenty,
      );
      const tokens: IntelSemanticToken[] = [];
      for (let i = 0; i + 2 < result.spans.length; i += 3) {
        const start = result.spans[i] as number;
        const length = result.spans[i + 1] as number;
        const classification = result.spans[i + 2] as number;
        if (length <= 0) continue;
        const { tokenType, tokenModifiers } = decode2020Classification(classification);
        const position = ts.getLineAndCharacterOfPosition(file, start);
        tokens.push({
          line: position.line + 1,
          startColumn: position.character + 1,
          length,
          tokenType,
          tokenModifiers,
        });
        if (tokens.length >= 5000) break;
      }
      return tokens;
    },

    async inlayHints(uri: string, range: IntelRange, request: IntelRequest): Promise<IntelInlayHint[]> {
      fresh(request);
      const path = uriToTsPath(uri, rootPath);
      const file = sourceFileFor(path);
      if (!file) return [];
      // Genuine inferred-type hints: variable declarators without an explicit
      // type annotation, resolved through quickinfo. Bounded for mobile.
      const hints: IntelInlayHint[] = [];
      const visit = (node: ts.Node): void => {
        if (hints.length >= 50) return;
        if (
          ts.isVariableDeclaration(node) &&
          node.type === undefined &&
          node.initializer !== undefined &&
          ts.isIdentifier(node.name)
        ) {
          const position = node.name.getStart(file);
          const line = ts.getLineAndCharacterOfPosition(file, position);
          if (line.line + 1 < range.start.line || line.line + 1 > range.end.line) {
            // Outside the requested range — skip without an LS call.
          } else {
            const info = service.getQuickInfoAtPosition(path, position);
            const typeText = info?.displayParts
              ?.map((part) => part.text)
              .join("")
              .match(/^.*?:\s*(.+)$/)?.[1]
              ?.trim();
            if (typeText && typeText !== "any" && typeText !== "error") {
              const end = node.name.getEnd();
              const endPosition = ts.getLineAndCharacterOfPosition(file, end);
              hints.push({
                position: { line: endPosition.line + 1, column: endPosition.character + 1 },
                label: `: ${typeText.length > 60 ? `${typeText.slice(0, 60)}…` : typeText}`,
                kind: "type",
              });
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(file);
      return hints;
    },

    capabilities(): IntelCapabilities {
      return { semantic: true, syntax: true, formatting: true, diagnostics: true, navigation: true };
    },

    status(): IntelServiceStatus {
      return disposed ? { state: "unavailable", reason: "disposed" } : { state: "ready" };
    },
  };

  function formatOptions(): ts.FormatCodeOptions {
    // FormatCodeOptions uses PascalCase members; the InsertSpace* group is
    // required, so standard spacing defaults are spelled out.
    return {
      TabSize: deps.tabSize ?? 2,
      IndentSize: deps.tabSize ?? 2,
      ConvertTabsToSpaces: deps.insertSpaces ?? true,
      NewLineCharacter: "\n",
      IndentStyle: ts.IndentStyle.Smart,
      InsertSpaceAfterCommaDelimiter: true,
      InsertSpaceAfterSemicolonInForStatements: true,
      InsertSpaceBeforeAndAfterBinaryOperators: true,
      InsertSpaceAfterKeywordsInControlFlowStatements: true,
      InsertSpaceAfterFunctionKeywordForAnonymousFunctions: true,
      InsertSpaceAfterOpeningAndBeforeClosingNonemptyParenthesis: true,
      InsertSpaceAfterOpeningAndBeforeClosingNonemptyBrackets: true,
      InsertSpaceAfterOpeningAndBeforeClosingTemplateStringBraces: true,
      PlaceOpenBraceOnNewLineForFunctions: false,
      PlaceOpenBraceOnNewLineForControlBlocks: false,
    };
  }

  function positionOf(file: ts.SourceFile, offset: number): IntelPosition {
    const position = ts.getLineAndCharacterOfPosition(file, Math.max(0, offset));
    return { line: position.line + 1, column: position.character + 1 };
  }
}

export type TypeScriptIntelService = ReturnType<typeof createTypeScriptService>;
