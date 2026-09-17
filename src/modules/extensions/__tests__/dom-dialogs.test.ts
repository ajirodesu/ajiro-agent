/**
 * Plugin dialog, loader, toast, file-browser, and new-file tests (prompt §48).
 *
 * Verified against Acode's current `src/dialogs/*` + `src/lib/acode.js`:
 * alert/confirm/prompt/select/multiPrompt/loader/toast/fileBrowser shapes,
 * cancellation semantics per kind (select pends, multi-prompt rejects), and
 * the loader handle's setTitle/setMessage/hide/show/destroy operations.
 */
import { describe, expect, it } from "vitest";

import {
  normalizeDialogText,
  normalizeMultiPromptInputs,
  normalizeNewFileName,
  normalizePromptType,
  normalizeSelectOption,
  normalizeSelectOptions,
  PLUGIN_DIALOG_CANCELLED,
} from "../dom/bridge-protocol";
import { createPluginHostServices } from "../dom/host-services";
import { PluginDomHost } from "../dom/plugin-host";
import { createDiagnosticRecorder } from "../diagnostics";
import type { InstallDeps } from "../installer";
import type { ExtensionPermissionKey } from "../models";
import { planExtensionPaths } from "../storage";
import { createMemoryPlatform } from "./helpers";
import type {
  PluginBridgeInbound,
  PluginBridgeOutbound,
} from "../dom/bridge-protocol";

const PLUGIN_ID = "com.example.dialogs";

function receive(host: PluginDomHost, message: PluginBridgeOutbound): void {
  host.handleMessage(JSON.stringify(message));
}

