/**
 * Plugin command key bindings (§45): spec parsing, platform resolution,
 * canonical chord identity shared with the editor document, and the conflict
 * rule that stops one plugin from silently stealing another's key.
 */
import { describe, expect, it } from "vitest";

import { createPluginCommandRegistry } from "../command-registry";
import {
  acodePlatformForOS,
  chordId,
  chordIdFromEvent,
  createKeyBindingTable,
  formatChordId,
  isClaimableChord,
  parseKeyChord,
  resolveBindingSpec,
} from "../key-bindings";

describe("key spec parsing", () => {
  it("parses Acode specs into modifier flags plus a key", () => {
    expect(parseKeyChord("Ctrl-Shift-P")).toEqual({
      alt: false,
      ctrl: true,
      key: "p",
      meta: false,
      shift: true,
    });
    expect(parseKeyChord("Cmd-Alt-Enter")).toEqual({
      alt: true,
      ctrl: false,
      key: "enter",
      meta: true,
      shift: false,
    });
  });

  it("accepts the modifier and key aliases plugins actually write", () => {
    const command = parseKeyChord("Command-Option-Space");
    expect(command).toMatchObject({ alt: true, key: "space", meta: true });
    expect(parseKeyChord("Super-Esc")).toMatchObject({ key: "escape", meta: true });
    expect(parseKeyChord("Win-Return")).toMatchObject({ key: "enter", meta: true });
    // `+` separators are as common as `-` in the wild.
    expect(parseKeyChord("Ctrl+P")).toMatchObject({ ctrl: true, key: "p" });
  });

  it("rejects specs that carry no key at all", () => {
    expect(parseKeyChord("")).toBeNull();
    expect(parseKeyChord("Ctrl-Shift")).toBeNull();
    expect(parseKeyChord("   ")).toBeNull();
  });

  it("derives the same chord id from a real event", () => {
    const spec = parseKeyChord("Ctrl-Shift-P");
    expect(spec).not.toBeNull();
    if (!spec) return;
    expect(chordId(spec)).toBe(
      chordIdFromEvent({ ctrlKey: true, key: "P", shiftKey: true }),
    );
    // Modifier order is fixed, so ids are canonical regardless of spec order.
    expect(chordIdFromEvent({ key: "p", shiftKey: true, ctrlKey: true })).toBe(
      "ctrl-shift-p",
    );
  });

  it("formats chord ids for display", () => {
    expect(formatChordId("ctrl-shift-p")).toBe("Ctrl+Shift+P");
    expect(formatChordId("meta-escape")).toBe("Cmd+Esc");
    expect(formatChordId("ctrl-alt-space")).toBe("Ctrl+Alt+Space");
  });

  it("refuses to claim a chord the user types", () => {
    // A bare character (or Shift+character) would swallow typing: the editor
    // document consumes claimed chords before CodeMirror sees them.
    for (const spec of ["a", "Shift-A", "1", "Shift-2"]) {
      const chord = parseKeyChord(spec);
      expect(chord).not.toBeNull();
      if (!chord) continue;
      expect(isClaimableChord(chord)).toBe(false);
    }
    // Modifier chords and keys nobody types are claimable.
    for (const spec of ["Ctrl-A", "Cmd-Shift-Z", "F5", "Escape", "ArrowLeft"]) {
      const chord = parseKeyChord(spec);
      expect(chord).not.toBeNull();
      if (!chord) continue;
      expect(isClaimableChord(chord)).toBe(true);
    }
  });

  it("maps the running OS onto the platform map Acode declares", () => {
    expect(acodePlatformForOS("ios")).toBe("mac");
    expect(acodePlatformForOS("android")).toBe("linux");
    expect(acodePlatformForOS("windows")).toBe("win");
    expect(acodePlatformForOS("web")).toBe("win");
  });

  it("resolves a platform map with fallbacks", () => {
    expect(
      resolveBindingSpec({ linux: "Ctrl-P", mac: "Cmd-P", win: "Ctrl-P" }, "mac"),
    ).toBe("Cmd-P");
    // A map that only knows one platform still yields a usable binding.
    expect(resolveBindingSpec({ win: "Ctrl-P" }, "mac")).toBe("Ctrl-P");
    expect(resolveBindingSpec({}, "mac")).toBeNull();
    expect(resolveBindingSpec(null, "mac")).toBeNull();
  });
});

