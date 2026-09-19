/**
 * Repo map: a lightweight symbol index over the project so the agent can
 * answer "where is X defined" without rescanning the tree every turn.
 *
 * Uses @babel/parser (already a dependency) instead of ts-morph to keep the
 * bundle small — the walk records file, exported symbol names, function/class
 * declarations and top-level const bindings for JS/TS/JSX/TSX files.
 *
 * Author: AjiroDesu
 */
import type { ExternalFolderSession } from "@/core/types/app-state";
import { createExternalFolderService } from "@/core/services/external-folder/external-folder-service";

const CODE_EXTENSIONS = [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"];
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".gradle",
  "build",
  "dist",
  ".expo",
]);
const MAX_FILES = 500;
const MAX_FILE_CHARS = 400_000;
const MAX_MAP_LINES = 120;

export type RepoSymbol = {
  file: string;
  kind: "class" | "const" | "function" | "type";
  name: string;
};

export type RepoMap = {
  generatedAt: string;
  files: number;
  symbols: RepoSymbol[];
};

function collectCodeFiles(
  session: ExternalFolderSession,
  rootPath = "",
): string[] {
  const service = createExternalFolderService();
  const files: string[] = [];

  const walk = (path: string) => {
    if (files.length >= MAX_FILES) {
      return;
    }

    let entries;

    try {
      entries = service.listEntries(session, path);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (files.length >= MAX_FILES) {
        return;
      }

      if (entry.kind === "directory") {
        if (!SKIP_DIRS.has(entry.name)) {
          walk(entry.path);
        }
        continue;
      }

      const lower = entry.name.toLowerCase();

      if (CODE_EXTENSIONS.some((extension) => lower.endsWith(extension))) {
        files.push(entry.path);
      }
    }
  };

  walk(rootPath);

  return files;
}

async function extractSymbols(content: string): Promise<RepoSymbol[]> {
  const symbols: RepoSymbol[] = [];
  const { parse: parseBabel } = await import("@babel/parser");
  let ast;

  try {
    ast = parseBabel(content, {
      allowReturnOutsideFunction: true,
      plugins: ["typescript", "jsx"],
      sourceType: "unambiguous",
    });
  } catch {
    return symbols;
  }

  for (const node of ast.program.body) {
    if (node.type === "ExportNamedDeclaration" || node.type === "ExportDefaultDeclaration") {
      const declaration = node.declaration;

      if (!declaration) {
        continue;
      }

      if (declaration.type === "FunctionDeclaration" && declaration.id) {
        symbols.push({ file: "", kind: "function", name: declaration.id.name });
      } else if (declaration.type === "ClassDeclaration" && declaration.id) {
        symbols.push({ file: "", kind: "class", name: declaration.id.name });
      } else if (declaration.type === "TSInterfaceDeclaration") {
        symbols.push({
          file: "",
          kind: "type",
          name: declaration.id.name,
        });
      } else if (declaration.type === "TSTypeAliasDeclaration") {
        symbols.push({ file: "", kind: "type", name: declaration.id.name });
      } else if (
        declaration.type === "VariableDeclaration" &&
        declaration.kind === "const"
      ) {
        for (const declarator of declaration.declarations) {
          if (declarator.id.type === "Identifier") {
            symbols.push({
              file: "",
              kind: "const",
              name: declarator.id.name,
            });
          }
        }
      }
    }
  }

  return symbols;
}

export async function buildRepoMap(
  session: ExternalFolderSession,
): Promise<RepoMap> {
  const service = createExternalFolderService();
  const files = collectCodeFiles(session);
  const symbols: RepoSymbol[] = [];

  for (const file of files) {
    try {
      const text = await service.readTextFile(session, file, MAX_FILE_CHARS);
      const fileSymbols = await extractSymbols(text);

      for (const symbol of fileSymbols) {
        symbol.file = file;
        symbols.push(symbol);
      }
    } catch {
      // unreadable/binary — skip
    }
  }

  return {
    files: files.length,
    generatedAt: new Date().toISOString(),
    symbols,
  };
}

export function formatRepoMap(map: RepoMap) {
  if (map.symbols.length === 0) {
    return `No JS/TS symbols found (${map.files} code files scanned).`;
  }

  const grouped = new Map<string, string[]>();

  for (const symbol of map.symbols) {
    const list = grouped.get(symbol.file) ?? [];
    list.push(`${symbol.name} (${symbol.kind})`);
    grouped.set(symbol.file, list);
  }

  const lines: string[] = [
    `Project map: ${map.files} code files, ${map.symbols.length} symbols.`,
  ];

  for (const [file, fileSymbols] of [...grouped.entries()].sort()) {
    if (lines.length >= MAX_MAP_LINES) {
      lines.push("…[map truncated]");
      break;
    }

    lines.push(`${file}: ${fileSymbols.join(", ")}`);
  }

  return lines.join("\n");
}
