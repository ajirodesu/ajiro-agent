/**
 * Formatter bridge tests: registration mirror, permission gating, selection
 * resolution (explicit, stale-pruning, single-candidate auto-pick), and the
 * format-request → format-apply round trip against a fake editor.
 */
import { describe, expect, it } from "vitest";

import { createDiagnosticRecorder } from "../diagnostics";
import { resetActiveEditorAccess, setActiveEditorAccess } from "../dom/editor-access";
import { PluginDomHost, type PluginHostTransport } from "../dom/plugin-host";
import { createPluginHostServices } from "../dom/host-services";
import { createMemoryFormatterSelections } from "../formatters";
import type { InstallDeps } from "../installer";
import type { ExtensionPermissionKey } from "../models";
import { planExtensionPaths } from "../storage";
import { createMemoryPlatform } from "./helpers";

const PLUGIN_ID = "com.example.formatter";
const OTHER_ID = "com.example.other";

function setup(options: {
  permissions?: ExtensionPermissionKey[];
  selections?: Record<string, string>;
  editor?: { languageId: string | null; path: string; text: string } | null;
} = {}) {
  const { platform } = createMemoryPlatform();
  const deps: InstallDeps = { paths: planExtensionPaths("file:///docs/"), platform };
  const logs: string[] = [];
  let written: string | null = null;
  const services = createPluginHostServices({
    callbacks: {
      log: (_pluginId, _level, message) => {
        logs.push(message);
      },
      notify: () => {},
      onCommandRegistered: () => {},
      onCommandRemoved: () => {},
      requestPluginInstall: () => Promise.resolve(),
    },
    deps,
    diagnostics: createDiagnosticRecorder(deps),
  });
  const selections = createMemoryFormatterSelections(options.selections ?? {});
  const host = new PluginDomHost(services, 50, selections);
  const sent: { type: string; requestId?: number; [key: string]: unknown }[] = [];
  const transport: PluginHostTransport = {
    post: (message) => {
      sent.push(message as { type: string; requestId?: number; [key: string]: unknown });
    },
  };
  host.attach(transport);
  host.handleMessage(JSON.stringify({ type: "ready" }));
  resetActiveEditorAccess();
  if (options.editor !== null) {
    const snapshot = options.editor ?? { languageId: "typescript", path: "a.ts", text: "const x=1" };
    setActiveEditorAccess({
      read: () => snapshot,
      replaceAll: (text) => {
        written = text;
        return true;
      },
    });
  }
  return {
    deps,
    host,
    logs,
    selections,
    sent,
    written: () => written,
  };
}

async function loadPlugin(
  host: PluginDomHost,
  pluginId: string,
  permissions: ExtensionPermissionKey[],
) {
  const loading = host.load(pluginId, {
    baseUrl: "file:///docs/installed/",
    grantedPermissions: permissions,
    settings: {},
    source: "acode.setPluginInit('x', () => {});",
    storage: {},
  });
  host.handleMessage(JSON.stringify({ hasInit: true, pluginId, type: "defined" }));
  await loading;
}

function post(host: PluginDomHost, message: Record<string, unknown>) {
  host.handleMessage(JSON.stringify(message));
}

function responseFor(
  sent: { type: string; requestId?: number; [key: string]: unknown }[],
  requestId: number,
) {
  return sent.find((message) => message.type === "response" && message.requestId === requestId);
}