describe("binding table", () => {
  it("binds a chord to exactly one command and resolves it", () => {
    const table = createKeyBindingTable("linux");
    const binding = table.register({
      bindKey: { linux: "Ctrl-Shift-R" },
      commandId: "run",
      pluginId: "com.a",
    });
    expect(binding?.chordId).toBe("ctrl-shift-r");
    expect(table.chordIds()).toEqual(["ctrl-shift-r"]);
    expect(table.match("ctrl-shift-r")).toMatchObject({
      binding: { commandId: "run", pluginId: "com.a" },
      status: "bound",
    });
    expect(table.match("ctrl-shift-x")).toEqual({
      chordId: "ctrl-shift-x",
      status: "unbound",
    });
  });

  it("refuses to dispatch a chord two commands claim", () => {
    const table = createKeyBindingTable("linux");
    table.register({
      bindKey: { linux: "Ctrl-P" },
      commandId: "open",
      pluginId: "com.a",
    });
    table.register({
      bindKey: { linux: "Ctrl-P" },
      commandId: "print",
      pluginId: "com.b",
    });
    expect(table.conflicts()).toHaveLength(1);
    const resolution = table.match("ctrl-p");
    expect(resolution.status).toBe("conflict");
    if (resolution.status !== "conflict") return;
    expect(resolution.bindings.map((entry) => entry.pluginId).sort()).toEqual([
      "com.a",
      "com.b",
    ]);
  });

  it("drops a binding whose spec does not apply to this platform", () => {
    const table = createKeyBindingTable("linux");
    expect(
      table.register({ bindKey: null, commandId: "noop", pluginId: "com.a" }),
    ).toBeNull();
    expect(table.list()).toEqual([]);
  });

  it("refuses a binding that would steal a typed character", () => {
    const table = createKeyBindingTable("linux");
    expect(
      table.register({
        bindKey: { linux: "a" },
        commandId: "steal",
        pluginId: "com.a",
      }),
    ).toBeNull();
    expect(table.chordIds()).toEqual([]);
    // The refusal is recorded on the command, so the Store can say why.
    const registry = createPluginCommandRegistry(undefined, { platform: "linux" });
    registry.register("com.a", { bindKey: { linux: "a" }, exec: true, name: "steal" });
    expect(registry.list()[0].chordId).toBeNull();
    expect(registry.list()[0].bindKey).toEqual({ linux: "a" });
  });

  it("clears per plugin, or entirely", () => {
    const table = createKeyBindingTable("linux");
    table.register({ bindKey: { linux: "Ctrl-1" }, commandId: "one", pluginId: "com.a" });
    table.register({ bindKey: { linux: "Ctrl-2" }, commandId: "two", pluginId: "com.b" });
    table.clear("com.a");
    expect(table.list().map((entry) => entry.pluginId)).toEqual(["com.b"]);
    table.clear();
    expect(table.list()).toEqual([]);
  });

  it("notifies subscribers on every change", () => {
    const table = createKeyBindingTable("linux");
    let changes = 0;
    const unsubscribe = table.subscribe(() => {
      changes += 1;
    });
    table.register({ bindKey: { linux: "Ctrl-K" }, commandId: "k", pluginId: "com.a" });
    table.clear();
    unsubscribe();
    table.register({ bindKey: { linux: "Ctrl-L" }, commandId: "l", pluginId: "com.a" });
    expect(changes).toBe(2);
  });
});

describe("command registry bindings", () => {
  it("mirrors bindKey into a chord and reports it on the command", () => {
    const registry = createPluginCommandRegistry(undefined, { platform: "linux" });
    registry.register("com.a", {
      bindKey: { linux: "Ctrl-Alt-T" },
      exec: true,
      name: "transform",
    });
    expect(registry.list()).toEqual([
      {
        bindKey: { linux: "Ctrl-Alt-T" },
        chordId: "ctrl-alt-t",
        description: null,
        executable: true,
        name: "transform",
        pluginId: "com.a",
      },
    ]);
    expect(registry.chordIds()).toEqual(["ctrl-alt-t"]);
  });

  it("dispatches a chord to the owning command's exec callback", () => {
    const invoked: string[] = [];
    const registry = createPluginCommandRegistry((name) => invoked.push(name), {
      platform: "mac",
    });
    registry.register("com.a", {
      bindKey: { mac: "Cmd-Shift-R", win: "Ctrl-Shift-R" },
      exec: true,
      name: "reload",
    });
    // Canonical order is ctrl, alt, shift, meta — the same order the editor
    // document builds from a real event.
    expect(registry.invokeChord("shift-meta-r").status).toBe("bound");
    expect(invoked).toEqual(["reload"]);
  });

  it("does not dispatch a declared-but-unexecutable command", () => {
    const invoked: string[] = [];
    const registry = createPluginCommandRegistry((name) => invoked.push(name));
    registry.register("com.a", { bindKey: { win: "Ctrl-R" }, name: "reload" });
    expect(registry.invokeChord("ctrl-r")).toEqual({
      chordId: "ctrl-r",
      status: "unbound",
    });
    expect(invoked).toEqual([]);
  });

  it("reports conflicts across plugins", () => {
    const registry = createPluginCommandRegistry(undefined, { platform: "win" });
    registry.register("com.a", { bindKey: { win: "Ctrl-P" }, exec: true, name: "a" });
    registry.register("com.b", { bindKey: { win: "Ctrl-P" }, exec: true, name: "b" });
    expect(registry.conflicts().map((entry) => entry.chordId)).toEqual(["ctrl-p"]);
    expect(registry.invokeChord("ctrl-p").status).toBe("conflict");
  });

  it("keeps the surviving command's chord when a sibling is removed", () => {
    const registry = createPluginCommandRegistry(undefined, { platform: "win" });
    registry.register("com.a", { bindKey: { win: "Ctrl-1" }, exec: true, name: "one" });
    registry.register("com.a", { bindKey: { win: "Ctrl-2" }, exec: true, name: "two" });
    registry.remove("com.a", "one");
    expect(registry.chordIds()).toEqual(["ctrl-2"]);
    expect(registry.invokeChord("ctrl-2").status).toBe("bound");
  });

  it("drops bindings when the plugin is cleared", () => {
    const registry = createPluginCommandRegistry(undefined, { platform: "win" });
    registry.register("com.a", { bindKey: { win: "Ctrl-9" }, exec: true, name: "nine" });
    registry.clear("com.a");
    expect(registry.chordIds()).toEqual([]);
    expect(registry.listBindings()).toEqual([]);
  });
});
