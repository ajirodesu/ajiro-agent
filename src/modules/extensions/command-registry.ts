/**
 * Extension command registry (prompt §45).
 *
 * Acode plugins register commands through `acode.require("commands")` and run
 * them with `acode.exec(name)` or a bound key. Ajiro keeps the same
 * registration *model* — id, name, bind keys, exec callback — instead of
 * inventing a parallel one, and keeps the callbacks in the plugin host
 * document (where the plugin's own closures live). The host mirrors each
 * registration here so the app can list, bind, or invoke plugin commands.
 *
 * [AJIRO ORIGINAL] mirror: no Acode-equivalent native registry exists to copy,
 * and no command palette is wired to it yet (see the compatibility report).
 */
import type { PluginCommandRegistration } from "./dom/bridge-protocol";
import {
  createKeyBindingTable,
  type KeyBinding,
  type KeyBindingConflict,
  type KeyBindingResolution,
} from "./key-bindings";

export type RegisteredPluginCommand = {
  bindKey: Record<string, string> | null;
  /** Canonical chord id once a binding resolves, else null (§45). */
  chordId: string | null;
  description: string | null;
  /** True when the plugin registered a real exec callback. */
  executable: boolean;
  name: string;
  pluginId: string;
};

export type PluginCommandRegistry = {
  /** Chords worth listening for, in canonical form (§45). */
  chordIds(): string[];
  clear(pluginId?: string): void;
  /** Chords claimed by more than one command; conflicts never dispatch. */
  conflicts(): KeyBindingConflict[];
  invoke(name: string): boolean;
  /** Dispatch a chord from the editor to the command that owns it. */
  invokeChord(chordId: string): KeyBindingResolution;
  list(): RegisteredPluginCommand[];
  listBindings(): KeyBinding[];
  register(pluginId: string, command: PluginCommandRegistration): void;
  remove(pluginId: string, name: string): void;
  subscribe(listener: () => void): () => void;
};

export type PluginCommandRegistryOptions = {
  /** Platform whose `bindKey` entry applies; see `acodePlatformForOS`. */
  platform?: string;
};

export function createPluginCommandRegistry(
  invoke?: (name: string) => void,
  options: PluginCommandRegistryOptions = {},
): PluginCommandRegistry {
  const commands = new Map<string, RegisteredPluginCommand>();
  const listeners = new Set<() => void>();
  const keys = createKeyBindingTable(options.platform ?? "win");

  const keyFor = (pluginId: string, name: string) => `${pluginId}::${name}`;

  function resolveCommand(name: string): RegisteredPluginCommand | null {
    return [...commands.values()].find((command) => command.name === name) ?? null;
  }

  function emit(): void {
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        // A broken listener must not stop the others.
      }
    }
  }

  return {
    clear(pluginId) {
      if (!pluginId) {
        commands.clear();
        keys.clear();
        emit();
        return;
      }
      for (const [key, command] of commands) {
        if (command.pluginId === pluginId) commands.delete(key);
      }
      keys.clear(pluginId);
      emit();
    },

    invoke(name) {
      const found = [...commands.values()].find((command) => command.name === name);
      if (!found || !found.executable) return false;
      invoke?.(name);
      return true;
    },

    chordIds: () => keys.chordIds(),

    conflicts: () => keys.conflicts(),

    invokeChord(chordId) {
      const resolution = keys.match(chordId);
      if (resolution.status !== "bound") return resolution;
      const command = resolveCommand(resolution.binding.commandId);
      // A conflicting or vanished command leaves the chord unclaimed rather
      // than running the wrong plugin's code.
      if (!command || !command.executable) return { chordId, status: "unbound" };
      invoke?.(command.name);
      return resolution;
    },

    list: () => [...commands.values()].sort((a, b) => a.name.localeCompare(b.name)),

    listBindings: () => keys.list(),

    register(pluginId, command) {
      const bindKey = command.bindKey ?? null;
      const binding = keys.register({ bindKey, commandId: command.name, pluginId });
      commands.set(keyFor(pluginId, command.name), {
        bindKey,
        chordId: binding?.chordId ?? null,
        description: command.description ?? null,
        executable: command.exec === true,
        name: command.name,
        pluginId,
      });
      emit();
    },

    remove(pluginId, name) {
      commands.delete(keyFor(pluginId, name));
      keys.clear(pluginId);
      // Re-register surviving bindings for this plugin so removing one
      // command cannot silently drop another's chord.
      for (const command of commands.values()) {
        if (command.pluginId !== pluginId) continue;
        keys.register({
          bindKey: command.bindKey,
          commandId: command.name,
          pluginId,
        });
      }
      emit();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
