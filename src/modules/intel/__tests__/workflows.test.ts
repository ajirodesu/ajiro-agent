import { describe, expect, it } from "vitest";

import { buildRunCommand, parseCompilerOutput } from "@/modules/intel/terminal";
import { detectTestFramework, isTestFile } from "@/modules/intel/test-frameworks";
import { collectFixContext, previewProposal, proposeFix } from "@/modules/intel/ai-fix";
import { conflictDiagnosticsFor, nearestConflictLine } from "@/modules/intel/git-intel";
import { hasDebuggerBackend } from "@/modules/intel/debugger";
import { searchIntelCommands } from "@/modules/intel/commands";

describe("terminal command builders", () => {
  const project = { packageManager: "npm" as const, scripts: { dev: "expo start", test: "vitest run" } };
  it("builds run/build/test commands from signals", () => {
    expect(buildRunCommand("/p", { kind: "run-file", file: "a.py" }, project)?.argv).toEqual(["a.py"]);
    expect(buildRunCommand("/p", { kind: "run-file", file: "a.ts" }, project)?.command).toBe("npm");
    expect(buildRunCommand("/p", { kind: "build" }, { packageManager: null, scripts: {} })).toBeNull();
    expect(buildRunCommand("/p", { kind: "lint" }, { packageManager: null, scripts: {} })?.argv).toContain("--noEmit");
    expect(buildRunCommand("/p", { kind: "test-project" }, project)?.argv).toEqual(["run", "test"]);
  });
});

describe("compiler output parser", () => {
  it("parses tsc output with file/line/column", () => {
    const results = parseCompilerOutput(
      `src/a.ts(3,7): error TS2322: Type 'string' is not assignable.\nnot a diagnostic line`,
      "/project",
    );
    expect(results).toHaveLength(1);
    expect(results[0]?.file).toBe("/project/src/a.ts");
    expect(results[0]?.diagnostic.range.start).toEqual({ line: 3, column: 7 });
    expect(results[0]?.diagnostic.code).toBe(2322);
  });

  it("parses gcc and pytest styles", () => {
    const results = parseCompilerOutput(
      "main.c:10:5: warning: unused variable\ntest_x.py:4: assert failed",
      "/project",
    );
    expect(results.map((result) => result.diagnostic.source).sort()).toEqual(["compiler", "pytest"]);
  });
});

describe("test framework detection", () => {
  it("detects vitest/jest/pytest/go/cargo from signals", () => {
    const vitest = detectTestFramework({
      files: ["vitest.config.ts"],
      packageJson: { dependencies: [], devDependencies: ["vitest"], scripts: {} },
    });
    expect(vitest.framework).toBe("vitest");
    expect(isTestFile("src/a.test.ts", vitest)).toBe(true);
    expect(
      detectTestFramework({ files: ["jest.config.js"], packageJson: null }).framework,
    ).toBe("jest");
    expect(
      detectTestFramework({ files: ["tests/test_x.py"], packageJson: null }).framework,
    ).toBe("pytest");
    expect(detectTestFramework({ files: ["go.mod"], packageJson: null }).framework).toBe("go-test");
    expect(detectTestFramework({ files: ["Cargo.toml"], packageJson: null }).framework).toBe("cargo-test");
    expect(detectTestFramework({ files: ["README.md"], packageJson: null }).framework).toBe("unknown");
  });
});

describe("AI fix workflow", () => {
  it("collects context, previews, and applies with approval", async () => {
    const text = "line1\nconst x: number = 'oops';\nline3";
    const context = collectFixContext(
      "a.ts",
      text,
      {
        severity: "error",
        message: "Type error",
        source: "ts-semantic",
        code: 2322,
        range: { start: { line: 2, column: 1 }, end: { line: 2, column: 10 } },
        related: [],
        fixable: true,
      },
    );
    expect(context.contextText).toContain("oops");
    const session = await proposeFix(
      {
        propose: (fixContext) =>
          Promise.resolve({
            preview: [],
            edits: [
              {
                uri: fixContext.uri,
                range: { start: { line: 2, column: 17 }, end: { line: 2, column: 23 } },
                newText: "42",
              },
            ],
            explanation: "Use a number literal",
          }),
      },
      context,
    );
    const files = new Map([["a.ts", text]]);
    expect(previewProposal(files, session)).toHaveLength(1);
    const { applyProposal } = await import("@/modules/intel/ai-fix");
    const result = applyProposal(files, session);
    expect(files.get("a.ts")).toContain("42");
    expect(result?.applied).toHaveLength(1);
  });
});

describe("git conflict intel", () => {
  const text = ["a", "<<<<<<< HEAD", "ours", "=======", "theirs", ">>>>>>> branch", "b"].join("\n");
  it("emits one diagnostic per hunk and navigates", () => {
    const { file, diagnostics } = conflictDiagnosticsFor("a.ts", text);
    expect(file?.hunks).toHaveLength(1);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.hunkIndex).toBe(0);
    expect(nearestConflictLine([2], 1, 1)).toBe(2);
    expect(nearestConflictLine([2], 5, -1)).toBe(2);
    expect(nearestConflictLine([], 1, 1)).toBeNull();
  });
});

describe("debugger foundation honesty", () => {
  it("reports no backend until a real one registers", () => {
    expect(hasDebuggerBackend()).toBe(false);
  });
});

describe("command registry search", () => {
  it("finds commands by title or id", () => {
    expect(searchIntelCommands("rename")).toHaveLength(1);
    expect(searchIntelCommands("")).not.toHaveLength(0);
    expect(searchIntelCommands("no-such-command")).toHaveLength(0);
  });
});
