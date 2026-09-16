/**
 * Conversation history list rules — the SOLE filter/sort for the sidebar
 * recents. A conversation lists as soon as it exists and is not archived:
 * there is deliberately NO minimum message count, so a single exchange
 * (one user message + one AI response) always appears. Empty "New chat"
 * rows are pruned at the persistence layer, never here.
 */
export type ListableConversation = {
  id: string;
  archivedAt: string | null;
  pinnedAt: string | null;
  updatedAt: string;
};

export function visibleConversations<T extends ListableConversation>(
  conversations: T[],
): T[] {
  return [...conversations]
    .filter((conversation) => !conversation.archivedAt)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export function splitPinnedRecents<T extends ListableConversation>(
  conversations: T[],
): { pinned: T[]; recents: T[] } {
  const visible = visibleConversations(conversations);
  return {
    pinned: visible.filter((conversation) => conversation.pinnedAt),
    recents: visible.filter((conversation) => !conversation.pinnedAt),
  };
}
