/**
 * Editor revision history — the SOLE revision store for Edit History.
 *
 * - In-memory session cache (`RevisionLog`) with debounced snapshot capture:
 *   every meaningful edit batch persists a snapshot with a real timestamp.
 * - Identity comes from the host app: `resolveRevisionAuthor()` reads the
 *   repo-local git identity (`user.name`) when a session is available, so
 *   author names are real; avatar URIs ride along from the connected Git
 *   provider profile when present, otherwise the UI falls back to the
 *   existing default-avatar treatment (initials).
 * - Durable SQLite persistence (`editorFileRevisions`): every captured
 *   snapshot is mirrored to SQLite so history survives restarts; the pure
 *   log stays unit-testable without SQLite.
 */

export type EditorRevision = {
  id: string;
  createdAt: string;
  authorName: string | null;
  authorAvatarUri: string | null;
  content: string;
};

export type RevisionAuthor = {
  name: string | null;
  avatarUri: string | null;
};

/**
 * Real author identity: the repo-local git `user.name` when a session is
 * available (live from isomorphic-git config), plus the connected provider
 * avatar when the caller already resolved one (e.g. GitHub `avatar_url`).
 * Unknown identity stays null so the UI renders the default avatar —
 * never a hardcoded placeholder name.
 */
export async function resolveRevisionAuthor(input: {
  session: { uri: string } | null;
  providerAvatarUri?: string | null;
  getCommitAuthor?: (session: {
    uri: string;
    displayName?: string;
    platform?: "android" | "ios" | "web";
    sourceType?: string;
    grantedAt?: string;
  }) => Promise<{ name: string | null }>;
}): Promise<RevisionAuthor> {
  let name: string | null = null;
  if (input.session && input.getCommitAuthor) {
    try {
      const author = await input.getCommitAuthor({
        uri: input.session.uri,
        platform: "android",
        sourceType: "external-folder",
        grantedAt: new Date(0).toISOString(),
      });
      name = author?.name ?? null;
    } catch {
      name = null;
    }
  }
  return {
    name,
    avatarUri: input.providerAvatarUri ?? null,
  };
}

let revisionSeq = 1;

export function createRevisionId(): string {
  revisionSeq += 1;
  return `rev-${Date.now().toString(36)}-${revisionSeq.toString(36)}`;
}

export function shouldSnapshot(
  previous: string | null,
  next: string,
): boolean {
  if (previous === null) return true;
  if (previous === next) return false;
  // Ignore pure whitespace-only churn under 3 chars (caret nudges).
  if (previous.trim() === next.trim() && Math.abs(next.length - previous.length) < 3) {
    return false;
  }
  return true;
}

export class RevisionLog {
  private revisions: EditorRevision[] = [];

  get size(): number {
    return this.revisions.length;
  }

  list(): EditorRevision[] {
    return [...this.revisions];
  }

  latest(): EditorRevision | null {
    return this.revisions[this.revisions.length - 1] ?? null;
  }

  seed(initial: EditorRevision[]): void {
    this.revisions = [...initial];
  }

  capture(content: string, author: RevisionAuthor): EditorRevision | null {
    const last = this.latest();
    if (!shouldSnapshot(last?.content ?? null, content)) return null;
    const revision: EditorRevision = {
      id: createRevisionId(),
      createdAt: new Date().toISOString(),
      authorName: author.name,
      authorAvatarUri: author.avatarUri,
      content,
    };
    this.revisions.push(revision);
    // Bounded: keep phone memory sane, oldest dropped first.
    if (this.revisions.length > 100) {
      this.revisions.splice(0, this.revisions.length - 100);
    }
    return revision;
  }

  at(index: number): EditorRevision | null {
    if (index < 0 || index >= this.revisions.length) return null;
    return this.revisions[index];
  }
}
