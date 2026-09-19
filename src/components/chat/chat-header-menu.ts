/**
 * Chat header options menu — pure helpers for the Main/Chat after-chat
 * ellipsis popup (share text, uploaded-file extraction, find-in-chat match).
 *
 * UI lives in `src/app/(root)/index.tsx`; `UsageCapsule` (context-usage.tsx)
 * owns the circle → 3-slot capsule animation. Everything here is
 * React-Native-free and unit-tested.
 */

import type { StoredMessage, WorkspaceFile } from "@/core/types/app-state";

export type ChatUploadedFile = {
  id: string;
  displayName: string;
  subtitle: string | null;
};

function fileSubtitle(file: WorkspaceFile): string | null {
  const parts: string[] = [];
  if (file.mimeType) parts.push(file.mimeType);
  if (file.size !== null && file.size !== undefined) {
    parts.push(formatBytes(file.size));
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size < 0) return "—";
  if (size < 1024) return `${size} B`;
  const units = ["KB", "MB", "GB"];
  let value = size / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]!}`;
}

/**
 * Files uploaded in the current chat, derived from message metadata
 * (`selectedFileIds` + `promptArtifacts` + `generatedImages`) joined against
 * the workspace file list for display names and sizes. Strictly chat-scoped:
 * files that were never attached to this conversation are not listed, so the
 * drawer always reflects what was actually uploaded here.
 */
export function uploadedFilesForConversation(
  messages: StoredMessage[],
  workspaceFiles: WorkspaceFile[],
): ChatUploadedFile[] {
  const byId = new Map(workspaceFiles.map((file) => [file.id, file]));
  const referenced = new Map<string, WorkspaceFile>();

  for (const message of messages) {
    const selected = message.metadata?.selectedFileIds ?? [];
    for (const id of selected) {
      const file = byId.get(id);
      if (file && !referenced.has(id)) referenced.set(id, file);
    }
    const artifacts = message.metadata?.promptArtifacts ?? [];
    for (const artifact of artifacts) {
      const id = artifact.fileId || artifact.id;
      if (!id) continue;
      const file = byId.get(id);
      if (file && !referenced.has(id)) referenced.set(id, file);
    }
    for (const image of message.metadata?.generatedImages ?? []) {
      const key = image.id || image.uri;
      if (!key || referenced.has(key)) continue;
      referenced.set(key, {
        id: key,
        displayName: "Generated image",
        originalName: null,
        mimeType: image.mimeType,
        size: null,
        relativePath: image.uri,
        sourceKind: "artifact",
        createdAt: message.createdAt,
        updatedAt: message.updatedAt,
      } satisfies WorkspaceFile);
    }
  }

  const files = [...referenced.values()];
  return files.map((file) => ({
    id: file.id,
    displayName: file.displayName || file.relativePath || "Untitled file",
    subtitle: fileSubtitle(file),
  }));
}

/** Filesystem-safe export base name for a chat title (`""` → `"chat"`). */
export function chatShareFileName(title: string): string {
  const slug = title
    .replace(/[^\w\- ]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 48);
  return slug || "chat";
}

/** Plain-text export of a conversation for the Share sheet / clipboard. */
export function buildChatShareText(input: {
  title: string;
  messages: StoredMessage[];
}): string {
  const lines = [`# ${input.title || "Chat"}`, ""];
  const visible = input.messages.filter(
    (message) => message.role !== "system" && message.content.trim().length > 0,
  );
  if (visible.length === 0) {
    lines.push("_No messages yet._");
    return lines.join("\n");
  }
  for (const message of visible) {
    const who = message.role === "user" ? "You" : "Assistant";
    lines.push(`## ${who}`, "", message.content.trim(), "");
  }
  return lines.join("\n").trimEnd() + "\n";
}

export type FindMatch = {
  messageId: string;
  excerpt: string;
};

function excerptAround(content: string, index: number, length: number): string {
  const radius = 48;
  const start = Math.max(0, index - radius);
  const end = Math.min(content.length, index + length + radius);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < content.length ? "…" : "";
  return `${prefix}${content.slice(start, end).replace(/\s+/g, " ").trim()}${suffix}`;
}

/** Case-insensitive substring search over visible message content. */
export function findInChat(
  messages: StoredMessage[],
  query: string,
): FindMatch[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const matches: FindMatch[] = [];
  for (const message of messages) {
    if (message.role === "system") continue;
    const content = message.content ?? "";
    const index = content.toLowerCase().indexOf(needle);
    if (index === -1) continue;
    matches.push({
      messageId: message.id,
      excerpt: excerptAround(content, index, needle.length),
    });
  }
  return matches;
}
