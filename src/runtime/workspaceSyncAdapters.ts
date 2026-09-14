/**
 * Device bindings for project ↔ `/workspace` sync.
 *
 * - SAF project side: `createExternalFolderService` (binary-capable
 *   `readBytesFile` / `writeBytesFile`, recursive `createDirectory`).
 * - Workspace side: `expo-file-system` `File`/`Directory` under
 *   `<rootfs>/workspace` (plain POSIX tree PRoot bind-mounts at `/workspace`).
 * - The sync manifest lives at `<workspace>/.ajiro-sync.json` and is itself
 *   excluded from syncing.
 *
 * Mapping contract: the SAF project root ≡ `/workspace`. Relative paths are
 * identical on both sides, so `cd` depth and tool output paths translate
 * 1:1 between the agent's file tools and the Linux shell.
 */
import { Directory, File } from "expo-file-system";

import type { ExternalFolderSession } from "@/core/types/app-state";
import { createExternalFolderService } from "@/core/services/external-folder/external-folder-service";
import { rootfsManager } from "@/runtime/RootfsManager";
import { LinuxRuntimeError } from "@/runtime/runtimeTypes";
import {
  SYNC_MANIFEST_NAME,
  syncTrees,
  type SyncEntry,
  type SyncManifest,
  type SyncReport,
  type SyncTree,
} from "@/runtime/workspaceSync";

function joinFsPath(base: string, rel: string): string {
  const trimmed = base.endsWith("/") ? base.slice(0, -1) : base;
  return rel ? `${trimmed}/${rel}` : trimmed;
}

function parentRel(path: string): string {
  const index = path.lastIndexOf("/");
  return index <= 0 ? "" : path.slice(0, index);
}

export function workspaceRootPath(): string {
  return joinFsPath(rootfsManager.getRootfsPath(), "workspace");
}

async function ensureRuntimeReadyAsync(): Promise<void> {
  const ready = await rootfsManager.isReady();
  if (!ready) {
    throw new LinuxRuntimeError(
      "rootfs-missing",
      "Cannot sync project files: the Linux userspace is not ready.",
    );
  }
}

/** SAF project tree (content URIs, recursive walk). */
export function createProjectTree(session: ExternalFolderSession): SyncTree {
  const service = createExternalFolderService();
  return {
    async listAll(): Promise<SyncEntry[]> {
      const entries: SyncEntry[] = [];
      const walk = (dir: string): void => {
        for (const entry of service.listEntries(session, dir)) {
          entries.push({
            path: entry.path,
            kind: entry.kind === "directory" ? "dir" : "file",
            size: entry.size ?? 0,
          });
          if (entry.kind === "directory") walk(entry.path);
        }
      };
      walk("");
      return entries;
    },
    async readFile(path: string): Promise<Uint8Array> {
      const { bytes } = await service.readBytesFile(session, path);
      return bytes;
    },
    async writeFile(path: string, data: Uint8Array): Promise<void> {
      const parent = parentRel(path);
      if (parent) {
        await service.createDirectory(session, parent);
      }
      await service.writeBytesFile(session, path, data);
    },
    async mkdir(path: string): Promise<void> {
      await service.createDirectory(session, path);
    },
  };
}

/** Plain POSIX tree under the workspace root. */
export function createWorkspaceTree(root: string): SyncTree {
  const uriFor = (rel: string): string => joinFsPath(root, rel);
  return {
    async listAll(): Promise<SyncEntry[]> {
      const entries: SyncEntry[] = [];
      const walk = (dir: Directory, prefix: string): void => {
        let children: (Directory | File)[];
        try {
          children = dir.list();
        } catch {
          return;
        }
        for (const child of children) {
          const rel = prefix ? `${prefix}/${child.name}` : child.name;
          if (child instanceof Directory) {
            entries.push({ path: rel, kind: "dir", size: 0 });
            walk(child, rel);
          } else {
            entries.push({ path: rel, kind: "file", size: child.size ?? 0 });
          }
        }
      };
      const base = new Directory(root);
      if (base.exists) walk(base, "");
      return entries;
    },
    async readFile(path: string): Promise<Uint8Array> {
      return new File(uriFor(path)).bytes();
    },
    async writeFile(path: string, data: Uint8Array): Promise<void> {
      const parent = parentRel(path);
      if (parent) {
        const dir = new Directory(uriFor(parent));
        if (!dir.exists) dir.create({ intermediates: true });
      }
      const file = new File(uriFor(path));
      if (!file.exists) file.create();
      file.write(data);
    },
    async mkdir(path: string): Promise<void> {
      const dir = new Directory(uriFor(path));
      if (!dir.exists) dir.create({ intermediates: true });
    },
  };
}

async function loadManifest(tree: SyncTree): Promise<SyncManifest | null> {
  try {
    const raw = await tree.readFile(SYNC_MANIFEST_NAME);
    const parsed: unknown = JSON.parse(new TextDecoder().decode(raw));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as { version?: unknown }).version === 1 &&
      typeof (parsed as { files?: unknown }).files === "object"
    ) {
      return parsed as SyncManifest;
    }
    return null;
  } catch {
    return null;
  }
}

async function saveManifest(tree: SyncTree, manifest: SyncManifest): Promise<void> {
  const raw = new TextEncoder().encode(JSON.stringify(manifest));
  await tree.writeFile(SYNC_MANIFEST_NAME, raw);
}

/**
 * SAF project → `/workspace`. Run before shell execution / on terminal open.
 * Throws (fail closed) when the runtime is not ready.
 */
export async function syncProjectToWorkspace(
  session: ExternalFolderSession,
  onProgress?: (doneFiles: number, totalFiles: number) => void,
): Promise<SyncReport> {
  await ensureRuntimeReadyAsync();
  const root = workspaceRootPath();
  const base = new Directory(root);
  if (!base.exists) base.create({ intermediates: true });
  const tree = createWorkspaceTree(root);
  const manifest = await loadManifest(tree);
  const report = await syncTrees(createProjectTree(session), tree, {
    direction: "in",
    ignoreFiles: [SYNC_MANIFEST_NAME],
    manifest,
    onProgress,
  });
  await saveManifest(tree, report.manifest);
  return report;
}

/**
 * `/workspace` → SAF project. Run after shell execution / on terminal close
 * so agent-created and shell-modified files come back to the project.
 */
export async function syncWorkspaceToProject(
  session: ExternalFolderSession,
  onProgress?: (doneFiles: number, totalFiles: number) => void,
): Promise<SyncReport> {
  await ensureRuntimeReadyAsync();
  const root = workspaceRootPath();
  const tree = createWorkspaceTree(root);
  const manifest = await loadManifest(tree);
  const report = await syncTrees(createProjectTree(session), tree, {
    direction: "out",
    ignoreFiles: [SYNC_MANIFEST_NAME],
    manifest,
    onProgress,
  });
  await saveManifest(tree, report.manifest);
  return report;
}
