/**
 * Canonical exec allow-list (stable command IDs + descriptions). Kept in a
 * leaf module with no native/platform imports so the terminal adapter, the
 * coding tools, and settings screens can reference it anywhere — including
 * unit tests. The implementations live in ./exec.
 */
import type { CodingExecCommandId } from "@/core/services/coding/coding-settings";

export const EXEC_COMMAND_IDS: CodingExecCommandId[] = [
  "typecheck-js",
  "lint-js",
  "grep-count",
  "file-stats",
  "git-status",
];

export const EXEC_COMMAND_DESCRIPTIONS: Record<CodingExecCommandId, string> = {
  "typecheck-js":
    "Parse every JS/TS/JSX/TSX file under a path with @babel/parser (TypeScript + JSX plugins) and report syntax errors. Not a full type checker — it catches syntax-level breakage.",
  "lint-js":
    "Basic structural lint over JS/TS files under a path: unused imports, `var` usage, `debugger`/`console.log` statements, empty catch blocks.",
  "grep-count":
    "Count regex matches per file under a path. In-process ripgrep-style check.",
  "file-stats":
    "Report file/dir sizes and line counts under a path.",
  "git-status":
    "Report isomorphic-git status (added/modified/deleted files) for the project.",
};
