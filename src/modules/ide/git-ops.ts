/**
 * IDE git operations (§§27-40): status, diff, stage/unstage, commit,
 * push/pull, branches, history, clone, and conflict resolution — all against
 * the active project's persistent local mirror (see saf-fs.ts), with the SAF
 * project tree as the file source of truth.
 *
 * Mirror discipline (explicit, §43):
 * - Reads and index ops run in the mirror after SAF→mirror sync.
 * - Ops that rewrite the workdir (pull, checkout, merge-resolution,
 *   discard, clone) copy back mirror→SAF afterwards and emit the change.
 * - `.git` and dependency dirs (node_modules, .gradle, build, dist, .expo)
 *   never cross into SAF: the mirror owns the git database, SAF owns files.
 * - Remote ops use the fetch-based `isomorphic-git/http/web` client with an
 *   optional auth callback. Progress events stream; op-level cancellation is
 *   NOT supported by isomorphic-git (documented, no fake cancel button).
 *
 * Source provenance: call shapes follow the proven git-tools.ts mirror
 * pattern [AJIRO ORIGINAL]; conflict UX follows Persian-Bot's Git panel
 * behavior [OPEN-SOURCE IMPLEMENTATION, MIT].
 */
import { Directory, File } from "expo-file-system";

import { createExternalFolderService } from "@/core/services/external-folder/external-folder-service";
import { validateProjectPath } from "@/modules/safety/guards";
import {
  createMirrorFs,
  syncProjectToMirror,
  type MirrorFs,
} from "@/modules/tools/git/saf-fs";
import type { ExternalFolderSession } from "@/core/types/app-state";
import {
  hasConflictMarkers,
  parseConflictHunks,
  resolveHunk,
  type ConflictFile,
  type HunkChoice,
} from "@/modules/ide/git-conflicts";
import { validateCloneUrl } from "@/modules/ide/git-validate";

async function loadGit() {
  const bufferModule = await import("buffer");
  if (!(globalThis as Record<string, unknown>).Buffer) {
    (globalThis as unknown as { Buffer: unknown }).Buffer =
      bufferModule.Buffer;
  }
  return import("isomorphic-git");
}

type GitModule = Awaited<ReturnType<typeof loadGit>>;

async function loadHttp() {
  const web = await import("isomorphic-git/http/web");
  return web.default;
}

export type ChangedFileState =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "untracked";

export type GitChangedFile = {
  path: string;
  staged: ChangedFileState | null;
  unstaged: ChangedFileState | null;
  conflicted: boolean;
};

export type GitStatusSummary = {
  isRepo: boolean;
  branch: string | null;
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
  files: GitChangedFile[];
  stagedCount: number;
  unstagedCount: number;
  clean: boolean;
};

export type GitAuth = {
  username?: string;
  token?: string;
};

export type GitProgress = {
  phase: string;
  loaded: number;
  total: number;
};

export type GitCommitInfo = {
  oid: string;
  message: string;
  author: string;
  timestamp: number;
};

export const MIRROR_SKIP_DIRS = new Set([
  "node_modules",
  ".gradle",
  "build",
  "dist",
  ".expo",
]);

function toState(head: number, workdir: number): ChangedFileState | null {
  if (head === 0 && workdir === 2) return "added";
  if (workdir === 0 && head !== 0) return "deleted";
  if (head !== 0 && workdir === 2) return "modified";
  return null;
}

async function withMirror<T>(
  session: ExternalFolderSession,
  action: (fs: MirrorFs, root: Directory, git: GitModule) => Promise<T>,
  options?: { init?: boolean },
): Promise<T> {
  const { root } = await syncProjectToMirror(session);
  const fs = createMirrorFs(root);
  const git = await loadGit();
  // Detection paths must never create a repo; mutating/reading paths keep
  // the established init-if-needed behavior from git-tools.ts.
  if (options?.init !== false) {
    try {
      await git.init({ fs, dir: "/" });
    } catch {
      // already a repo
    }
  }
  return action(fs, root, git);
}

export async function detectRepo(
  session: ExternalFolderSession,
): Promise<{ isRepo: boolean; branch: string | null }> {
  return withMirror(
    session,
    async (fs, _root, git) => {
      try {
        const branch = (await git.currentBranch({ fs, dir: "/" })) ?? null;
        return { isRepo: true, branch };
      } catch {
        return { isRepo: false, branch: null };
      }
    },
    { init: false },
  );
}

