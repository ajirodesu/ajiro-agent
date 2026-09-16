/**
 * Project file access for the Files workspace (sections 10-15, 44-47):
 * recursive tree walks with caps, guarded text reads, search, and validated
 * mutations. All user-derived paths go through validateProjectPath; the SAF
 * service remains the only filesystem touchpoint.
 */
import {
  createExternalFolderService,
  type ExternalFolderEntry,
} from "@/core/services/external-folder/external-folder-service";
import { validateProjectPath } from "@/modules/safety/guards";
import type { ExternalFolderSession } from "@/core/types/app-state";
import type { TreeEntry } from "@/modules/ide/file-tree";

export const MAX_TREE_ENTRIES = 5000;
export const MAX_TREE_DEPTH = 12;
export const MAX_READ_BYTES = 2_000_000;
export const MAX_PREVIEW_BYTES = 200_000;
export const MAX_SEARCH_FILES = 2000;

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".gradle",
  "build",
  "dist",
  ".expo",
  ".idea",
  ".vscode",
]);

const TEXT_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".md", ".mdx",
  ".txt", ".yml", ".yaml", ".toml", ".ini", ".cfg", ".conf", ".xml",
  ".html", ".css", ".scss", ".less", ".py", ".rb", ".go", ".rs", ".java",
  ".kt", ".swift", ".c", ".h", ".cpp", ".hpp", ".cs", ".php", ".sh",
  ".sql", ".graphql", ".vue", ".svelte", ".astro", ".env", ".gitignore",
  ".gitattributes", ".editorconfig", ".prettierrc", ".eslintrc", ".dockerignore",
]);

const IMAGE_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico",
]);

export type PreviewKind =
  | "code"
  | "markdown"
  | "json"
  | "html"
  | "image"
  | "svg"
  | "text"
  | "binary";

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

export function previewKindFor(name: string, mimeType: string | null): PreviewKind {
  if (mimeType?.startsWith("image/svg")) return "svg";
  if (mimeType?.startsWith("image/")) return "image";
  const extension = extensionOf(name);
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (extension === ".svg") return "svg";
  if (extension === ".md" || extension === ".mdx" || extension === ".markdown") {
    return "markdown";
  }
  if (extension === ".json") return "json";
  if (extension === ".html" || extension === ".htm") return "html";
  if (TEXT_EXTENSIONS.has(extension) || !extension) return "code";
  return "binary";
}

export function languageForPath(path: string): string | null {
  const extension = extensionOf(path.split("/").pop() ?? "");
  const map: Record<string, string> = {
    ".ts": "typescript",
    ".tsx": "tsx",
    ".js": "javascript",
    ".jsx": "jsx",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".json": "json",
    ".md": "markdown",
    ".mdx": "markdown",
    ".py": "python",
    ".rb": "ruby",
    ".go": "go",
    ".rs": "rust",
    ".java": "java",
    ".kt": "kotlin",
    ".swift": "swift",
    ".c": "c",
    ".h": "cpp",
    ".cpp": "cpp",
    ".cs": "csharp",
    ".php": "php",
    ".sh": "bash",
    ".sql": "sql",
    ".xml": "markup",
    ".html": "markup",
    ".css": "css",
    ".yml": "yaml",
    ".yaml": "yaml",
  };
  return map[extension] ?? null;
}

export type FileFingerprint = {
  size: number | null;
  head: string;
};

export function fingerprintForBytes(bytes: Uint8Array): FileFingerprint {
  const head = bytes.subarray(0, 4096);
  let hash = 7;
  for (let index = 0; index < head.length; index += 1) {
    hash = (hash * 31 + head[index]!) | 0;
  }
  return { size: bytes.length, head: Math.abs(hash).toString(36) };
}

export function fingerprintKey(fingerprint: FileFingerprint): string {
  return `${fingerprint.size ?? "?"}:${fingerprint.head}`;
}

export type TreeSnapshot = {
  entries: Record<string, TreeEntry[]>;
  truncated: boolean;
  total: number;
};

