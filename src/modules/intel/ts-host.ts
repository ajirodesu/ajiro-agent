/**
 * In-memory TypeScript `LanguageServiceHost` (§5).
 *
 * Pure logic over injected file state — no DOM, no React Native APIs, no
 * Node APIs. The `typescript` runtime module itself is injected too, so this
 * file (and its consumers) never statically import the compiler: the RN
 * bundle stays free of it (see the bundle-hygiene test) while Node tests
 * and the WebView bundle wire the real compiler in.
 *
 * Path model: URIs look like `file:///project/src/a.ts`; the host serves
 * them at virtual paths `/project/src/a.ts`. Library files live under
 * `VIRTUAL_LIB_DIR`.
 */
import type * as ts from "typescript";

import { VIRTUAL_LIB_DIR } from "@/modules/intel/ts-libs";

/** The compiler module type without importing its values (bundle-safe). */
export type TsModule = typeof import("typescript");

export interface TsHostFile {
  version: number;
  text: string;
}

export interface TsHostDeps {
  ts: TsModule;
  /** Open + fetched project files, keyed by virtual path. */
  files: Map<string, TsHostFile>;
  /** Bundled lib files, keyed by file name (`lib.es5.d.ts`, …). */
  libFiles: Map<string, string>;
  rootPath?: string;
  compilerOptions?: ts.CompilerOptions;
}

const TS_SUFFIX = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

export function uriToTsPath(uri: string, rootPath = "/project"): string {
  let path = uri;
  if (path.startsWith("file://")) path = path.slice("file://".length);
  if (!path.startsWith("/")) path = `${rootPath}/${path}`;
  return normalizeTsPath(path);
}

export function tsPathToUri(path: string): string {
  return `file://${normalizeTsPath(path)}`;
}

function normalizeTsPath(path: string): string {
  const parts = path.split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return `/${out.join("/")}`;
}

function isTsLike(path: string): boolean {
  const lower = path.toLowerCase();
  if (lower.endsWith(".d.ts") || lower.endsWith(".d.mts") || lower.endsWith(".d.cts")) return true;
  return TS_SUFFIX.some((suffix) => lower.endsWith(suffix));
}

export function defaultTsCompilerOptions(compiler: TsModule): ts.CompilerOptions {
  return {
    target: compiler.ScriptTarget.ES2022,
    module: compiler.ModuleKind.ESNext,
    moduleResolution: compiler.ModuleResolutionKind.Bundler,
    jsx: compiler.JsxEmit.ReactJSX,
    allowJs: true,
    checkJs: false,
    strict: false,
    esModuleInterop: true,
    skipLibCheck: true,
    types: [],
    lib: ["ES2022", "DOM", "DOM.Iterable"],
  };
}

export function scriptKindForPath(compiler: TsModule, path: string): ts.ScriptKind {
  const lower = path.toLowerCase();
  if (lower.endsWith(".tsx")) return compiler.ScriptKind.TSX;
  if (lower.endsWith(".ts") || lower.endsWith(".mts") || lower.endsWith(".cts")) return compiler.ScriptKind.TS;
  if (lower.endsWith(".jsx")) return compiler.ScriptKind.JSX;
  return compiler.ScriptKind.JS;
}

export interface InMemoryTsHost extends ts.LanguageServiceHost {
  projectVersion: number;
  bumpProjectVersion(): void;
}

export function createInMemoryTsHost(deps: TsHostDeps): InMemoryTsHost {
  const { ts, files, libFiles } = deps;
  const rootPath = deps.rootPath ?? "/project";
  const options = { ...defaultTsCompilerOptions(ts), ...deps.compilerOptions };
  let projectVersion = 0;

  function libContent(fileName: string): string | null {
    const base = fileName.split("/").pop() ?? fileName;
    return libFiles.get(base) ?? libFiles.get(fileName) ?? null;
  }

  const host: InMemoryTsHost = {
    projectVersion,
    bumpProjectVersion() {
      projectVersion += 1;
      host.projectVersion = projectVersion;
    },
    getCompilationSettings: () => options,
    getNewLine: () => "\n",
    getCurrentDirectory: () => rootPath,
    // Matches LIB_ENTRY: the explicit `lib` option resolves relative to
    // this rooted file name, and the closure in ts-libs guarantees every
    // requested file is present under VIRTUAL_LIB_DIR.
    getDefaultLibFileName: () => `${VIRTUAL_LIB_DIR}/lib.es2022.d.ts`,
    useCaseSensitiveFileNames: () => true,
    getProjectVersion: () => String(projectVersion),

    getScriptFileNames() {
      const names: string[] = [];
      for (const path of files.keys()) {
        if (isTsLike(path)) names.push(path);
      }
      return names;
    },

    getScriptVersion(path) {
      return String(files.get(path)?.version ?? 0);
    },

    getScriptKind(path) {
      return scriptKindForPath(ts, path);
    },

    getScriptSnapshot(path) {
      const direct = files.get(path);
      if (direct) return ts.ScriptSnapshot.fromString(direct.text);
      const lib = path.startsWith(VIRTUAL_LIB_DIR) ? libContent(path) : null;
      if (lib !== null) return ts.ScriptSnapshot.fromString(lib);
      return undefined;
    },

    fileExists(path) {
      if (files.has(path)) return true;
      if (path.startsWith(VIRTUAL_LIB_DIR)) return libContent(path) !== null;
      return false;
    },

    readFile(path) {
      const direct = files.get(path);
      if (direct) return direct.text;
      if (path.startsWith(VIRTUAL_LIB_DIR)) return libContent(path) ?? undefined;
      return undefined;
    },

    directoryExists() {
      // No directory enumeration: `@types` auto-inclusion is off (`types: []`)
      // and project files are registered explicitly.
      return true;
    },

    getDirectories() {
      return [];
    },

    realpath(path) {
      return path;
    },
  };

  return host;
}