export async function getStatus(
  session: ExternalFolderSession,
): Promise<GitStatusSummary> {
  return withMirror(session, async (fs, root, git) => {
    let branch: string | null = null;
    try {
      branch = (await git.currentBranch({ fs, dir: "/" })) ?? null;
    } catch {
      branch = null;
    }
    const matrix = await git.statusMatrix({ fs, dir: "/" });
    const files: GitChangedFile[] = [];
    for (const [file, head, workdir, stage] of matrix) {
      if (file === ".") continue;
      const staged = stage !== head ? toState(head, stage) : null;
      const unstaged =
        workdir !== stage
          ? head === 0 && stage === 0
            ? "untracked"
            : toState(head, workdir)
          : null;
      if (!staged && !unstaged) continue;
      let conflicted = false;
      if (unstaged === "modified" || staged === "modified") {
        try {
          const content = (await fs.readFile(file, {
            encoding: "utf8",
          })) as string;
          conflicted = hasConflictMarkers(content);
        } catch {
          conflicted = false;
        }
      }
      files.push({ path: file, staged, unstaged, conflicted });
    }
    files.sort((a, b) => a.path.localeCompare(b.path));

    let upstream: string | null = null;
    let ahead: number | null = null;
    let behind: number | null = null;
    try {
      const remoteUrl = await git.getConfig({
        fs,
        dir: "/",
        path: "remote.origin.url",
      });
      if (remoteUrl && branch) {
        const tracking = `origin/${branch}`;
        try {
          await git.resolveRef({ fs, dir: "/", ref: tracking });
          upstream = tracking;
          const headOid = await git.resolveRef({ fs, dir: "/", ref: "HEAD" });
          const remoteOid = await git.resolveRef({
            fs,
            dir: "/",
            ref: tracking,
          });
          if (headOid !== remoteOid) {
            const base = await git.findMergeBase({
              fs,
              dir: "/",
              oids: [headOid, remoteOid],
            });
            const headLog = await git.log({ fs, dir: "/", depth: 200 });
            const remoteLog = await git.log({
              fs,
              dir: "/",
              ref: tracking,
              depth: 200,
            });
            ahead = headLog.findIndex((entry) => base.includes(entry.oid));
            behind = remoteLog.findIndex((entry) => base.includes(entry.oid));
            if (ahead < 0) ahead = headLog.length;
            if (behind < 0) behind = remoteLog.length;
          } else {
            ahead = 0;
            behind = 0;
          }
        } catch {
          upstream = null;
        }
      }
    } catch {
      upstream = null;
    }

    const stagedCount = files.filter((file) => file.staged).length;
    const unstagedCount = files.filter((file) => file.unstaged).length;
    return {
      isRepo: true,
      branch,
      upstream,
      ahead,
      behind,
      files,
      stagedCount,
      unstagedCount,
      clean: files.length === 0,
    };
  });
}

export async function getDiff(
  session: ExternalFolderSession,
  path: string,
  staged: boolean,
): Promise<string> {
  const cleanPath = validateProjectPath(path);
  return withMirror(session, async (fs, _root, git) => {
    const { computeLineDiff, formatLineDiff } = await import(
      "@/modules/tools/coding/diff"
    );
    let headText = "";
    try {
      const blob = await git.readBlob({
        fs,
        dir: "/",
        oid: "HEAD",
        filepath: cleanPath,
      });
      headText = new TextDecoder().decode(blob.blob);
    } catch {
      headText = "";
    }
    let compareText = "";
    try {
      compareText = (await fs.readFile(cleanPath, {
        encoding: "utf8",
      })) as string;
    } catch {
      compareText = "";
    }
    if (!headText && !compareText) return "No changes to diff.";
    // When fully staged, workdir content equals the staged content, so the
    // HEAD↔workdir diff IS the staged diff. Mixed staged+unstaged files get
    // an explicit note instead of a mislabeled view.
    let note = "";
    if (staged) {
      const matrix = await git.statusMatrix({ fs, dir: "/" });
      const row = matrix.find(([file]) => file === cleanPath);
      if (row && row[2] !== row[3]) {
        note =
          "\n\n(Note: this file also has unstaged changes; showing workdir content.)";
      }
    }
    return (
      formatLineDiff(cleanPath, computeLineDiff(headText, compareText)) + note
    );
  });
}