/** Recursive walk with entry/depth caps. Directories only (files listed per dir). */
export function walkProjectTree(
  session: ExternalFolderSession,
  maxEntries = MAX_TREE_ENTRIES,
): TreeSnapshot {
  const service = createExternalFolderService();
  const entries: Record<string, TreeEntry[]> = { "": [] };
  let total = 0;
  let truncated = false;
  const walk = (dirPath: string, depth: number): void => {
    if (total >= maxEntries || depth > MAX_TREE_DEPTH) {
      truncated = true;
      return;
    }
    let listed: ExternalFolderEntry[];
    try {
      listed = service.listEntries(session, dirPath);
    } catch {
      return;
    }
    const bucket: TreeEntry[] = [];
    for (const entry of listed) {
      if (total >= maxEntries) {
        truncated = true;
        break;
      }
      if (entry.kind === "directory" && SKIP_DIRS.has(entry.name)) continue;
      total += 1;
      bucket.push({ path: entry.path, name: entry.name, kind: entry.kind });
    }
    entries[dirPath] = bucket;
    for (const entry of bucket) {
      if (entry.kind !== "directory") continue;
      if (depth + 1 > MAX_TREE_DEPTH) {
        truncated = true;
        continue;
      }
      walk(entry.path, depth + 1);
    }
  };
  walk("", 0);
  return { entries, truncated, total };
}

export type TextRead =
  | { status: "ok"; text: string; size: number | null }
  | { status: "too-large"; size: number | null }
  | { status: "error"; message: string };

export async function readProjectText(
  session: ExternalFolderSession,
  path: string,
  maxBytes = MAX_READ_BYTES,
): Promise<TextRead> {
  const service = createExternalFolderService();
  let clean: string;
  try {
    clean = validateProjectPath(path);
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
  try {
    const { bytes } = await service.readBytesFile(session, clean);
    if (bytes.length > maxBytes) {
      return { status: "too-large", size: bytes.length };
    }
    return {
      status: "ok",
      text: new TextDecoder().decode(bytes),
      size: bytes.length,
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export type SearchHit = {
  path: string;
  name: string;
  kind: "directory" | "file";
  line?: number;
  preview?: string;
};

export async function searchProject(
  session: ExternalFolderSession,
  query: string,
  options?: { content?: boolean },
): Promise<{ hits: SearchHit[]; truncated: boolean }> {
  const needle = query.trim().toLowerCase();
  if (!needle) return { hits: [], truncated: false };
  const service = createExternalFolderService();
  const hits: SearchHit[] = [];
  let filesSeen = 0;
  let truncated = false;
  const walk = async (dirPath: string, depth: number): Promise<void> => {
    if (hits.length >= 100 || filesSeen >= MAX_SEARCH_FILES || depth > MAX_TREE_DEPTH) {
      truncated = true;
      return;
    }
    let listed: ExternalFolderEntry[];
    try {
      listed = service.listEntries(session, dirPath);
    } catch {
      return;
    }
    for (const entry of listed) {
      if (hits.length >= 100 || filesSeen >= MAX_SEARCH_FILES) {
        truncated = true;
        return;
      }
      if (entry.kind === "directory") {
        if (SKIP_DIRS.has(entry.name)) continue;
        if (entry.name.toLowerCase().includes(needle)) {
          hits.push({ path: entry.path, name: entry.name, kind: "directory" });
        }
        await walk(entry.path, depth + 1);
        continue;
      }
      filesSeen += 1;
      const nameHit = entry.name.toLowerCase().includes(needle);
      if (nameHit) {
        hits.push({ path: entry.path, name: entry.name, kind: "file" });
        continue;
      }
      if (options?.content && previewKindFor(entry.name, entry.mimeType) !== "binary") {
        try {
          const { bytes } = await service.readBytesFile(session, entry.path);
          if (bytes.length > MAX_PREVIEW_BYTES) continue;
          const text = new TextDecoder().decode(bytes).toLowerCase();
          const at = text.indexOf(needle);
          if (at >= 0) {
            const line = text.slice(0, at).split("\n").length;
            hits.push({
              path: entry.path,
              name: entry.name,
              kind: "file",
              line,
              preview: text
                .slice(Math.max(0, at - 40), at + 80)
                .replace(/\s+/g, " ")
                .slice(0, 120),
            });
          }
        } catch {
          // unreadable — skip
        }
      }
    }
  };
  await walk("", 0);
  return { hits, truncated };
}
