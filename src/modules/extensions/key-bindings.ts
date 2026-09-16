/**
 * Command key bindings (prompt §45).
 *
 * Acode plugins declare bindings as a platform map, exactly as Acode's own
 * `commands` module accepts them:
 *
 *     acode.require("commands").addCommand({
 *       name: "myplugin.run",
 *       bindKey: { mac: "Cmd-Shift-P", win: "Ctrl-Shift-P", linux: "Ctrl-Shift-P" },
 *       exec: () => { ... },
 *     });
 *
 * Ajiro reproduces the *matching* semantics in one place instead of leaving
 * `bindKey` as decoration:
 *
 * - a spec is parsed into a canonical chord (`ctrl-alt-shift-meta-key`), the
 *   same string the editor document builds from a real `KeyboardEvent`, so
 *   the two halves agree without sharing a parser;
 * - the platform map is resolved for the running OS (Ajiro runs on mobile, so
 *   `ios` reads the `mac` entry and `android` the `linux` one, matching the
 *   intents Acode's authors wrote);
 * - a chord claimed by two different commands is a *conflict*, and a
 *   conflicting chord is never dispatched — one plugin cannot silently steal
 *   another's key.
 *
 * [AJIRO ORIGINAL] The parsing and conflict rules are Ajiro's; Acode binds
 * through its own keymap and does not publish a conflict report.
 */

export type KeyChord = {
  alt: boolean;
  ctrl: boolean;
  /** Canonical, lowercased key name (`p`, `f5`, `space`, `escape`). */
  key: string;
  meta: boolean;
  shift: boolean;
};

export type KeyBinding = {
  /** Canonical chord id, e.g. `ctrl-shift-p`. */
  chordId: string;
  commandId: string;
  pluginId: string;
  /** The spec as the manifest/plugin declared it, for display. */
  spec: string;
};

export type KeyBindingConflict = {
  bindings: KeyBinding[];
  chordId: string;
};

export type KeyBindingResolution =
  | { chordId: string; status: "unbound" }
  | { bindings: KeyBinding[]; chordId: string; status: "conflict" }
  | { binding: KeyBinding; chordId: string; status: "bound" };

const MODIFIER_TOKENS: Record<string, keyof Omit<KeyChord, "key">> = {
  alt: "alt",
  cmd: "meta",
  command: "meta",
  ctrl: "ctrl",
  control: "ctrl",
  meta: "meta",
  opt: "alt",
  option: "alt",
  shift: "shift",
  super: "meta",
  win: "meta",
  windows: "meta",
};

const KEY_ALIASES: Record<string, string> = {
  " ": "space",
  del: "delete",
  esc: "escape",
  return: "enter",
  spacebar: "space",
};

/** Modifier flags in a fixed order so chord ids are canonical everywhere. */
export function chordId(chord: KeyChord): string {
  const parts: string[] = [];
  if (chord.ctrl) parts.push("ctrl");
  if (chord.alt) parts.push("alt");
  if (chord.shift) parts.push("shift");
  if (chord.meta) parts.push("meta");
  parts.push(chord.key);
  return parts.join("-");
}

function normalizeKeyName(name: string): string {
  const raw = name.toLowerCase();
  // The alias table is consulted before trimming, because the space key *is*
  // the alias " " and trimming it would erase the key entirely.
  const direct = KEY_ALIASES[raw];
  if (direct) return direct;
  const trimmed = raw.trim();
  return KEY_ALIASES[trimmed] ?? trimmed;
}

/**
 * Parse one Acode key spec (`"Ctrl-Shift-P"`, `"Cmd-P"`, `"Alt-Enter"`).
 * Returns null when nothing usable remains, so a malformed spec is reported
 * as unbound rather than dispatching on a nonsense chord.
 */
export function parseKeyChord(spec: string): KeyChord | null {
  if (typeof spec !== "string" || spec.trim() === "") return null;
  const chord: KeyChord = {
    alt: false,
    ctrl: false,
    key: "",
    meta: false,
    shift: false,
  };
  const keyParts: string[] = [];
  for (const rawToken of spec.split(/[-+]/)) {
    const token = rawToken.trim().toLowerCase();
    if (token === "") continue;
    const modifier = MODIFIER_TOKENS[token];
    if (modifier) {
      chord[modifier] = true;
      continue;
    }
    keyParts.push(token);
  }
  if (keyParts.length === 0) return null;
  chord.key = normalizeKeyName(keyParts.join("-"));
  if (chord.key === "") return null;
  return chord;
}

/** Chord id for a real keyboard event, matching `chordId()` exactly. */
export function chordIdFromEvent(event: {
  altKey?: boolean;
  ctrlKey?: boolean;
  key: string;
  metaKey?: boolean;
  shiftKey?: boolean;
}): string {
  return chordId({
    alt: event.altKey === true,
    ctrl: event.ctrlKey === true,
    key: normalizeKeyName(String(event.key ?? "")),
    meta: event.metaKey === true,
    shift: event.shiftKey === true,
  });
}

