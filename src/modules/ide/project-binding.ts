/**
 * Persistent per-chat project binding.
 *
 * A picked folder is stored on the conversation record itself
 * (`externalFolderSession` metadata in SQLite), so the binding survives
 * reloads and revisits: every message in that chat keeps using the same
 * project context. A conversation with a session is *bound*; binding is
 * permanent for the chat's lifetime — switching projects requires a new
 * chat. New conversations start with no session (unbound).
 */
import type { ExternalFolderSession } from "@/core/types/app-state";

export const PROJECT_LOCK_MESSAGE =
  "This chat is already bound to its project. Start a new chat to use a different project.";

export function isProjectBound(
  session: ExternalFolderSession | null | undefined,
): boolean {
  return session !== null && session !== undefined;
}

/** Throws when the session is already bound (switching is not allowed). */
export function requireProjectUnbound(
  session: ExternalFolderSession | null | undefined,
): void {
  if (isProjectBound(session)) {
    throw new Error(PROJECT_LOCK_MESSAGE);
  }
}
