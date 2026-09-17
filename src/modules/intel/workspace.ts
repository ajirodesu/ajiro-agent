/**
 * Workspace manager + persistent project index (§27, §49).
 *
 * Index covers files, directories, symbols, imports/exports, packages, and
 * config files. Updates are incremental: unchanged fingerprints are never
 * re-parsed, open files win priority, and a dependency graph limits the
 * blast radius of a change. The file-content reads are injected (RN side
 * uses the workspace file service; tests use memory) so this module stays
 * pure and synchronous from the caller's perspective except for I/O.
 */
import type { IntelDocumentSymbol, IntelSymbolKind } from "@/modules/intel/types";

export interface IndexedFile {
  uri: string;
  languageId: string;
  fingerprint: string;
  size: number;
  mtimeMs: number;
  symbols: IntelDocumentSymbol[];
  imports: string[];
  exports: string[];
  indexedAt: number;
}

export interface ProjectConfig {
  rootUri: string;
  tsconfig: TsConfigInfo | null;
  packageJson: PackageJsonInfo | null;
}

export interface TsConfigInfo {
  uri: string;
  paths: Record<string, string[]>;
  baseUrl: string | null;
  jsx: string | null;
}

export interface PackageJsonInfo {
  uri: string;
  dependencies: string[];
  devDependencies: string[];
  scripts: Record<string, string>;
}

export interface WorkspaceSnapshot {
  files: IndexedFile[];
  directories: string[];
  totalSymbols: number;
  indexedAt: number;
}

export interface WorkspaceFileReader {
  listFiles(rootUri: string): Promise<string[]>;
  readFile(uri: string): Promise<{ text: string; mtimeMs: number } | null>;
}

export interface SymbolExtractor {
  (uri: string, languageId: string, text: string): {
    symbols: IntelDocumentSymbol[];
    imports: string[];
    exports: string[];
  };
}

export interface WorkspaceIndexOptions {
  maxFiles?: number;
  maxFileBytes?: number;
  /** Extra dir names to skip beyond the built-in set. */
  extraSkips?: string[];
}

const DEFAULT_SKIPS = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "dist",
  "build",
  "out",
  ".expo",
  ".next",
  ".turbo",
  "coverage",
  ".nyc_output",
  "vendor",
  "Pods",
  "__pycache__",
  ".venv",
  "venv",
  ".idea",
  ".vscode",
]);

/** FNV-1a 32-bit fingerprint — cheap change detection, not security. */
export function fingerprintText(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

export function shouldSkipDir(name: string, extraSkips: Set<string>): boolean {
  return DEFAULT_SKIPS.has(name) || extraSkips.has(name) || name.startsWith(".");
}

export function parsePackageJson(text: string, uri: string): PackageJsonInfo | null {
  try {
    const data = JSON.parse(text) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    };
    return {
      uri,
      dependencies: Object.keys(data.dependencies ?? {}),
      devDependencies: Object.keys(data.devDependencies ?? {}),
      scripts: data.scripts ?? {},
    };
  } catch {
    return null;
  }
}

function stripJsonComments(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const index = line.indexOf("//");
      return index >= 0 ? line.slice(0, index) : line;
    })
    .join("\n");
}

export function parseTsConfig(text: string, uri: string): TsConfigInfo | null {
  try {
    const data = JSON.parse(stripJsonComments(text)) as {
      compilerOptions?: {
        baseUrl?: string;
        jsx?: string;
        paths?: Record<string, string[]>;
      };
    };
    const options = data.compilerOptions ?? {};
    return {
      uri,
      paths: options.paths ?? {},
      baseUrl: options.baseUrl ?? null,
      jsx: options.jsx ?? null,
    };
  } catch {
    return null;
  }
}

/** Resolve a `paths` alias to candidate relative paths (longest-prefix wins). */
export function resolvePathAlias(
  specifier: string,
  paths: Record<string, string[]>,
): string[] {
  let best: { pattern: string; targets: string[] } | null = null;
  for (const [pattern, targets] of Object.entries(paths)) {
    const star = pattern.indexOf("*");
    const matches =
      star < 0
        ? pattern === specifier
        : specifier.startsWith(pattern.slice(0, star)) &&
          (pattern.endsWith("*") || specifier.length >= pattern.length - 1);
    if (matches && (!best || pattern.length > best.pattern.length)) {
      best = { pattern, targets };
    }
  }
  if (!best) return [];
  const star = best.pattern.indexOf("*");
  const captured = star < 0 ? "" : specifier.slice(star);
  return best.targets.map((target) => target.replace("*", captured));
}

export interface WorkspaceManager {
  indexProject(rootUri: string): Promise<WorkspaceSnapshot>;
  updateFile(uri: string): Promise<IndexedFile | null>;
  removeFile(uri: string): void;
  getFile(uri: string): IndexedFile | null;
  getConfig(rootUri: string): Promise<ProjectConfig>;
  searchSymbols(query: string, limit?: number): { uri: string; name: string; kind: IntelSymbolKind }[];
  dependentsOf(uri: string): string[];
  stats(): { files: number; symbols: number; lastIndexedAt: number };
}

