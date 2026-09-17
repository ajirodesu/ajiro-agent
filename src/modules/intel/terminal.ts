/**
 * Terminal/build/test integration (§32, §33).
 *
 * Command builders for run/build/lint/test workflows executed through the
 * existing coding exec tools, plus a tsc-style output parser that turns
 * compiler output into navigable editor diagnostics (file/line/column).
 */
import type { IntelDiagnostic, IntelRange } from "@/modules/intel/types";

export type IntelRunKind = "run-file" | "run-project" | "build" | "lint" | "format" | "test-file" | "test-project";

export interface IntelRunRequest {
  kind: IntelRunKind;
  /** Project-relative file path for file-scoped runs. */
  file?: string;
  /** Extra CLI args. */
  args?: string[];
}

export interface IntelRunCommand {
  /** Display label for terminal UI. */
  label: string;
  /** Executable + argv (sandboxed by the existing exec layer). */
  command: string;
  argv: string[];
  cwd: string;
}

/** Build a runnable command from project signals (no execution here). */
export function buildRunCommand(
  projectRoot: string,
  request: IntelRunRequest,
  project: { packageManager: "npm" | "yarn" | "pnpm" | "bun" | null; scripts: Record<string, string> },
): IntelRunCommand | null {
  const pm = project.packageManager ?? "npm";
  const run = (argv: string[]): IntelRunCommand => ({
    label: argv.join(" "),
    command: argv[0] as string,
    argv: argv.slice(1),
    cwd: projectRoot,
  });
  switch (request.kind) {
    case "run-file":
      if (!request.file) return null;
      if (/\.py$/.test(request.file)) return run(["python3", request.file, ...(request.args ?? [])]);
      if (/\.(ts|tsx|js|jsx|mjs)$/.test(request.file)) {
        if (project.scripts.dev) return run([pm, "run", "dev", "--", request.file]);
        return run(["node", request.file, ...(request.args ?? [])]);
      }
      if (/\.go$/.test(request.file)) return run(["go", "run", request.file]);
      return null;
    case "run-project":
      if (project.scripts.dev) return run([pm, "run", "dev"]);
      if (project.scripts.start) return run([pm, "run", "start"]);
      return null;
    case "build":
      if (project.scripts.build) return run([pm, "run", "build"]);
      if (project.scripts.compile) return run([pm, "run", "compile"]);
      return null;
    case "lint":
      if (project.scripts.lint) return run([pm, "run", "lint"]);
      return run(["npx", "tsc", "--noEmit", "-p", "."]);
    case "format":
      if (project.scripts.format) return run([pm, "run", "format"]);
      return null;
    case "test-file":
      if (!request.file) return null;
      if (project.scripts["test:file"]) return run([pm, "run", "test:file", request.file]);
      return run([pm, "test", "--", request.file, ...(request.args ?? [])]);
    case "test-project":
      if (project.scripts.test) return run([pm, "run", "test"]);
      return null;
  }
}

const TSC_LINE = /^(.+?)\((\d+),(\d+)\):\s+(error|warning|info)\s+TS(\d+):\s*(.*)$/;
const GCC_LINE = /^(.+?):(\d+):(\d+):\s+(error|warning|note):\s*(.*)$/;
const PYTEST_LINE = /^(.+?):(\d+):\s*(.*)$/;

export interface CompilerDiagnostic {
  /** Absolute-ish file path as printed by the compiler. */
  file: string;
  diagnostic: IntelDiagnostic;
}

/**
 * Parse `tsc`, gcc-style, and pytest-style output lines into diagnostics.
 * Unknown lines are ignored — never fabricated. Tapping a result navigates
 * to `file` + `diagnostic.range`.
 */
export function parseCompilerOutput(output: string, projectRoot: string): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const joinRoot = (file: string): string => (file.startsWith("/") ? file : `${projectRoot}/${file}`);
  for (const rawLine of output.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const tsc = TSC_LINE.exec(line);
    if (tsc) {
      diagnostics.push({
        file: joinRoot(tsc[1] as string),
        diagnostic: {
          severity: tsc[4] === "error" ? "error" : tsc[4] === "warning" ? "warning" : "info",
          message: `${tsc[6]} (TS${tsc[5]})`,
          source: "tsc",
          code: Number(tsc[5]),
          range: pointRange(Number(tsc[2]), Number(tsc[3])),
          related: [],
          fixable: false,
        },
      });
      continue;
    }
    const gcc = GCC_LINE.exec(line);
    if (gcc) {
      diagnostics.push({
        file: joinRoot(gcc[1] as string),
        diagnostic: {
          severity: gcc[4] === "error" ? "error" : gcc[4] === "warning" ? "warning" : "info",
          message: gcc[5] ?? "",
          source: "compiler",
          code: null,
          range: pointRange(Number(gcc[2]), Number(gcc[3])),
          related: [],
          fixable: false,
        },
      });
      continue;
    }
    const pytest = PYTEST_LINE.exec(line);
    if (pytest && /test|assert|error/i.test(pytest[3] ?? "")) {
      diagnostics.push({
        file: joinRoot(pytest[1] as string),
        diagnostic: {
          severity: "error",
          message: pytest[3] ?? "",
          source: "pytest",
          code: null,
          range: pointRange(Number(pytest[2]), 1),
          related: [],
          fixable: false,
        },
      });
    }
  }
  return diagnostics;
}

function pointRange(line: number, column: number): IntelRange {
  const safeLine = Number.isFinite(line) && line >= 1 ? Math.floor(line) : 1;
  const safeColumn = Number.isFinite(column) && column >= 1 ? Math.floor(column) : 1;
  return {
    start: { line: safeLine, column: safeColumn },
    end: { line: safeLine, column: safeColumn + 1 },
  };
}