export async function stagePaths(
  session: ExternalFolderSession,
  paths: string[],
): Promise<void> {
  const clean = paths.map((path) => validateProjectPath(path));
  await withMirror(session, async (fs, _root, git) => {
    for (const path of clean) {
      await git.add({ fs, dir: "/", filepath: path });
    }
  });
}

export async function stageAll(session: ExternalFolderSession): Promise<void> {
  await withMirror(session, async (fs, _root, git) => {
    const matrix = await git.statusMatrix({ fs, dir: "/" });
    for (const [file, head, workdir] of matrix) {
      if (file === ".") continue;
      if (workdir === 0 && head !== 0) {
        await git.remove({ fs, dir: "/", filepath: file });
      } else if (workdir !== 0 || head === 0) {
        await git.add({ fs, dir: "/", filepath: file });
      }
    }
  });
}

export async function unstagePaths(
  session: ExternalFolderSession,
  paths: string[],
): Promise<void> {
  const clean = paths.map((path) => validateProjectPath(path));
  await withMirror(session, async (fs, _root, git) => {
    for (const path of clean) {
      await git.resetIndex({ fs, dir: "/", filepath: path });
    }
  });
}

export async function unstageAll(session: ExternalFolderSession): Promise<void> {
  await withMirror(session, async (fs, _root, git) => {
    const matrix = await git.statusMatrix({ fs, dir: "/" });
    for (const [file, head, , stage] of matrix) {
      if (file !== "." && stage !== head) {
        await git.resetIndex({ fs, dir: "/", filepath: file });
      }
    }
  });
}

export async function commitChanges(
  session: ExternalFolderSession,
  message: string,
): Promise<string> {
  const cleanMessage = message.trim();
  if (!cleanMessage) throw new Error("Commit message is required.");
  return withMirror(session, async (fs, _root, git) => {
    const sha = await git.commit({
      fs,
      dir: "/",
      author: { name: "Ajiro Agent", email: "agent@ajiro.local" },
      message: cleanMessage,
    });
    return sha;
  });
}

function buildAuthCallback(auth?: GitAuth) {
  if (!auth?.token) return undefined;
  return () => ({
    username: auth.username?.trim() || "git",
    password: auth.token as string,
  });
}

