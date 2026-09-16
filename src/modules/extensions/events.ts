/**
 * Extension event bus.
 *
 * The Store screen, the sidebar discovery badge, and the plugin host surface
 * all need to react to the same facts — an extension was installed, enabled,
 * disabled, updated, rolled back, or removed — without importing each other.
 * A tiny emitter is enough, and it keeps the manager free of UI concerns.
 */

export type ExtensionEvent =
  | { type: "installed"; pluginId: string }
  | { type: "updated"; pluginId: string }
  | { type: "enabled"; pluginId: string }
  | { type: "disabled"; pluginId: string }
  | { type: "broken"; message: string; pluginId: string }
  | { type: "recovered"; pluginId: string }
  | { type: "rolled-back"; pluginId: string }
  | { type: "uninstalled"; pluginId: string }
  | { type: "commands-changed" }
  | { type: "diagnostics-changed"; pluginId: string | null }
  | { type: "plugin-log"; level: string; message: string; pluginId: string }
  | { level: string; pluginId: string; text: string; type: "notification" };

const listeners = new Set<(event: ExtensionEvent) => void>();

export function subscribeExtensionEvents(listener: (event: ExtensionEvent) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitExtensionEvent(event: ExtensionEvent): void {
  for (const listener of [...listeners]) {
    try {
      listener(event);
    } catch {
      // A broken listener must not break the caller.
    }
  }
}