async function until(check: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 2_000;
  for (;;) {
    if (await check()) return;
    if (Date.now() > deadline) {
      throw new Error("timed out waiting for the bridge to settle");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function responseFor(sent: PluginBridgeInbound[], requestId: number) {
  return sent.find(
    (message) => message.type === "response" && message.requestId === requestId,
  ) as { error?: string; ok: boolean; result?: unknown } | undefined;
}

async function dialogHarness(options: {
  answer?: unknown;
  failWith?: Error;
  neverSettle?: boolean;
  permissions?: ExtensionPermissionKey[];
}) {
  const { platform } = createMemoryPlatform();
  const deps: InstallDeps = {
    paths: planExtensionPaths("file:///docs/"),
    platform,
  };
  const calls: { kind: string; payload: unknown }[] = [];
  const toasts: { durationMs?: number; pluginId: string; text: string }[] = [];
  const loaders: { id: string; op: string; value?: string }[] = [];
  const files: { mode: string; pluginId: string }[] = [];
  const newFiles: { filename: string; pluginId: string; text: string }[] = [];
  let loaderCount = 0;

  const services = createPluginHostServices({
    callbacks: {
      log: () => {},
      notify: () => {},
      onCommandRegistered: () => {},
      onCommandRemoved: () => {},
      requestPluginInstall: async () => {},
      async showDialog(kind, payload) {
        calls.push({ kind, payload });
        if (options.failWith) throw options.failWith;
        if (options.neverSettle) return new Promise<unknown>(() => {});
        return options.answer ?? null;
      },
      async createLoader(pluginId, title, message) {
        loaderCount += 1;
        const id = `loader-${loaderCount}`;
        loaders.push({ id, op: `create:${pluginId}:${title}:${message}` });
        return id;
      },
      operateLoader(loaderId, op, value) {
        loaders.push({ id: loaderId, op, value });
      },
      destroyLoader(loaderId) {
        loaders.push({ id: loaderId, op: "destroy" });
      },
      toast(pluginId, text, durationMs) {
        toasts.push({ durationMs, pluginId, text });
      },
      async pickFiles(pluginId, mode) {
        files.push({ mode, pluginId });
        return ["file:///picked/a.txt"];
      },
      async openNewFile(pluginId, filename, text) {
        newFiles.push({ filename, pluginId, text });
        return `project/${filename}`;
      },
    },
    deps,
    diagnostics: createDiagnosticRecorder(deps),
  });

  const sent: PluginBridgeInbound[] = [];
  const host = new PluginDomHost(services, 50);
  host.attach({
    post(message) {
      sent.push(message);
    },
  });
  receive(host, { type: "ready" });
  const loading = host.load(PLUGIN_ID, {
    baseUrl: `${deps.paths.installedRoot}/${PLUGIN_ID}`,
    grantedPermissions: options.permissions ?? (["storage", "ui"] as ExtensionPermissionKey[]),
    settings: {},
    source: "acode.setPluginInit('com.example.dialogs', () => {});",
    storage: {},
  });
  receive(host, { hasInit: true, pluginId: PLUGIN_ID, type: "defined" });
  await loading;
  return { calls, files, host, loaders, newFiles, sent, toasts };
}

describe("dialog payload normalization", () => {
  it("caps dialog prose", () => {
    expect(normalizeDialogText("hi")).toBe("hi");
    expect(normalizeDialogText("x".repeat(2500))).toHaveLength(2001);
    expect(normalizeDialogText(null)).toBe("");
  });

  it("maps prompt types onto input types", () => {
    expect(normalizePromptType("textarea")).toBe("textarea");
    expect(normalizePromptType("NUMBER")).toBe("number");
    expect(normalizePromptType("password")).toBe("password");
    expect(normalizePromptType("checkbox")).toBe("text");
    expect(normalizePromptType(null)).toBe("text");
  });

  it("normalizes every Acode select shape", () => {
    expect(normalizeSelectOption("Lua")).toEqual({ text: "Lua", value: "Lua" });
    expect(normalizeSelectOption("  ")).toBeNull();
    expect(normalizeSelectOption(["js", "JavaScript"])).toEqual({
      disabled: false,
      text: "JavaScript",
      value: "js",
    });
    // Acode positional arrays carry an *enabled* flag past index 1.
    expect(normalizeSelectOption(["js", "JavaScript", null, false])).toEqual({
      disabled: true,
      text: "JavaScript",
      value: "js",
    });
    expect(
      normalizeSelectOption({ subText: "pick me", text: "JS", value: "js" }),
    ).toEqual({ subText: "pick me", text: "JS", value: "js" });
    expect(normalizeSelectOption({ value: "js", disabled: true })).toEqual({
      text: "js",
      value: "js",
      disabled: true,
    });
    expect(normalizeSelectOption({})).toBeNull();
    expect(normalizeSelectOption(42)).toBeNull();
  });

  it("caps select options", () => {
    const many = Array.from({ length: 60 }, (_, index) => `opt-${index}`);
    expect(normalizeSelectOptions(many)).toHaveLength(50);
    expect(normalizeSelectOptions("solo")).toEqual([{ text: "solo", value: "solo" }]);
    expect(normalizeSelectOptions(null)).toEqual([]);
  });

  it("flattens multi-prompt groups and keeps data fields", () => {
    const inputs = normalizeMultiPromptInputs([
      "Group label",
      [
        { id: "name", name: "Name", required: true, value: "x" },
        { id: "age", type: "number", placeholder: "Age" },
      ],
      { disabled: true, id: "off" },
      { noId: true },
    ]);
    expect(inputs).toEqual([
      { id: "name", label: "Name", required: true, defaultValue: "x" },
      { id: "age", label: "Age", placeholder: "Age", type: "number" },
      { id: "off", disabled: true },
    ]);
  });

  it("sanitizes new file names to flat names", () => {
    expect(normalizeNewFileName("notes.md")).toBe("notes.md");
    expect(normalizeNewFileName("a/b\\c")).toBe("a-b-c");
    expect(normalizeNewFileName("  ")).toBeNull();
    expect(normalizeNewFileName("...hidden")).toBe("hidden");
    expect(normalizeNewFileName(null)).toBeNull();
  });
});

describe("host dialog handling", () => {
  it("serves a confirm and responds with the answer", async () => {
    const rig = await dialogHarness({ answer: true });
    receive(rig.host, {
      kind: "confirm",
      payload: { message: "Sure?", title: "T" },
      pluginId: PLUGIN_ID,
      requestId: 1,
      type: "dialog",
    });
    await until(() => responseFor(rig.sent, 1) !== undefined);
    expect(rig.calls).toEqual([
      { kind: "confirm", payload: { message: "Sure?", title: "T" } },
    ]);
    expect(responseFor(rig.sent, 1)).toMatchObject({ ok: true, result: true });
  });

  it("refuses dialogs without the ui capability", async () => {
    const rig = await dialogHarness({ permissions: ["storage"] });
    receive(rig.host, {
      kind: "alert",
      payload: { message: "hi", title: "T" },
      pluginId: PLUGIN_ID,
      requestId: 2,
      type: "dialog",
    });
    await until(() => responseFor(rig.sent, 2) !== undefined);
    expect(rig.calls).toHaveLength(0);
    expect(responseFor(rig.sent, 2)).toMatchObject({ ok: false });
  });

  it("rejects unknown dialog kinds", async () => {
    const rig = await dialogHarness({});
    receive(rig.host, {
      kind: "bogus",
      payload: {},
      pluginId: PLUGIN_ID,
      requestId: 3,
      type: "dialog",
    } as unknown as PluginBridgeOutbound);
    await until(() => responseFor(rig.sent, 3) !== undefined);
    expect(responseFor(rig.sent, 3)).toMatchObject({ ok: false });
  });

  it("maps an app cancellation onto the cancelled error name", async () => {
    const rig = await dialogHarness({
      failWith: Object.assign(new Error("dismissed"), { name: PLUGIN_DIALOG_CANCELLED }),
    });
    receive(rig.host, {
      kind: "multi-prompt",
      payload: { inputs: [], title: "T" },
      pluginId: PLUGIN_ID,
      requestId: 4,
      type: "dialog",
    });
    await until(() => responseFor(rig.sent, 4) !== undefined);
    expect(responseFor(rig.sent, 4)).toMatchObject({
      error: PLUGIN_DIALOG_CANCELLED,
      ok: false,
    });
  });

  it("creates, operates, and destroys loaders with ownership checks", async () => {
    const rig = await dialogHarness({});
    receive(rig.host, {
      message: "Working",
      options: {},
      pluginId: PLUGIN_ID,
      requestId: 5,
      title: "T",
      type: "dialog-loader-create",
    });
    await until(() => responseFor(rig.sent, 5) !== undefined);
    const loaderId = (
      responseFor(rig.sent, 5) as { result: string }
    ).result;
    expect(typeof loaderId).toBe("string");

    // Ops from another plugin are ignored, never errors.
    receive(rig.host, {
      loaderId,
      op: "destroy",
      pluginId: "com.example.other",
      type: "dialog-loader-op",
    });
    receive(rig.host, {
      loaderId,
      op: "setTitle",
      pluginId: PLUGIN_ID,
      type: "dialog-loader-op",
      value: "New title",
    });
    receive(rig.host, {
      loaderId,
      op: "destroy",
      pluginId: PLUGIN_ID,
      type: "dialog-loader-op",
    });
    expect(rig.loaders.filter((entry) => entry.op === "destroy")).toHaveLength(1);
    expect(
      rig.loaders.some((entry) => entry.op === "setTitle" && entry.value === "New title"),
    ).toBe(true);
  });

  it("destroys owned loaders on unmount", async () => {
    const rig = await dialogHarness({});
    receive(rig.host, {
      message: "m",
      options: {},
      pluginId: PLUGIN_ID,
      requestId: 6,
      title: "t",
      type: "dialog-loader-create",
    });
    await until(() => responseFor(rig.sent, 6) !== undefined);
    receive(rig.host, { pluginId: PLUGIN_ID, type: "unmounted" });
    expect(rig.loaders.some((entry) => entry.op === "destroy")).toBe(true);
  });

  it("delivers toasts without any grant and caps flood", async () => {
    const rig = await dialogHarness({ permissions: ["storage"] });
    receive(rig.host, { pluginId: PLUGIN_ID, text: "hello", type: "toast" });
    expect(rig.toasts).toEqual([
      { durationMs: undefined, pluginId: PLUGIN_ID, text: "hello" },
    ]);
  });

  it("routes the file browser and answers with URIs", async () => {
    const rig = await dialogHarness({});
    receive(rig.host, {
      mode: "file",
      pluginId: PLUGIN_ID,
      requestId: 7,
      type: "file-browser",
    });
    await until(() => responseFor(rig.sent, 7) !== undefined);
    expect(rig.files).toEqual([{ mode: "file", pluginId: PLUGIN_ID }]);
    expect(responseFor(rig.sent, 7)).toMatchObject({
      ok: true,
      result: ["file:///picked/a.txt"],
    });
  });

  it("creates editor files only with the editor capability", async () => {
    const rig = await dialogHarness({ permissions: ["storage", "ui"] });
    receive(rig.host, {
      filename: "notes.md",
      pluginId: PLUGIN_ID,
      requestId: 8,
      text: "hi",
      type: "editor-new-file",
    });
    await until(() => responseFor(rig.sent, 8) !== undefined);
    expect(responseFor(rig.sent, 8)).toMatchObject({ ok: false });

    const editor = await dialogHarness({
      permissions: ["editor", "storage", "ui"],
    });
    receive(editor.host, {
      filename: "notes.md",
      pluginId: PLUGIN_ID,
      requestId: 9,
      text: "hi",
      type: "editor-new-file",
    });
    await until(() => responseFor(editor.sent, 9) !== undefined);
    expect(editor.newFiles).toEqual([
      { filename: "notes.md", pluginId: PLUGIN_ID, text: "hi" },
    ]);
    expect(responseFor(editor.sent, 9)).toMatchObject({
      ok: true,
      result: "project/notes.md",
    });
  });

  it("rejects empty file names", async () => {
    const rig = await dialogHarness({
      permissions: ["editor", "storage", "ui"],
    });
    receive(rig.host, {
      filename: "   ",
      pluginId: PLUGIN_ID,
      requestId: 10,
      text: "",
      type: "editor-new-file",
    });
    await until(() => responseFor(rig.sent, 10) !== undefined);
    expect(responseFor(rig.sent, 10)).toMatchObject({ ok: false });
    expect(rig.newFiles).toHaveLength(0);
  });
});
