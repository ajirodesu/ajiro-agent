/**
 * IDE workspace event bus (§42). Typed publish/subscribe for project, file,
 * git, and terminal lifecycle events. Synchronous fan-out; a throwing
 * listener never breaks the others.
 *
 * Source provenance: event vocabulary follows the harness spec
 * [AJIRO ORIGINAL]; the fan-out discipline mirrors Persian-Bot's
 * refresh-after-mutation flow [OPEN-SOURCE IMPLEMENTATION].
 */
export type IdeEvent =
  | { type: "PROJECT_SELECTED"; projectId: string }
  | { type: "PROJECT_OPENED"; projectId: string }
  | { type: "PROJECT_CLOSED"; projectId: string }
  | { type: "PROJECT_SWITCHED"; fromId: string | null; toId: string }
  | { type: "FILE_CREATED"; projectId: string; path: string }
  | { type: "FILE_CHANGED"; projectId: string; path: string }
  | { type: "FILE_SAVED"; projectId: string; path: string }
  | { type: "FILE_RENAMED"; projectId: string; from: string; to: string }
  | { type: "FILE_DELETED"; projectId: string; path: string }
  | { type: "GIT_STATUS_CHANGED"; projectId: string }
  | { type: "GIT_CHECKOUT"; projectId: string; ref: string }
  | { type: "GIT_MERGE_STARTED"; projectId: string }
  | { type: "GIT_CONFLICT"; projectId: string; paths: string[] }
  | { type: "GIT_RESOLVED"; projectId: string }
  | { type: "TERMINAL_COMMAND_COMPLETED"; projectId: string; command: string };

export type IdeEventListener = (event: IdeEvent) => void;

export function createIdeEventBus() {
  const listeners = new Set<IdeEventListener>();
  return {
    emit(event: IdeEvent): void {
      for (const listener of [...listeners]) {
        try {
          listener(event);
        } catch {
          // One bad listener must not break the bus.
        }
      }
    },
    subscribe(listener: IdeEventListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    listenerCount(): number {
      return listeners.size;
    },
  };
}

export type IdeEventBus = ReturnType<typeof createIdeEventBus>;
