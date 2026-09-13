import { describe, expect, it } from "vitest";

import {
  flattenTree,
  matchesTreeQuery,
  parentOfPath,
  sortTreeEntries,
  type TreeEntry,
} from "@/modules/ide/file-tree";
import { validateBranchName, validateCloneUrl } from "@/modules/ide/git-validate";
import {
  applyHunkResolution,
  hasConflictMarkers,
  parseConflictHunks,
  resolveHunk,
} from "@/modules/ide/git-conflicts";
import {
  findAllMatches,
  offsetToLineCol,
  pushUndo,
  redoEdit,
  replaceAllOccurrences,
  undoEdit,
} from "@/modules/editor/text-ops";

describe("clone validation", () => {
  it("accepts https owner/repo urls", () => {
    expect(validateCloneUrl("https://github.com/acme/app.git")).toEqual({
      ok: true,
      host: "github.com",
      repoName: "app",
    });
    expect(validateCloneUrl("https://gitlab.com/a/b/c")).toMatchObject({
      ok: true,
    });
  });

  it("rejects everything unsafe or malformed", () => {
    expect(validateCloneUrl("").ok).toBe(false);
    expect(validateCloneUrl("not a url").ok).toBe(false);
    expect(validateCloneUrl("git@github.com:a/b.git").ok).toBe(false);
    expect(validateCloneUrl("http://github.com/a/b").ok).toBe(false);
    expect(validateCloneUrl("https://github.com/onlyone").ok).toBe(false);
    expect(validateCloneUrl("https://github.com/a/b with space").ok).toBe(
      false,
    );
  });

  it("validates branch names", () => {
    expect(validateBranchName("feature/x")).toBeNull();
    expect(validateBranchName("")).toBeNull();
    expect(validateBranchName("a..b")).not.toBeNull();
    expect(validateBranchName("-x")).not.toBeNull();
  });
});

describe("conflict markers", () => {
  const conflicted = [
    "top",
    "<<<<<<< HEAD",
    "ours line",
    "=======",
    "theirs line",
    ">>>>>>> branch",
    "bottom",
  ].join("\n");

  it("detects and parses hunks", () => {
    expect(hasConflictMarkers(conflicted)).toBe(true);
    expect(hasConflictMarkers("plain\ntext")).toBe(false);
    const file = parseConflictHunks("a.ts", conflicted);
    expect(file.hunks.length).toBe(1);
    expect(file.hunks[0]).toMatchObject({
      ours: ["ours line"],
      theirs: ["theirs line"],
    });
  });

  it("resolves every choice without auto-picking", () => {
    const file = parseConflictHunks("a.ts", conflicted);
    const hunk = file.hunks[0]!;
    expect(resolveHunk(hunk, { kind: "current" })).toEqual(["ours line"]);
    expect(resolveHunk(hunk, { kind: "incoming" })).toEqual(["theirs line"]);
    expect(resolveHunk(hunk, { kind: "both" })).toEqual([
      "ours line",
      "theirs line",
    ]);
    const rebuilt = applyHunkResolution(conflicted, hunk, ["merged"]);
    expect(rebuilt).toBe(["top", "merged", "bottom"].join("\n"));
  });
});

describe("file tree", () => {
  const entries: TreeEntry[] = [
    { path: "b.ts", name: "b.ts", kind: "file" },
    { path: "src", name: "src", kind: "directory" },
    { path: "a.ts", name: "a.ts", kind: "file" },
  ];

  it("sorts directories first, names naturally", () => {
    expect(sortTreeEntries(entries).map((entry) => entry.name)).toEqual([
      "src",
      "a.ts",
      "b.ts",
    ]);
  });

  it("flattens only expanded branches", () => {
    const children = {
      "": entries,
      src: [{ path: "src/x.ts", name: "x.ts", kind: "file" } as TreeEntry],
    };
    expect(flattenTree(children, new Set()).map((row) => row.path)).toEqual([
      "src",
      "a.ts",
      "b.ts",
    ]);
    const open = flattenTree(children, new Set(["src"]));
    expect(open.map((row) => `${row.depth}:${row.path}`)).toEqual([
      "0:src",
      "1:src/x.ts",
      "0:a.ts",
      "0:b.ts",
    ]);
  });

  it("matches queries and crumbs", () => {
    expect(
      matchesTreeQuery({ path: "src/App.tsx", name: "App.tsx", kind: "file" }, "app"),
    ).toBe(true);
    expect(
      matchesTreeQuery({ path: "src/App.tsx", name: "App.tsx", kind: "file" }, "zzz"),
    ).toBe(false);
    expect(parentOfPath("src/a.ts")).toBe("src");
    expect(parentOfPath("a.ts")).toBe("");
  });
});

describe("editor text ops", () => {
  it("finds and replaces all occurrences", () => {
    expect(findAllMatches("aaa", "a", true)).toEqual([
      { start: 0, end: 1 },
      { start: 1, end: 2 },
      { start: 2, end: 3 },
    ]);
    expect(findAllMatches("Hello hello", "hello", false).length).toBe(2);
    expect(findAllMatches("Hello", "hello", true).length).toBe(0);
    expect(replaceAllOccurrences("a a a", "a", "b", true)).toEqual({
      text: "b b b",
      count: 3,
    });
    expect(offsetToLineCol("ab\ncde", 4)).toEqual({ line: 2, column: 2 });
  });

  it("walks a bounded undo/redo stack", () => {
    let state = { past: [] as string[], future: [] as string[] };
    state = pushUndo(state, "v1");
    state = pushUndo(state, "v2");
    const undone = undoEdit(state, "v3");
    expect(undone.text).toBe("v2");
    const redone = redoEdit(undone.state, undone.text);
    expect(redone.text).toBe("v3");
    const noop = undoEdit({ past: [], future: [] }, "same");
    expect(noop.text).toBe("same");
  });
});
