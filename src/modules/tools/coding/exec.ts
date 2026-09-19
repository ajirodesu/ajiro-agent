/**
 * Exec tool for the on-device coding harness.
 *
 * CHOSEN APPROACH — option (c): a fixed allow-list of in-process JS
 * implementations of common checks, NOT a real shell.
 *
 * Why:
 * 1. Stock Android (no root, no Termux) exposes no exec() for apps —
 *    Runtime.getRuntime().exec() can only run the app's own bundled binaries,
 *    so a general shell (option a) would require shipping one or rooting.
 * 2. Termux:API (option b) adds a hard external dependency on another app and
 *    an intent round-trip per command; the app cannot assume it is installed.
 * 3. The checks that matter for a coding verify loop — typecheck, lint, text
 *    search, file stats, git status — can all be implemented in-process with
 *    JS libraries (@babel/parser parse of changed files, regex grep, git via
 *    isomorphic-git). That keeps everything sandboxed inside the SAF-granted
 *    project directory, approval-gated, and identical on every device.
 *
 * Commands are stable IDs, not shell strings. There is no way for the model to
 * inject a shell metacharacter because nothing is ever executed as a shell.
 * Timeout and output caps are enforced here regardless of caller.
 *
 * Author: AjiroDesu
 */
import type { ExternalFolderSession } from "@/core/types/app-state";
import { createExternalFolderService } from "@/core/services/external-folder/external-folder-service";

import type { CodingExecCommandId } from "@/core/services/coding/coding-settings";
import {
  EXEC_COMMAND_DESCRIPTIONS,
  EXEC_COMMAND_IDS,
} from "@/modules/tools/coding/exec-commands";

export { EXEC_COMMAND_DESCRIPTIONS, EXEC_COMMAND_IDS };

export const MAX_EXEC_OUTPUT_CHARS = 8000;
export const EXEC_TIMEOUT_MS = 60_000;
const MAX_FILES_SCANNED = 800;
const MAX_FILE_BYTES = 1_500_000;

const CODE_EXTENSIONS = [
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
];

export type ExecInput = {
  args?: Record<string, unknown>;
  command: CodingExecCommandId;
  path?: string;
};

export type ExecOutput = {
  command: CodingExecCommandId;
  output: string;
  path: string;
  timedOut: boolean;
  truncated: boolean;
};

function collectFiles(
  session: ExternalFolderSession,
  rootPath: string,
  budget: { files: number },
): { path: string; kind: "directory" | "file" }[] {
  const service = createExternalFolderService();
  const collected: { path: string; kind: "directory" | "file" }[] = [];

  const walk = (path: string) => {
    if (budget.files <= 0) {
      return;
    }

    let entries;

    try {
      entries = service.listEntries(session, path);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (budget.files <= 0) {
        return;
      }

      if (
        entry.kind === "directory" &&
        ["node_modules", ".git", ".gradle", "build", "dist", ".expo"].includes(
          entry.name,
        )
      ) {
        continue;
      }

      if (entry.kind === "file" && entry.size !== null && entry.size > MAX_FILE_BYTES) {
        continue;
      }

      budget.files -= 1;
      collected.push({ kind: entry.kind, path: entry.path });

      if (entry.kind === "directory") {
        walk(entry.path);
      }
    }
  };

  walk(rootPath || "");

  return collected;
}

