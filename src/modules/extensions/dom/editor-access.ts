/**
 * The active editor document, as seen by plugins (prompt §39).
 *
 * Acode hands plugins its whole editor instance (`editorManager`, the Ace/
 * CodeMirror `editor` object). Ajiro deliberately does not: a plugin gets
 * *read* and *replace* on the one document the user has open, and nothing
 * else — no editor instance, no other buffer, no project, no device
 * filesystem. That is still enough for the things Acode plugins actually do
 * with it (format-on-save helpers, snippet expanders, text transformers).
 *
 * The registry exists because the buffer lives in React state
 * (`providers/ide-workspace`) while the plugin host document lives outside the
 * React tree. The editor screen registers its access object while a file is
 * open and removes it when the file closes, so an unregistered editor means
 * "no document is open" rather than "the plugin sees a stale one".
 */

export type ActiveEditorSnapshot = {
  /** Grammar key the editor is using, e.g. `typescript`; null for plain text. */
  languageId: string | null;
  /** Project-relative path of the open document. */
  path: string;
  text: string;
};

export type ActiveEditorAccess = {
  read(): ActiveEditorSnapshot;
  /** Replace the whole document; false when the edit was refused. */
  replaceAll(text: string): boolean;
};

let current: ActiveEditorAccess | null = null;

/** Called by the editor screen while a document is open. */
export function setActiveEditorAccess(access: ActiveEditorAccess | null): void {
  current = access;
}

export function getActiveEditorAccess(): ActiveEditorAccess | null {
  return current;
}

/**
 * Test seam: the process-wide registry is swapped per test so one suite's
 * fake editor can never leak into another's.
 */
export function resetActiveEditorAccess(): void {
  current = null;
}
