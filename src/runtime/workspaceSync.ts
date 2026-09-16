/**
 * Project ↔ Linux `/workspace` bidirectional sync (pure core, unit-tested).
 *
 * The agent's project files live in SAF storage (content URIs — no POSIX
 * path, so PRoot cannot bind-mount them). The Linux userspace instead sees a
 * plain directory at `<rootfs>/workspace`. This module reconciles the two
 * trees so the interactive terminal and headless `shell` tool observe the
 * same files the agent's file tools do:
 *
 * - direction `"in"`:  SAF project → `/workspace` (before shell execution,
 *   on terminal open).
 * - direction `"out"`: `/workspace` → SAF project (after shell execution,
 *   on terminal close) — brings back agent-created/modified files.
 * - direction `"both"`: in-phase then out-phase with conflict detection.
 *
 * Safety posture (deliberate, documented):
 * - NEVER deletes: extras on either side are left alone.
 * - Conflicts (both sides changed since the last manifest) resolve in favor
 *   of the SAF project and are reported — shell output is scratch, the
 *   user's granted folder is authoritative.
 * - Default ignores mirror the exec scanner (`node_modules`, `.git`,
 *   build outputs, …), plus size/file-count caps with honest reports.
 * - Change detection is size + FNV-1a content hash (no mtime: SAF entries
 *   don't expose one). The manifest persists last-synced state so steady
 *   state syncs are cheap after the first full pass.
 *
 * This file is platform-free (operates on the `SyncTree` interface), so the
 * whole reconciliation algorithm runs in unit tests with in-memory fakes.
 * Device bindings live in `workspaceSyncAdapters.ts`.
 */

export interface SyncEntry {
  /** Relative POSIX path (`a/b/c.txt`), never leading/trailing slashes. */
  path: string;
  kind: "file" | "dir";
  size: number;
}

export interface SyncTree {
  /** Recursive listing of files AND directories (relative paths). */
  listAll(): Promise<SyncEntry[]>;
  readFile(path: string): Promise<Uint8Array>;
  /** Writes bytes, creating parent directories as needed. */
  writeFile(path: string, data: Uint8Array): Promise<void>;
  /** Recursive, idempotent mkdir. */
  mkdir(path: string): Promise<void>;
}

export type SyncDirection = "in" | "out" | "both";

export interface SyncManifestFile {
  size: number;
  hash: string;
}

export interface SyncManifest {
  version: 1;
  files: Record<string, SyncManifestFile>;
}

export interface SyncOptions {
  direction: SyncDirection;
  ignoreDirs?: string[];
  ignoreFiles?: string[];
  maxFileBytes?: number;
  maxFiles?: number;
  manifest?: SyncManifest | null;
  onProgress?: (doneFiles: number, totalFiles: number) => void;
}

export interface SyncSkipped {
  path: string;
  reason: string;
}

export interface SyncReport {
  copiedIn: number;
  copiedOut: number;
  skipped: SyncSkipped[];
  /** Both sides changed since the manifest; project version kept. */
  conflicts: string[];
  bytesTransferred: number;
  truncated: boolean;
  manifest: SyncManifest;
}

export const SYNC_MANIFEST_NAME = ".ajiro-sync.json";

export const DEFAULT_SYNC_IGNORE_DIRS: readonly string[] = [
  "node_modules",
  ".git",
  ".gradle",
  "build",
  "dist",
  ".expo",
  "__pycache__",
  ".venv",
  ".idea",
  ".vscode",
  // Runtime scratch for skill script staging (never project content).
  ".ajiro-skills",
];

export const DEFAULT_MAX_FILE_BYTES = 8 * 1024 * 1024;
export const DEFAULT_MAX_FILES = 5000;

export function emptyManifest(): SyncManifest {
  return { version: 1, files: {} };
}

/** FNV-1a 32-bit: fast content fingerprint for change detection. */
export function hashBytes(data: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < data.length; i += 1) {
    hash ^= data[i] ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function normalizeRel(path: string): string | null {
  const parts = path
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part !== ".");
  if (parts.length === 0) return null;
  if (parts.some((part) => part === "..")) return null;
  return parts.join("/");
}