async function untilResponse(
  sent: { type: string; requestId?: number; [key: string]: unknown }[],
  requestId: number,
) {
  const deadline = Date.now() + 2_000;
  for (;;) {
    const response = responseFor(sent, requestId);
    if (response) return response;
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for response ${requestId}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("formatter registration mirror", () => {
  it("stores registrations from defined plugins only", async () => {
    const { host } = setup();
    await loadPlugin(host, PLUGIN_ID, ["editor"]);
    post(host, {
      displayName: "Pretty",
      extensions: ["js", "ts"],
      formatterId: "pretty",
      pluginId: PLUGIN_ID,
      type: "formatter-register",
    });
    expect(host.listFormatters()).toEqual([
      { displayName: "Pretty", extensions: ["js", "ts"], formatterId: "pretty", pluginId: PLUGIN_ID },
    ]);
    // Unknown plugin: dropped silently.
    post(host, {
      displayName: "Evil",
      extensions: ["js"],
      formatterId: "evil",
      pluginId: "com.ghost.plugin",
      type: "formatter-register",
    });
    expect(host.listFormatters()).toHaveLength(1);
  });

  it("only the owner may unregister", async () => {
    const { host } = setup();
    await loadPlugin(host, PLUGIN_ID, ["editor"]);
    await loadPlugin(host, OTHER_ID, ["editor"]);
    post(host, {
      displayName: "Pretty",
      extensions: ["js"],
      formatterId: "pretty",
      pluginId: PLUGIN_ID,
      type: "formatter-register",
    });
    post(host, { formatterId: "pretty", pluginId: OTHER_ID, type: "formatter-unregister" });
    expect(host.listFormatters()).toHaveLength(1);
    post(host, { formatterId: "pretty", pluginId: PLUGIN_ID, type: "formatter-unregister" });
    expect(host.listFormatters()).toEqual([]);
  });

  it("drops registrations on unmount", async () => {
    const { host } = setup();
    await loadPlugin(host, PLUGIN_ID, ["editor"]);
    post(host, {
      displayName: "Pretty",
      extensions: ["js"],
      formatterId: "pretty",
      pluginId: PLUGIN_ID,
      type: "formatter-register",
    });
    expect(host.listFormatters()).toHaveLength(1);
    await host.unmount(PLUGIN_ID);
    expect(host.listFormatters()).toEqual([]);
  });
});

describe("format-request orchestration", () => {
  it("refuses callers without the editor capability", async () => {
    const { host, sent } = setup();
    await loadPlugin(host, PLUGIN_ID, ["storage"]);
    post(host, { pluginId: PLUGIN_ID, requestId: 1, type: "format-request" });
    const response = responseFor(sent, 1);
    expect(response?.ok).toBe(false);
  });

  it("errors when no document is open", async () => {
    const { host, sent } = setup({ editor: null });
    await loadPlugin(host, PLUGIN_ID, ["editor"]);
    post(host, { pluginId: PLUGIN_ID, requestId: 1, type: "format-request" });
    expect(responseFor(sent, 1)?.ok).toBe(false);
  });

  it("resolves an explicit selection into a job", async () => {
    const { host, sent } = setup({ selections: { typescript: "pretty" } });
    await loadPlugin(host, PLUGIN_ID, ["editor"]);
    post(host, {
      displayName: "Pretty",
      extensions: ["js", "ts"],
      formatterId: "pretty",
      pluginId: PLUGIN_ID,
      type: "formatter-register",
    });
    post(host, { pluginId: PLUGIN_ID, requestId: 7, type: "format-request" });
    const response = await untilResponse(sent, 7);
    expect(response?.ok).toBe(true);
    const job = response?.result as { formatterId: string; languageId: string; path: string; text: string };
    expect(job.formatterId).toBe("pretty");
    expect(job.text).toBe("const x=1");
    expect(job.languageId).toBe("typescript");
  });

  it("prunes stale selections instead of failing forever", async () => {
    const { host, selections, sent } = setup({ selections: { typescript: "gone" } });
    await loadPlugin(host, PLUGIN_ID, ["editor"]);
    post(host, { pluginId: PLUGIN_ID, requestId: 3, type: "format-request" });
    expect((await untilResponse(sent, 3))?.ok).toBe(false);
    expect(await selections.loadSelections()).toEqual({});
  });

  it("auto-picks an unambiguous single candidate", async () => {
    const { host, sent } = setup();
    await loadPlugin(host, PLUGIN_ID, ["editor"]);
    post(host, {
      displayName: "Pretty",
      extensions: ["ts"],
      formatterId: "pretty",
      pluginId: PLUGIN_ID,
      type: "formatter-register",
    });
    post(host, { pluginId: PLUGIN_ID, requestId: 4, type: "format-request" });
    const response = await untilResponse(sent, 4);
    expect(response?.ok).toBe(true);
    expect((response?.result as { formatterId: string }).formatterId).toBe("pretty");
  });

  it("refuses to guess between several candidates", async () => {
    const { host, sent } = setup();
    await loadPlugin(host, PLUGIN_ID, ["editor"]);
    await loadPlugin(host, OTHER_ID, ["editor"]);
    post(host, {
      displayName: "A",
      extensions: ["ts"],
      formatterId: "a",
      pluginId: PLUGIN_ID,
      type: "formatter-register",
    });
    post(host, {
      displayName: "B",
      extensions: ["ts"],
      formatterId: "b",
      pluginId: OTHER_ID,
      type: "formatter-register",
    });
    post(host, { pluginId: PLUGIN_ID, requestId: 5, type: "format-request" });
    expect((await untilResponse(sent, 5))?.ok).toBe(false);
  });
});

describe("format-apply", () => {
  it("writes the formatted text through the editor bridge", async () => {
    const { host, sent, written } = setup();
    await loadPlugin(host, PLUGIN_ID, ["editor"]);
    post(host, { pluginId: PLUGIN_ID, requestId: 9, text: "const x = 1;\n", type: "format-apply" });
    expect(responseFor(sent, 9)?.ok).toBe(true);
    expect(written()).toBe("const x = 1;\n");
  });

  it("refuses non-string results and missing capability", async () => {
    const { host, sent } = setup();
    await loadPlugin(host, PLUGIN_ID, ["storage"]);
    post(host, { pluginId: PLUGIN_ID, requestId: 11, text: "x", type: "format-apply" });
    expect(responseFor(sent, 11)?.ok).toBe(false);
    await loadPlugin(host, OTHER_ID, ["editor"]);
    post(host, { pluginId: OTHER_ID, requestId: 12, text: 42, type: "format-apply" });
    expect(responseFor(sent, 12)?.ok).toBe(false);
  });
});
