import { describe, expect, it } from "vitest";

import {
  emptyManifest,
  hashBytes,
  syncTrees,
  type SyncEntry,
  type SyncTree,
} from "@/runtime/workspaceSync";

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/** In-memory SyncTree fake (map of path → file bytes; dirs derived). */
function memTree(initial: Record<string, string> = {}): SyncTree & {
  dump(): Record<string, string>;
  failOn: Set<string>;
} {
  const files = new Map<string, Uint8Array>(
    Object.entries(initial).map(([path, text]) => [path, encode(text)]),
  );
  const failOn = new Set<string>();
  const tree: SyncTree & { dump(): Record<string, string>; failOn: Set<string> } = {
    failOn,
    dump() {
      return Object.fromEntries(
        [...files.entries()].map(([path, bytes]) => [path, decode(bytes)]),
      );
    },
    async listAll(): Promise<SyncEntry[]> {
      const entries: SyncEntry[] = [];
      const dirs = new Set<string>();
      for (const [path, bytes] of files) {
        entries.push({ path, kind: "file", size: bytes.length });
        const segments = path.split("/");
        for (let i = 1; i < segments.length; i += 1) {
          dirs.add(segments.slice(0, i).join("/"));
        }
      }
      for (const dir of dirs) {
        if (!files.has(dir)) entries.push({ path: dir, kind: "dir", size: 0 });
      }
      return entries;
    },
    async readFile(path: string): Promise<Uint8Array> {
      if (failOn.has(path)) throw new Error(`unreadable: ${path}`);
      const bytes = files.get(path);
      if (!bytes) throw new Error(`missing: ${path}`);
      return bytes.slice();
    },
    async writeFile(path: string, data: Uint8Array): Promise<void> {
      if (failOn.has(path)) throw new Error(`unwritable: ${path}`);
      files.set(path, data.slice());
    },
    async mkdir(_path: string): Promise<void> {
      // Implicit in the map model.
    },
  };
  return tree;
}