export async function pushChanges(
  session: ExternalFolderSession,
  auth?: GitAuth,
  onProgress?: (progress: GitProgress) => void,
): Promise<{ ok: boolean; message: string }> {
  const http = await loadHttp();
  return withMirror(session, async (fs, _root, git) => {
    try {
      const result = await git.push({
        fs,
        http,
        dir: "/",
        onProgress: onProgress as never,
        onAuth: buildAuthCallback(auth) as never,
        onAuthFailure: () => {
          throw new Error(
            "Authentication failed. Check the stored Git credential.",
          );
        },
      });
      void result;
      return { ok: true, message: "Pushed successfully." };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

export async function pullChanges(
  session: ExternalFolderSession,
  auth?: GitAuth,
  onProgress?: (progress: GitProgress) => void,
): Promise<{ ok: boolean; message: string }> {
  const http = await loadHttp();
  const outcome = await withMirror(session, async (fs, _root, git) => {
    try {
      await git.pull({
        fs,
        http,
        dir: "/",
        onProgress: onProgress as never,
        onAuth: buildAuthCallback(auth) as never,
        onAuthFailure: () => {
          throw new Error(
            "Authentication failed. Check the stored Git credential.",
          );
        },
        author: { name: "Ajiro Agent", email: "agent@ajiro.local" },
      });
      return { ok: true as const, message: "Pulled successfully." };
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  });
  if (outcome.ok) {
    await syncMirrorToProject(session);
  }
  return outcome;
}

export async function listBranches(
  session: ExternalFolderSession,
): Promise<{ current: string | null; local: string[]; remote: string[] }> {
  return withMirror(session, async (fs, _root, git) => {
    const [currentRaw, local, remote] = await Promise.all([
      git.currentBranch({ fs, dir: "/" }).catch(() => null),
      git.listBranches({ fs, dir: "/" }).catch(() => [] as string[]),
      git.listBranches({ fs, dir: "/", remote: "origin" }).catch(() => [] as string[]),
    ]);
    return { current: currentRaw ?? null, local, remote };
  });
}

export async function createBranch(
  session: ExternalFolderSession,
  name: string,
): Promise<void> {
  const cleanName = name.trim();
  if (!cleanName) throw new Error("Branch name is required.");
  await withMirror(session, async (fs, _root, git) => {
    await git.branch({ fs, dir: "/", ref: cleanName });
  });
}

export async function checkoutBranch(
  session: ExternalFolderSession,
  ref: string,
): Promise<{ switched: boolean; needsConfirm: boolean }> {
  const cleanRef = ref.trim();
  if (!cleanRef) throw new Error("Branch name is required.");
  const dirty = await withMirror(session, async (fs, _root, git) => {
    const matrix = await git.statusMatrix({ fs, dir: "/" });
    return matrix.some(
      ([file, head, workdir, stage]) =>
        file !== "." && ((head !== 0 && workdir === 2) || stage !== head),
    );
  });
  if (dirty) {
    return { switched: false, needsConfirm: true };
  }
  await withMirror(session, async (fs, _root, git) => {
    await git.checkout({ fs, dir: "/", ref: cleanRef });
  });
  await syncMirrorToProject(session);
  return { switched: true, needsConfirm: false };
}

export async function deleteBranch(
  session: ExternalFolderSession,
  ref: string,
): Promise<void> {
  const cleanRef = ref.trim();
  if (!cleanRef) throw new Error("Branch name is required.");
  await withMirror(session, async (fs, _root, git) => {
    await git.deleteBranch({ fs, dir: "/", ref: cleanRef });
  });
}

export async function getHistory(
  session: ExternalFolderSession,
  depth = 30,
): Promise<GitCommitInfo[]> {
  return withMirror(session, async (fs, _root, git) => {
    const commits = await git.log({
      fs,
      dir: "/",
      depth: Math.min(Math.max(depth, 1), 50),
    });
    return commits.map((commit) => ({
      oid: commit.oid,
      message: commit.commit.message.split("\n")[0] ?? "",
      author: commit.commit.author.name,
      timestamp: commit.commit.author.timestamp,
    }));
  });
}

export async function getRemoteUrl(
  session: ExternalFolderSession,
): Promise<string | null> {
  return withMirror(session, async (fs, _root, git) => {
    try {
      const url = await git.getConfig({
        fs,
        dir: "/",
        path: "remote.origin.url",
      });
      return typeof url === "string" && url ? url : null;
    } catch {
      return null;
    }
  });
}

/** Point `origin` at a new URL (creates the remote entry if missing). */
export async function setRemoteUrl(
  session: ExternalFolderSession,
  url: string,
): Promise<void> {
  const trimmed = url.trim();
  if (!trimmed) throw new Error("Enter a remote URL.");
  const { parseRemoteRepo } = await import("@/modules/ide/git-display");
  if (!parseRemoteRepo(trimmed)) {
    throw new Error("That remote URL is not valid.");
  }
  return withMirror(session, async (fs, _root, git) => {
    await git.setConfig({
      fs,
      dir: "/",
      path: "remote.origin.url",
      value: trimmed,
    });
  });
}

export type CommitAuthor = {
  name: string | null;
  email: string | null;
};

/** Read the repo-local commit identity (`user.name` / `user.email`). */
export async function getCommitAuthor(
  session: ExternalFolderSession,
): Promise<CommitAuthor> {
  return withMirror(session, async (fs, _root, git) => {
    const [name, email] = await Promise.all([
      git.getConfig({ fs, dir: "/", path: "user.name" }).catch(() => null),
      git.getConfig({ fs, dir: "/", path: "user.email" }).catch(() => null),
    ]);
    return {
      name: typeof name === "string" && name.trim() ? name.trim() : null,
      email: typeof email === "string" && email.trim() ? email.trim() : null,
    };
  });
}

/** Write the repo-local commit identity. */
export async function setCommitAuthor(
  session: ExternalFolderSession,
  name: string,
  email: string,
): Promise<void> {
  if (!name.trim()) throw new Error("Author name is required.");
  if (!email.trim()) throw new Error("Author email is required.");
  return withMirror(session, async (fs, _root, git) => {
    await git.setConfig({ fs, dir: "/", path: "user.name", value: name.trim() });
    await git.setConfig({
      fs,
      dir: "/",
      path: "user.email",
      value: email.trim(),
    });
  });
}

export type CloneRequest = {
  url: string;
  branch?: string;
  depth?: number;
  /**
   * The destination session: the user-picked, EMPTY folder that becomes the
   * project root. Cloning fills it; registration happens in the caller only
   * on success.
   */
  destSession: ExternalFolderSession;
  auth?: GitAuth;
  onProgress?: (progress: GitProgress) => void;
};

/**
 * Clones into the destination's persistent mirror, then copies the working
 * files (minus .git and dependency dirs) into the SAF destination, which
 * must be empty. Throws with actionable messages; never registers partial
 * state (registration happens in the caller only on success).
 */
export async function cloneRepository(
  request: CloneRequest,
): Promise<{ defaultBranch: string | null }> {
  const validated = validateCloneUrl(request.url);
  if (!validated.ok) throw new Error(validated.error);
  const http = await loadHttp();
  const service = createExternalFolderService();
  const existing = service.listEntries(request.destSession, "");
  if (existing.length > 0) {
    throw new Error("The destination folder is not empty.");
  }
  const { root } = await syncProjectToMirror(request.destSession);
  if (root.exists) {
    root.delete();
  }
  root.create();
  const fs = createMirrorFs(root);
  const git = await loadGit();
  try {
    await git.clone({
      fs,
      http,
      dir: "/",
      url: request.url.trim(),
      ref: request.branch?.trim() || undefined,
      singleBranch: Boolean(request.branch?.trim()),
      depth: request.depth ?? undefined,
      onProgress: request.onProgress as never,
      onAuth: buildAuthCallback(request.auth) as never,
      onAuthFailure: () => {
        throw new Error(
          "Authentication failed. Check the repository URL and credential.",
        );
      },
    });
  } catch (error) {
    try {
      root.delete();
    } catch {
      // best-effort cleanup so no partial clone lingers
    }
    throw error instanceof Error ? error : new Error(String(error));
  }
  await copyMirrorToSaf(request.destSession, root);
  let defaultBranch: string | null = null;
  try {
    defaultBranch = (await git.currentBranch({ fs, dir: "/" })) ?? null;
  } catch {
    defaultBranch = null;
  }
  return { defaultBranch };
}

export async function copyMirrorToSaf(
  session: ExternalFolderSession,
  root: Directory,
): Promise<{ written: number }> {
  const service = createExternalFolderService();
  let written = 0;
  const walk = async (dir: Directory, relative: string): Promise<void> => {
    for (const child of dir.list()) {
      if (child.name === ".git" || MIRROR_SKIP_DIRS.has(child.name)) continue;
      const childRelative = relative ? `${relative}/${child.name}` : child.name;
      if (child instanceof Directory) {
        try {
          await service.createDirectory(session, childRelative);
        } catch {
          // already exists
        }
        await walk(child, childRelative);
      } else {
        await service.writeBytesFile(session, childRelative, await child.bytes());
        written += 1;
      }
    }
  };
  await walk(root, "");
  return { written };
}

/**
 * Copies mirror → SAF after workdir-rewriting ops (pull, checkout, merge
 * resolution, discard). Writes new/changed files, deletes SAF entries that
 * vanished from the mirror. Dependency dirs and .git never cross.
 */
export async function syncMirrorToProject(
  session: ExternalFolderSession,
): Promise<{ written: number; deleted: number }> {
  const service = createExternalFolderService();
  const { root } = await syncProjectToMirror(session);
  const mirrorFiles = new Map<string, number>();
  const collect = (dir: Directory, relative: string): void => {
    for (const child of dir.list()) {
      if (child.name === ".git" || MIRROR_SKIP_DIRS.has(child.name)) continue;
      const childRelative = relative ? `${relative}/${child.name}` : child.name;
      if (child instanceof Directory) {
        collect(child, childRelative);
      } else {
        mirrorFiles.set(childRelative, child.size ?? -1);
      }
    }
  };
  collect(root, "");

  // SAF sizes first: unchanged files (size match) are skipped, mirroring the
  // size heuristic syncProjectToMirror already uses.
  const safSizes = new Map<string, number | null>();
  const walkSafSizes = (dirPath: string): void => {
    for (const entry of service.listEntries(session, dirPath)) {
      if (MIRROR_SKIP_DIRS.has(entry.name)) continue;
      if (entry.kind === "file") {
        safSizes.set(entry.path, entry.size);
      } else {
        walkSafSizes(entry.path);
      }
    }
  };
  walkSafSizes("");

  let written = 0;
  const ensureParents = async (relativePath: string): Promise<void> => {
    const parts = relativePath.split("/").slice(0, -1);
    let prefix = "";
    for (const part of parts) {
      prefix = prefix ? `${prefix}/${part}` : part;
      try {
        await service.createDirectory(session, prefix);
      } catch {
        // already exists
      }
    }
  };
  for (const [relative, size] of mirrorFiles) {
    if (size >= 0 && safSizes.get(relative) === size) continue;
    const target = new File(root, relative);
    try {
      await ensureParents(relative);
      await service.writeBytesFile(session, relative, await target.bytes());
      written += 1;
    } catch {
      // unreadable mirror file: skip rather than corrupt the project
    }
  }

  let deleted = 0;
  const safEntries: { path: string; kind: "directory" | "file" }[] = [];
  const walkSaf = (dirPath: string): void => {
    for (const entry of service.listEntries(session, dirPath)) {
      if (MIRROR_SKIP_DIRS.has(entry.name)) continue;
      safEntries.push({ path: entry.path, kind: entry.kind });
      if (entry.kind === "directory") walkSaf(entry.path);
    }
  };
  walkSaf("");
  for (const entry of safEntries.reverse()) {
    if (entry.kind === "file" && !mirrorFiles.has(entry.path)) {
      try {
        await service.deleteEntry(session, entry.path, false);
        deleted += 1;
      } catch {
        // already gone
      }
    }
  }
  return { written, deleted };
}

export async function findConflicts(
  session: ExternalFolderSession,
): Promise<ConflictFile[]> {
  return withMirror(session, async (fs, _root, git) => {
    const matrix = await git.statusMatrix({ fs, dir: "/" });
    const out: ConflictFile[] = [];
    for (const [file, head, workdir] of matrix) {
      if (file === "." || head === 0 || workdir !== 2) continue;
      let text = "";
      try {
        text = (await fs.readFile(file, { encoding: "utf8" })) as string;
      } catch {
        continue;
      }
      if (text.length > 500_000) continue;
      if (!hasConflictMarkers(text)) continue;
      const parsed = parseConflictHunks(file, text);
      if (parsed.hunks.length > 0) out.push(parsed);
    }
    return out;
  });
}

export async function resolveConflict(
  session: ExternalFolderSession,
  path: string,
  hunkIndex: number,
  choice: HunkChoice,
): Promise<void> {
  const cleanPath = validateProjectPath(path);
  await withMirror(session, async (fs, _root, git) => {
    const text = (await fs.readFile(cleanPath, {
      encoding: "utf8",
    })) as string;
    const parsed = parseConflictHunks(cleanPath, text);
    const hunk = parsed.hunks.find((entry) => entry.index === hunkIndex);
    if (!hunk) throw new Error("Conflict hunk not found.");
    const lines = text.split("\n");
    const next = [
      ...lines.slice(0, hunk.startLine - 1),
      ...resolveHunk(hunk, choice),
      ...lines.slice(hunk.endLine),
    ].join("\n");
    await fs.writeFile(cleanPath, next);
    await git.add({ fs, dir: "/", filepath: cleanPath });
  });
  await syncMirrorToProject(session);
}

export async function discardPaths(
  session: ExternalFolderSession,
  paths: string[],
): Promise<void> {
  const clean = paths.map((path) => validateProjectPath(path));
  const service = createExternalFolderService();
  await withMirror(session, async (fs, _root, git) => {
    const matrix = await git.statusMatrix({ fs, dir: "/" });
    const byPath = new Map(matrix.map((row) => [row[0], row]));
    for (const path of clean) {
      const row = byPath.get(path);
      const head = row?.[1] ?? 0;
      if (head !== 0) {
        await git.checkout({ fs, dir: "/", force: true, filepaths: [path] });
      } else {
        try {
          await fs.unlink(path);
        } catch {
          // already absent in mirror
        }
        try {
          await service.deleteEntry(session, path, false);
        } catch {
          // already absent in SAF
        }
      }
    }
  });
  await syncMirrorToProject(session);
}

export type { ConflictFile, HunkChoice };