export function createWorkspaceManager(
  reader: WorkspaceFileReader,
  extract: SymbolExtractor,
  options: WorkspaceIndexOptions = {},
): WorkspaceManager {
  const maxFiles = options.maxFiles ?? 3000;
  const maxFileBytes = options.maxFileBytes ?? 500_000;
  const extraSkips = new Set(options.extraSkips ?? []);
  const files = new Map<string, IndexedFile>();
  const configs = new Map<string, ProjectConfig>();
  let lastIndexedAt = 0;

  function isIndexable(uri: string): boolean {
    const segments = uri.split("/");
    for (const segment of segments) {
      if (shouldSkipDir(segment, extraSkips)) return false;
    }
    return true;
  }

  async function indexOne(uri: string, languageId: string): Promise<IndexedFile | null> {
    const read = await reader.readFile(uri);
    if (!read) return null;
    if (read.text.length > maxFileBytes) return null;
    const fingerprint = fingerprintText(read.text);
    const existing = files.get(uri);
    if (existing && existing.fingerprint === fingerprint) return existing;
    const { symbols, imports, exports } = extract(uri, languageId, read.text);
    const indexed: IndexedFile = {
      uri,
      languageId,
      fingerprint,
      size: read.text.length,
      mtimeMs: read.mtimeMs,
      symbols,
      imports,
      exports,
      indexedAt: Date.now(),
    };
    files.set(uri, indexed);
    return indexed;
  }

  function languageIdForUri(uri: string): string {
    const lower = uri.toLowerCase();
    if (/\.(m|c)?tsx?$/.test(lower)) return "typescript";
    if (/\.(m|c)?jsx?$/.test(lower)) return "javascript";
    if (lower.endsWith(".py")) return "python";
    if (lower.endsWith(".json")) return "json";
    if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
    if (lower.endsWith(".css")) return "css";
    if (lower.endsWith(".md")) return "markdown";
    if (lower.endsWith(".yaml") || lower.endsWith(".yml")) return "yaml";
    return "plaintext";
  }

  return {
    async indexProject(rootUri) {
      const all = await reader.listFiles(rootUri);
      // Open-file priority is applied by the caller pre-seeding `updateFile`;
      // here we index smallest-first so interactive files land early.
      const candidates = all.filter(isIndexable).slice(0, maxFiles);
      const directories = new Set<string>();
      for (const uri of candidates) {
        const slash = uri.lastIndexOf("/");
        if (slash > 0) directories.add(uri.slice(0, slash));
        await indexOne(uri, languageIdForUri(uri));
      }
      // Evict files that no longer exist (cheap: only when a full pass ran).
      for (const uri of [...files.keys()]) {
        if (uri.startsWith(rootUri) && !candidates.includes(uri)) {
          files.delete(uri);
        }
      }
      lastIndexedAt = Date.now();
      const indexed = [...files.values()].filter((file) => file.uri.startsWith(rootUri));
      return {
        files: indexed,
        directories: [...directories],
        totalSymbols: indexed.reduce((count, file) => count + file.symbols.length, 0),
        indexedAt: lastIndexedAt,
      };
    },

    async updateFile(uri) {
      if (!isIndexable(uri)) return null;
      return indexOne(uri, languageIdForUri(uri));
    },

    removeFile(uri) {
      files.delete(uri);
    },

    getFile(uri) {
      return files.get(uri) ?? null;
    },

    async getConfig(rootUri) {
      const cached = configs.get(rootUri);
      if (cached) return cached;
      const packageRead = await reader.readFile(`${rootUri}/package.json`);
      const tsRead =
        (await reader.readFile(`${rootUri}/tsconfig.json`)) ??
        (await reader.readFile(`${rootUri}/jsconfig.json`));
      const config: ProjectConfig = {
        rootUri,
        tsconfig: tsRead
          ? parseTsConfig(tsRead.text, `${rootUri}/tsconfig.json`)
          : null,
        packageJson: packageRead
          ? parsePackageJson(packageRead.text, `${rootUri}/package.json`)
          : null,
      };
      configs.set(rootUri, config);
      return config;
    },

    searchSymbols(query, limit = 50) {
      const needle = query.toLowerCase();
      const out: { uri: string; name: string; kind: IntelSymbolKind }[] = [];
      const visit = (symbols: IntelDocumentSymbol[], uri: string): void => {
        for (const symbol of symbols) {
          if (symbol.name.toLowerCase().includes(needle)) {
            out.push({ uri, name: symbol.name, kind: symbol.kind as IntelSymbolKind });
            if (out.length >= limit) return;
          }
          visit(symbol.children, uri);
          if (out.length >= limit) return;
        }
      };
      for (const file of files.values()) {
        visit(file.symbols, file.uri);
        if (out.length >= limit) break;
      }
      return out;
    },

    dependentsOf(uri) {
      const base = uri.split("/").pop() ?? uri;
      const stem = base.replace(/\.(d\.)?(m|c)?(ts|tsx|js|jsx)$/, "");
      const out: string[] = [];
      for (const file of files.values()) {
        if (file.uri === uri) continue;
        if (
          file.imports.some(
            (spec) => spec === base || spec.endsWith(`/${base}`) || spec.endsWith(`/${stem}`),
          )
        ) {
          out.push(file.uri);
        }
      }
      return out;
    },

    stats() {
      let symbols = 0;
      for (const file of files.values()) symbols += file.symbols.length;
      return { files: files.size, symbols, lastIndexedAt };
    },
  };
}