describe("workspaceSync", () => {
  it("copies project files into an empty workspace (in)", async () => {
    const project = memTree({ "a.txt": "hello", "sub/b.txt": "world" });
    const workspace = memTree();
    const report = await syncTrees(project, workspace, { direction: "in" });
    expect(report.copiedIn).toBe(2);
    expect(report.copiedOut).toBe(0);
    expect(workspace.dump()).toEqual({ "a.txt": "hello", "sub/b.txt": "world" });
  });

  it("copies workspace files back to the project (out)", async () => {
    const project = memTree({ "a.txt": "hello" });
    const workspace = memTree({ "a.txt": "hello", "new.txt": "from-shell" });
    const report = await syncTrees(project, workspace, { direction: "out" });
    expect(report.copiedOut).toBe(1);
    expect(project.dump()["new.txt"]).toBe("from-shell");
  });

  it("is a no-op in steady state and refreshes the manifest", async () => {
    const project = memTree({ "a.txt": "hello" });
    const workspace = memTree();
    const first = await syncTrees(project, workspace, { direction: "in" });
    expect(first.copiedIn).toBe(1);
    const second = await syncTrees(project, workspace, {
      direction: "in",
      manifest: first.manifest,
    });
    expect(second.copiedIn).toBe(0);
    expect(second.copiedOut).toBe(0);
    expect(second.skipped).toEqual([]);
  });

  it("propagates content changes by size and by bytes", async () => {
    const project = memTree({ "a.txt": "hello", "b.txt": "1234" });
    const workspace = memTree({ "a.txt": "hello!", "b.txt": "1235" });
    const report = await syncTrees(project, workspace, { direction: "in" });
    expect(report.copiedIn).toBe(2);
    expect(workspace.dump()).toEqual({ "a.txt": "hello", "b.txt": "1234" });
  });

  it("resolves both-directions conflicts in favor of the project", async () => {
    const project = memTree({ "a.txt": "project-v2" });
    const workspace = memTree({ "a.txt": "shell-v2!" });
    const seed = await syncTrees(project, workspace, { direction: "in" });
    expect(seed.copiedIn).toBe(1);
    // Diverge both sides after the seed manifest (same length, new bytes).
    const divergedProject = memTree({ "a.txt": "project-v3" });
    const divergedWorkspace = memTree({ "a.txt": "shell-v3!!" });
    const report = await syncTrees(divergedProject, divergedWorkspace, {
      direction: "both",
      manifest: seed.manifest,
    });
    expect(report.conflicts).toEqual(["a.txt"]);
    expect(divergedWorkspace.dump()["a.txt"]).toBe("project-v3");
  });

  it("copies the single changed side in both mode without conflict", async () => {
    const project = memTree({ "a.txt": "v1" });
    const workspace = memTree();
    const seed = await syncTrees(project, workspace, { direction: "in" });
    const evolvedWorkspace = memTree({ "a.txt": "v1-shell-edit" });
    const report = await syncTrees(project, evolvedWorkspace, {
      direction: "both",
      manifest: seed.manifest,
    });
    expect(report.conflicts).toEqual([]);
    expect(report.copiedOut).toBe(1);
    expect(project.dump()["a.txt"]).toBe("v1-shell-edit");
  });

  it("ignores build artifact and VCS directories", async () => {
    const project = memTree({
      "src/index.ts": "code",
      "node_modules/dep/x.js": "dep",
      ".git/HEAD": "ref",
    });
    const workspace = memTree();
    const report = await syncTrees(project, workspace, { direction: "in" });
    expect(report.copiedIn).toBe(1);
    expect(workspace.dump()).toEqual({ "src/index.ts": "code" });
  });

  it("skips oversized files and caps file counts honestly", async () => {
    const project = memTree({ "big.bin": "x".repeat(100), "small.txt": "s" });
    const workspace = memTree();
    const capped = await syncTrees(project, workspace, {
      direction: "in",
      maxFileBytes: 10,
    });
    expect(capped.copiedIn).toBe(1);
    expect(capped.skipped.some((entry) => entry.path === "big.bin")).toBe(true);

    const many: Record<string, string> = {};
    for (let i = 0; i < 10; i += 1) many[`f${i}.txt`] = "x";
    const limited = await syncTrees(memTree(many), memTree(), {
      direction: "in",
      maxFiles: 3,
    });
    expect(limited.truncated).toBe(true);
    expect(limited.copiedIn).toBe(3);
  });

  it("never deletes extras on either side", async () => {
    const project = memTree({ "keep.txt": "p" });
    const workspace = memTree({ "keep.txt": "p", "scratch.txt": "s" });
    const report = await syncTrees(project, workspace, { direction: "in" });
    expect(report.copiedIn).toBe(0);
    expect(workspace.dump()["scratch.txt"]).toBe("s");
  });

  it("records per-file failures without aborting the sync", async () => {
    const project = memTree({ "good.txt": "ok", "bad.txt": "nope" });
    project.failOn.add("bad.txt");
    const workspace = memTree();
    const report = await syncTrees(project, workspace, { direction: "in" });
    expect(report.copiedIn).toBe(1);
    expect(report.skipped.some((entry) => entry.path === "bad.txt")).toBe(true);
  });

  it("reports progress per file", async () => {
    const project = memTree({ "a.txt": "1", "b.txt": "2" });
    const seen: [number, number][] = [];
    await syncTrees(project, memTree(), {
      direction: "in",
      onProgress: (done, total) => {
        seen.push([done, total]);
      },
    });
    expect(seen[seen.length - 1]).toEqual([2, 2]);
  });

  it("hashes content deterministically", () => {
    expect(hashBytes(encode("abc"))).toBe(hashBytes(encode("abc")));
    expect(hashBytes(encode("abc"))).not.toBe(hashBytes(encode("abd")));
  });

  it("starts from an empty manifest cleanly", () => {
    expect(emptyManifest()).toEqual({ version: 1, files: {} });
  });
});