/** Display form: `ctrl-shift-p` → `Ctrl+Shift+P`. */
export function formatChordId(id: string): string {
  const labels: Record<string, string> = {
    alt: "Alt",
    ctrl: "Ctrl",
    delete: "Del",
    down: "Down",
    enter: "Enter",
    escape: "Esc",
    left: "Left",
    meta: "Cmd",
    right: "Right",
    shift: "Shift",
    space: "Space",
    tab: "Tab",
    up: "Up",
  };
  return id
    .split("-")
    .map((part) => labels[part] ?? (part.length === 1 ? part.toUpperCase() : part))
    .join("+");
}

/**
 * Keys that are never *typed*, so claiming one cannot break text entry.
 * Everything else needs a real modifier.
 */
const NAMED_KEYS = new Set([
  "arrowdown",
  "arrowleft",
  "arrowright",
  "arrowup",
  "backspace",
  "delete",
  "down",
  "end",
  "enter",
  "escape",
  "home",
  "insert",
  "left",
  "pagedown",
  "pageup",
  "right",
  "tab",
  "up",
]);

/**
 * May this chord be claimed from the editor?
 *
 * The editor document consumes a claimed chord before CodeMirror sees it, so
 * a plugin that bound a bare character (or Shift+character) would silently
 * swallow the user's typing. Modifier chords and non-typing named keys are
 * claimable; anything else is refused and reported as unbound.
 */
export function isClaimableChord(chord: KeyChord): boolean {
  if (chord.ctrl || chord.alt || chord.meta) return true;
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(chord.key)) return true;
  return NAMED_KEYS.has(chord.key);
}

/**
 * Which entry of a `bindKey` platform map applies to a running OS. Ajiro is a
 * mobile app, so `ios` reads the `mac` entry and `android` the `linux` one.
 */
export function acodePlatformForOS(os: string): "mac" | "win" | "linux" {
  if (os === "ios" || os === "macos" || os === "darwin") return "mac";
  if (os === "android" || os === "linux") return "linux";
  return "win";
}

/** Resolve a `bindKey` map to the spec that applies, with fallbacks. */
export function resolveBindingSpec(
  bindKey: Record<string, string> | null | undefined,
  platform: string,
): string | null {
  if (!bindKey || typeof bindKey !== "object") return null;
  const preferred = bindKey[platform];
  if (typeof preferred === "string" && preferred.trim() !== "") return preferred;
  for (const fallback of ["mac", "win", "linux"]) {
    const spec = bindKey[fallback];
    if (typeof spec === "string" && spec.trim() !== "") return spec;
  }
  const first = Object.values(bindKey).find(
    (spec) => typeof spec === "string" && spec.trim() !== "",
  );
  return first ?? null;
}

export type KeyBindingTable = {
  clear(pluginId?: string): void;
  conflicts(): KeyBindingConflict[];
  list(): KeyBinding[];
  match(chordId: string): KeyBindingResolution;
  register(input: {
    bindKey: Record<string, string> | null | undefined;
    commandId: string;
    pluginId: string;
  }): KeyBinding | null;
  /** Canonical chord ids for surface components (the editor document). */
  chordIds(): string[];
  subscribe(listener: () => void): () => void;
};

/**
 * The live binding table. Only chords that resolve to exactly one command can
 * fire; every other chord reports why it could not.
 */
export function createKeyBindingTable(platform: string): KeyBindingTable {
  const bindings = new Map<string, KeyBinding>();
  const listeners = new Set<() => void>();

  const keyFor = (pluginId: string, commandId: string) => `${pluginId}::${commandId}`;

  function emit(): void {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        // A broken listener must not break the table.
      }
    }
  }

  function conflicts(): KeyBindingConflict[] {
    const byChord = new Map<string, KeyBinding[]>();
    for (const binding of bindings.values()) {
      const group = byChord.get(binding.chordId) ?? [];
      group.push(binding);
      byChord.set(binding.chordId, group);
    }
    return [...byChord.entries()]
      .filter(([, group]) => group.length > 1)
      .map(([id, group]) => ({ bindings: group, chordId: id }))
      .sort((left, right) => left.chordId.localeCompare(right.chordId));
  }

  return {
    clear(pluginId) {
      if (!pluginId) {
        bindings.clear();
        emit();
        return;
      }
      for (const [key, binding] of bindings) {
        if (binding.pluginId === pluginId) bindings.delete(key);
      }
      emit();
    },

    chordIds: () => [...new Set([...bindings.values()].map((entry) => entry.chordId))].sort(),

    conflicts,

    list: () =>
      [...bindings.values()].sort((left, right) =>
        left.chordId === right.chordId
          ? left.commandId.localeCompare(right.commandId)
          : left.chordId.localeCompare(right.chordId),
      ),

    match(id) {
      const group = [...bindings.values()].filter((binding) => binding.chordId === id);
      if (group.length === 0) return { chordId: id, status: "unbound" };
      if (group.length > 1) return { bindings: group, chordId: id, status: "conflict" };
      return { binding: group[0], chordId: id, status: "bound" };
    },

    register(input) {
      const spec = resolveBindingSpec(input.bindKey, platform);
      const chord = spec ? parseKeyChord(spec) : null;
      const key = keyFor(input.pluginId, input.commandId);
      if (!chord || !spec || !isClaimableChord(chord)) {
        bindings.delete(key);
        emit();
        return null;
      }
      const binding: KeyBinding = {
        chordId: chordId(chord),
        commandId: input.commandId,
        pluginId: input.pluginId,
        spec,
      };
      bindings.set(key, binding);
      emit();
      return binding;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