function isIgnored(
  normalized: string,
  ignoreDirs: readonly string[],
  ignoreFiles: readonly string[],
): boolean {
  const segments = normalized.split("/");
  if (segments.some((segment) => ignoreDirs.includes(segment))) return true;
  const base = segments[segments.length - 1] ?? "";
  return ignoreFiles.includes(base);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export async function syncTrees(
  project: SyncTree,
  workspace: SyncTree,
  options: SyncOptions,
): Promise<SyncReport> {
  const ignoreDirs = options.ignoreDirs ?? DEFAULT_SYNC_IGNORE_DIRS;
  const ignoreFiles = options.ignoreFiles ?? [SYNC_MANIFEST_NAME];
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const prevManifest = options.manifest ?? null;

  const [projectEntries, workspaceEntries] = await Promise.all([
    project.listAll(),
    workspace.listAll(),
  ]);

  const projectMap = new Map<string, SyncEntry>();
  const workspaceMap = new Map<string, SyncEntry>();
  for (const entry of projectEntries) {
    const normalized = normalizeRel(entry.path);
    if (normalized && !isIgnored(normalized, ignoreDirs, ignoreFiles)) {
      projectMap.set(normalized, { ...entry, path: normalized });
    }
  }
  for (const entry of workspaceEntries) {
    const normalized = normalizeRel(entry.path);
    if (normalized && !isIgnored(normalized, ignoreDirs, ignoreFiles)) {
      workspaceMap.set(normalized, { ...entry, path: normalized });
    }
  }

  const allPaths = [...new Set([...projectMap.keys(), ...workspaceMap.keys()])].sort();
  const filePaths = allPaths.filter(
    (path) => projectMap.get(path)?.kind === "file" || workspaceMap.get(path)?.kind === "file",
  );
  const dirPaths = allPaths.filter(
    (path) => projectMap.get(path)?.kind === "dir" || workspaceMap.get(path)?.kind === "dir",
  );

  const truncated = filePaths.length > maxFiles;
  const workList = truncated ? filePaths.slice(0, maxFiles) : filePaths;

  const report: SyncReport = {
    copiedIn: 0,
    copiedOut: 0,
    skipped: [],
    conflicts: [],
    bytesTransferred: 0,
    truncated,
    manifest: emptyManifest(),
  };
  if (truncated) {
    report.skipped.push({
      path: `(${filePaths.length - maxFiles} more files)`,
      reason: `file-count cap (${maxFiles}) reached`,
    });
  }

  const wantIn = options.direction === "in" || options.direction === "both";
  const wantOut = options.direction === "out" || options.direction === "both";
  const both = options.direction === "both";

  // Mirror directory structure first so file writes never miss parents
  // (adapters also ensure parents defensively).
  for (const dir of dirPaths) {
    if (wantIn && projectMap.get(dir)?.kind === "dir") {
      await workspace.mkdir(dir);
    }
    if (wantOut && workspaceMap.get(dir)?.kind === "dir") {
      await project.mkdir(dir);
    }
  }

  let done = 0;
  const total = workList.length;
  const progress = (): void => {
    done += 1;
    try {
      options.onProgress?.(done, total);
    } catch {
      // Progress listeners must never break the sync.
    }
  };

  for (const path of workList) {
    try {
      const projEntry = projectMap.get(path);
      const wsEntry = workspaceMap.get(path);
      const projIsFile = projEntry?.kind === "file";
      const wsIsFile = wsEntry?.kind === "file";

      if ((projEntry && !projIsFile) || (wsEntry && !wsIsFile)) {
        // One side has a file where the other has a directory: refuse to
        // guess, report, and keep both trees untouched at this path.
        if (projIsFile || wsIsFile) {
          report.skipped.push({ path, reason: "file/directory type clash" });
        }
        progress();
        continue;
      }

      if (projIsFile && (projEntry?.size ?? 0) > maxFileBytes && wantIn) {
        report.skipped.push({
          path,
          reason: `exceeds size cap (${maxFileBytes} bytes)`,
        });
        progress();
        continue;
      }
      if (wsIsFile && (wsEntry?.size ?? 0) > maxFileBytes && wantOut) {
        report.skipped.push({
          path,
          reason: `exceeds size cap (${maxFileBytes} bytes)`,
        });
        progress();
        continue;
      }

      if (projIsFile && !wsIsFile) {
        if (wantIn) {
          const data = await project.readFile(path);
          await workspace.writeFile(path, data);
          report.copiedIn += 1;
          report.bytesTransferred += data.length;
          report.manifest.files[path] = { size: data.length, hash: hashBytes(data) };
        }
        progress();
        continue;
      }

      if (wsIsFile && !projIsFile) {
        if (wantOut) {
          const data = await workspace.readFile(path);
          await project.writeFile(path, data);
          report.copiedOut += 1;
          report.bytesTransferred += data.length;
          report.manifest.files[path] = { size: data.length, hash: hashBytes(data) };
        }
        progress();
        continue;
      }

      if (projIsFile && wsIsFile) {
        const sameSize = projEntry?.size === wsEntry?.size;
        if (sameSize) {
          const [projData, wsData] = await Promise.all([
            project.readFile(path),
            workspace.readFile(path),
          ]);
          if (bytesEqual(projData, wsData)) {
            report.manifest.files[path] = {
              size: projData.length,
              hash: hashBytes(projData),
            };
            progress();
            continue;
          }
          // Same size, different bytes: fall through to changed-side logic
          // with content already in hand.
          const prev = prevManifest?.files[path] ?? null;
          const hashP = hashBytes(projData);
          const hashW = hashBytes(wsData);
          const changedProj = !prev || prev.hash !== hashP;
          const changedWs = !prev || prev.hash !== hashW;
          if (both && changedProj && changedWs) {
            await workspace.writeFile(path, projData);
            report.copiedIn += 1;
            report.bytesTransferred += projData.length;
            report.conflicts.push(path);
            report.manifest.files[path] = { size: projData.length, hash: hashP };
          } else if (wantIn && (!both || changedProj || !changedWs)) {
            await workspace.writeFile(path, projData);
            report.copiedIn += 1;
            report.bytesTransferred += projData.length;
            report.manifest.files[path] = { size: projData.length, hash: hashP };
          } else if (wantOut) {
            await project.writeFile(path, wsData);
            report.copiedOut += 1;
            report.bytesTransferred += wsData.length;
            report.manifest.files[path] = { size: wsData.length, hash: hashW };
          }
          progress();
          continue;
        }
        // Sizes differ: changed side is unambiguous by size alone.
        const prev = prevManifest?.files[path] ?? null;
        if (both && prev) {
          // Read only the side the manifest disagrees with first.
          const projMatches = prev.size === projEntry?.size;
          const wsMatches = prev.size === wsEntry?.size;
          if (!projMatches && !wsMatches) {
            // Both changed (different sizes): project wins, report.
            const data = await project.readFile(path);
            await workspace.writeFile(path, data);
            report.copiedIn += 1;
            report.bytesTransferred += data.length;
            report.conflicts.push(path);
            report.manifest.files[path] = { size: data.length, hash: hashBytes(data) };
          } else if (!projMatches && wantIn) {
            const data = await project.readFile(path);
            await workspace.writeFile(path, data);
            report.copiedIn += 1;
            report.bytesTransferred += data.length;
            report.manifest.files[path] = { size: data.length, hash: hashBytes(data) };
          } else if (!wsMatches && wantOut) {
            const data = await workspace.readFile(path);
            await project.writeFile(path, data);
            report.copiedOut += 1;
            report.bytesTransferred += data.length;
            report.manifest.files[path] = { size: data.length, hash: hashBytes(data) };
          } else {
            // Manifest agrees with one side but direction forbids the copy;
            // refresh the manifest from the readable side without copying.
            if (wantIn) {
              const data = await project.readFile(path);
              report.manifest.files[path] = { size: data.length, hash: hashBytes(data) };
            } else {
              const data = await workspace.readFile(path);
              report.manifest.files[path] = { size: data.length, hash: hashBytes(data) };
            }
          }
        } else if (wantIn && (!both || !prev)) {
          const data = await project.readFile(path);
          await workspace.writeFile(path, data);
          report.copiedIn += 1;
          report.bytesTransferred += data.length;
          report.manifest.files[path] = { size: data.length, hash: hashBytes(data) };
        } else if (wantOut) {
          const data = await workspace.readFile(path);
          await project.writeFile(path, data);
          report.copiedOut += 1;
          report.bytesTransferred += data.length;
          report.manifest.files[path] = { size: data.length, hash: hashBytes(data) };
        }
        progress();
        continue;
      }
      progress();
    } catch (error) {
      // One bad file (permission, race, binary edge) must not abort the
      // whole sync: record it and continue with the rest.
      report.skipped.push({
        path,
        reason: error instanceof Error ? error.message : String(error),
      });
      progress();
    }
  }

  return report;
}
