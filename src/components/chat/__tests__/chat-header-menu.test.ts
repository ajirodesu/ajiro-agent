import { describe, expect, it } from "vitest";

import {
  buildChatShareText,
  chatShareFileName,
  findInChat,
  formatBytes,
  uploadedFilesForConversation,
} from "@/components/chat/chat-header-menu";
import type { StoredMessage, WorkspaceFile } from "@/core/types/app-state";

function message(
  overrides: Partial<StoredMessage> & { id: string },
): StoredMessage {
  return {
    conversationId: "c1",
    role: "user",
    content: "hello",
    metadata: null,
    status: "completed",
    error: null,
    sequence: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function workspaceFile(
  overrides: Partial<WorkspaceFile> & { id: string },
): WorkspaceFile {
  return {
    displayName: "file.txt",
    originalName: "file.txt",
    mimeType: "text/plain",
    size: 2048,
    relativePath: "file.txt",
    sourceKind: "imported",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("chat-header-menu", () => {
  it("formats byte sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });

  it("lists only the files uploaded in that chat", () => {
    const files = [
      workspaceFile({ id: "a" }),
      workspaceFile({ id: "b", displayName: "b.png" }),
    ];
    // Only "b" was attached to a message in this conversation.
    const messages = [
      message({ id: "m1", metadata: { selectedFileIds: ["b"] } }),
    ];
    const uploaded = uploadedFilesForConversation(messages, files);
    expect(uploaded.map((f) => f.id)).toEqual(["b"]);
    expect(uploaded[0]?.displayName).toBe("b.png");
    expect(uploaded[0]?.subtitle).toBe("text/plain · 2.0 KB");
    // A chat with no attachments is empty — never the whole workspace.
    expect(
      uploadedFilesForConversation([message({ id: "m2", metadata: null })], files),
    ).toEqual([]);
    // Unknown ids (deleted workspace files) are skipped.
    expect(
      uploadedFilesForConversation(
        [message({ id: "m3", metadata: { selectedFileIds: ["gone"] } })],
        files,
      ),
    ).toEqual([]);
  });

  it("builds a filesystem-safe export name", () => {
    expect(chatShareFileName("Trip plan: 2026 / ideas")).toBe(
      "Trip-plan-2026-ideas",
    );
    expect(chatShareFileName("   ")).toBe("chat");
    expect(chatShareFileName("!!!")).toBe("chat");
  });

  it("builds share text with roles and handles empty chats", () => {
    const text = buildChatShareText({
      title: "Trip plan",
      messages: [
        message({ id: "m1", role: "user", content: "hi" }),
        message({ id: "m2", role: "assistant", content: "hello!" }),
      ],
    });
    expect(text).toContain("# Trip plan");
    expect(text).toContain("## You");
    expect(text).toContain("## Assistant");
    expect(
      buildChatShareText({ title: "Empty", messages: [] }),
    ).toContain("No messages yet");
  });

  it("finds case-insensitive matches with excerpts", () => {
    const matches = findInChat(
      [
        message({ id: "m1", content: "The QUICK brown fox" }),
        message({ id: "m2", content: "nothing here" }),
      ],
      "quick",
    );
    expect(matches.map((m) => m.messageId)).toEqual(["m1"]);
    expect(matches[0]?.excerpt.toLowerCase()).toContain("quick");
    expect(findInChat([], "  ")).toEqual([]);
  });
});