function isCodeFile(path: string) {
  const lower = path.toLowerCase();
  return CODE_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

async function runTypecheckJs(
  session: ExternalFolderSession,
  rootPath: string,
  timedOut: { value: boolean },
) {
  // Lazy load: @babel/parser is ~1MB of AST code that only this check needs.
  const { parse: parseBabel } = await import("@babel/parser");
  const budget = { files: MAX_FILES_SCANNED };
  const files = collectFiles(session, rootPath, budget).filter(
    (entry) => entry.kind === "file" && isCodeFile(entry.path),
  );
  const problems: string[] = [];
  let parsed = 0;
  let skipped = 0;

  for (const file of files) {
    if (timedOut.value) {
      break;
    }

    // A cache MISS means unreadable (binary/denied) — it must be reported
    // as skipped, never parsed as "" (which is vacuously valid and would
    // print a false-clean bill of health).
    if (!textCache.has(file.path)) {
      skipped += 1;
      continue;
    }
    parsed += 1;

    try {
      const content = textCache.get(file.path) ?? "";
      parseBabel(content, {
        allowReturnOutsideFunction: true,
        plugins: ["typescript", "jsx"],
        sourceType: "unambiguous",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      problems.push(`${file.path}: ${message.split("\n")[0]}`);
    }
  }

  const skippedNote =
    skipped > 0 ? `, ${skipped} skipped (unreadable)` : "";
  if (problems.length === 0) {
    return `Parsed ${parsed} JS/TS files: no syntax errors${skippedNote}.`;
  }

  return [
    `${problems.length} file(s) with syntax errors (of ${parsed} parsed${skippedNote}):`,
    ...problems.slice(0, 40),
  ].join("\n");
}

const textCache = new Map<string, string>();

function runLintJs(
  session: ExternalFolderSession,
  rootPath: string,
  timedOut: { value: boolean },
) {
  const budget = { files: MAX_FILES_SCANNED };
  const files = collectFiles(session, rootPath, budget).filter(
    (entry) => entry.kind === "file" && isCodeFile(entry.path),
  );
  const problems: string[] = [];
  let parsed = 0;
  let skipped = 0;

  for (const file of files) {
    if (timedOut.value) {
      break;
    }

    if (!textCache.has(file.path)) {
      skipped += 1;
      continue;
    }
    parsed += 1;

    const content = textCache.get(file.path) ?? "";

    if (!content) {
      continue;
    }

    const lines = content.split("\n");

    lines.forEach((line, index) => {
      const lineNumber = index + 1;

      if (/\bvar\s+\w/.test(line)) {
        problems.push(`${file.path}:${lineNumber}: use const/let instead of var`);
      }

      if (/^\s*debugger\b/.test(line)) {
        problems.push(`${file.path}:${lineNumber}: debugger statement`);
      }

      if (/\bconsole\.log\(/.test(line)) {
        problems.push(`${file.path}:${lineNumber}: console.log left in code`);
      }

      if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(line)) {
        problems.push(`${file.path}:${lineNumber}: empty catch block`);
      }
    });
  }

  const skippedNote =
    skipped > 0 ? `, ${skipped} skipped (unreadable)` : "";
  if (problems.length === 0) {
    return `Linted ${parsed} JS/TS files: no findings${skippedNote}.`;
  }

  return [
    `${problems.length} finding(s) (of ${parsed} parsed${skippedNote}):`,
    ...problems.slice(0, 40),
  ].join("\n");
}

function runGrepCount(
  session: ExternalFolderSession,
  rootPath: string,
  args: Record<string, unknown>,
  timedOut: { value: boolean },
) {
  const pattern = typeof args.pattern === "string" ? args.pattern : null;

  if (!pattern) {
    throw new Error("grep-count requires args.pattern (a regex string).");
  }

  let regex: RegExp;
  try {
    regex = new RegExp(pattern, "gm");
  } catch {
    throw new Error(`grep-count: invalid regex pattern ${JSON.stringify(pattern)}.`);
  }
  const budget = { files: MAX_FILES_SCANNED };
  const files = collectFiles(session, rootPath, budget).filter(
    (entry) => entry.kind === "file",
  );
  const results: string[] = [];
  let totalMatches = 0;
  // Bound match materialization: `.match()` on a ~1.5MB file with a
  // degenerate pattern can allocate millions of entries. Count with a
  // capped exec loop instead; totals above the cap are reported as-is.
  const MAX_MATCHES_PER_FILE = 1000;

  for (const file of files) {
    if (timedOut.value) {
      break;
    }

    const content = textCache.get(file.path) ?? "";

    if (!content) {
      continue;
    }

    regex.lastIndex = 0;
    let count = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      count += 1;
      if (count >= MAX_MATCHES_PER_FILE) {
        break;
      }
      // Guard zero-length matches against an infinite loop.
      if (match[0].length === 0) {
        regex.lastIndex += 1;
      }
    }

    if (count > 0) {
      totalMatches += count;
      results.push(
        `${file.path}: ${count}${count >= MAX_MATCHES_PER_FILE ? "+" : ""}`,
      );
    }
  }

  if (results.length === 0) {
    return `Pattern /${pattern}/ has no matches in ${files.length} scanned files.`;
  }

  return [
    `Pattern /${pattern}/: ${totalMatches} match(es) in ${results.length} file(s):`,
    ...results.slice(0, 60),
  ].join("\n");
}

function runFileStats(
  session: ExternalFolderSession,
  rootPath: string,
  timedOut: { value: boolean },
) {
  const budget = { files: MAX_FILES_SCANNED };
  const files = collectFiles(session, rootPath, budget).filter(
    (entry) => entry.kind === "file",
  );
  const lines: string[] = [];
  let totalBytes = 0;

  for (const file of files) {
    if (timedOut.value) {
      break;
    }

    const content = textCache.get(file.path);
    const size = content ? content.length : 0;
    totalBytes += size;

    if (lines.length < 40) {
      const lineCount = content ? content.split("\n").length : 0;
      lines.push(`${file.path}: ${size} bytes, ${lineCount} lines`);
    }
  }

  return [
    `${files.length} file(s), ${totalBytes} bytes total (scanning capped).`,
    ...lines,
  ].join("\n");
}

function runGitStatusDelegated(
  session: ExternalFolderSession,
  timedOut: { value: boolean },
) {
  // Implemented in git-tools (isomorphic-git); kept here as an allow-listed
  // passthrough so one exec surface covers all checks.
  void timedOut;
  return `git-status delegated: ${session.uri}`;
}

export async function readProjectFilesForExec(
  session: ExternalFolderSession,
  files: { path: string; kind: "directory" | "file" }[],
  maxCharsPerFile = 2_000_000,
) {
  const service = createExternalFolderService();
  textCache.clear();

  for (const file of files) {
    if (file.kind !== "file") {
      continue;
    }

    try {
      const text = await service.readTextFile(session, file.path, maxCharsPerFile);
      textCache.set(file.path, text);
    } catch {
      // binary or unreadable ? leave cache empty for this path
    }
  }
}

export async function runExecCommand(
  session: ExternalFolderSession,
  input: ExecInput,
): Promise<ExecOutput> {
  const path = input.path ?? "";
  const timedOut = { value: false };
  const timeoutHandle = setTimeout(() => {
    timedOut.value = true;
  }, EXEC_TIMEOUT_MS);

  try {
    const budget = { files: MAX_FILES_SCANNED };
    const files = collectFiles(session, path, budget);
    await readProjectFilesForExec(
      session,
      files.filter((entry) => entry.kind === "file"),
    );

    let output: string;

    switch (input.command) {
      case "typecheck-js": {
        output = await runTypecheckJs(session, path, timedOut);
        break;
      }
      case "lint-js": {
        output = runLintJs(session, path, timedOut);
        break;
      }
      case "grep-count": {
        output = runGrepCount(session, path, input.args ?? {}, timedOut);
        break;
      }
      case "file-stats": {
        output = runFileStats(session, path, timedOut);
        break;
      }
      case "git-status": {
        output = runGitStatusDelegated(session, timedOut);
        break;
      }
      default: {
        throw new Error(`Unknown exec command: ${String(input.command)}`);
      }
    }

    const truncated = output.length > MAX_EXEC_OUTPUT_CHARS;

    return {
      command: input.command,
      output: truncated
        ? `${output.slice(0, MAX_EXEC_OUTPUT_CHARS)}\n[truncated]`
        : output,
      path,
      timedOut: timedOut.value,
      truncated,
    };
  } finally {
    clearTimeout(timeoutHandle);
  }
}

export { runTypecheckJs as _runTypecheckJsForTests };
