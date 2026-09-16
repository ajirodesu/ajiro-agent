import { describe, expect, it } from "vitest";

import {
  splitPinnedRecents,
  visibleConversations,
} from "@/modules/chat/conversation-list";

const conversation = (overrides: Record<string, unknown> = {}) => ({
  id: Math.random().toString(36).slice(2),
  archivedAt: null,
  pinnedAt: null,
  updatedAt: "2026-09-15T12:00:00.000Z",
  ...overrides,
});

describe("conversation-list", () => {
  it("lists a single-exchange conversation with no minimum", () => {
    const single = conversation({ title: "one exchange" });
    expect(visibleConversations([single])).toEqual([single]);
    expect(splitPinnedRecents([single]).recents).toEqual([single]);
  });

  it("hides archived conversations but keeps empties", () => {
    const archived = conversation({ archivedAt: "2026-09-15T12:00:00.000Z" });
    const empty = conversation({ title: "New chat" });
    expect(visibleConversations([archived, empty])).toEqual([empty]);
  });

  it("sorts newest first and splits pinned from recents", () => {
    const old = conversation({ updatedAt: "2026-09-14T12:00:00.000Z" });
    const pinned = conversation({
      pinnedAt: "2026-09-15T12:00:00.000Z",
      updatedAt: "2026-09-13T12:00:00.000Z",
    });
    const fresh = conversation({ updatedAt: "2026-09-15T13:00:00.000Z" });
    const { pinned: pinnedList, recents } = splitPinnedRecents([
      old,
      pinned,
      fresh,
    ]);
    expect(pinnedList).toEqual([pinned]);
    expect(recents).toEqual([fresh, old]);
  });
});
