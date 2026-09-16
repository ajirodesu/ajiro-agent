/**
 * The plugin host document, executed for real (prompt §35-§49).
 *
 * `dom-host.test.ts` verifies the *host* state machine against a simulated
 * document. This suite closes the other half of that gap: it builds the real
 * document with `buildPluginHostDocument`, runs it in a real DOM (jsdom) with
 * scripts enabled, wires the **real** `PluginDomHost` to it, and drives real
 * plugin entry scripts through the whole path —
 *
 *   plugin source → new Function → acode shim → real DOM page → bridge message
 *                 → host permission check → persisted write
 *
 * so the generated JavaScript is exercised rather than reasoned about. Only
 * the WebView itself is replaced. (jsdom is a dev dependency; it is never
 * bundled into the app.)
 */
import { afterEach, describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";

import { PLUGIN_READY_GLOBAL, PLUGIN_RUNTIME_GLOBAL } from "../dom/dom-protocol";
import { buildPluginHostDocument } from "../dom/dom-runtime-script";
import {
  PluginDomHost,
  type PluginHostEvent,
  type PluginHostServices,
} from "../dom/plugin-host";
import type {
  PluginBridgeInbound,
  PluginBridgeOutbound,
} from "../dom/bridge-protocol";

const PLUGIN_ID = "com.example.real";

const THEME = {
  accent: "#4c8dff",
  background: "#101418",
  backgroundElement: "#182027",
  border: "#26303a",
  text: "#e6edf3",
  textSecondary: "#93a1b1",
};

type Rig = {
  dom: JSDOM;
  /** Raw messages the document posted into React Native. */
  outbound: PluginBridgeOutbound[];
  host: PluginDomHost;
  events: PluginHostEvent[];
  /** Every message the host posted into the document. */
  sent: PluginBridgeInbound[];
  services: PluginHostServices;
  close(): void;
};

/**
 * A plugin host document mounted in a real DOM, with the real host attached
 * over the same `postMessage` channel the WebView surface uses.
 */
function mountDocument(overrides: Partial<PluginHostServices> = {}): Rig {
  const outbound: PluginBridgeOutbound[] = [];
  const sent: PluginBridgeInbound[] = [];

  const services: PluginHostServices = {
    execHostCommand: () => false,
    listPluginData: async () => [],
    log: () => {},
    notify: () => {},
    onCommandRegistered: () => {},
    onCommandRemoved: () => {},
    readActiveEditor: () => null,
    readPackageFile: async () => null,
    readPluginData: async () => ({}),
    requestPluginInstall: async () => {},
    setPluginSetting: async () => {},
    writeActiveEditor: () => false,
    writePluginData: async () => {},
    writePluginFile: async () => {},
    ...overrides,
  };

  const events: PluginHostEvent[] = [];
  const host = new PluginDomHost(services);
  host.subscribe((event) => events.push(event));

  // The host is attached before the document exists, because the document
  // posts `ready` while it is still being parsed: a transport that arrived
  // afterwards would miss it and every plugin would look unloadable.
  const mounted: { current: JSDOM | null } = { current: null };
  host.attach({
    post(message) {
      sent.push(message);
      const deliver = (mounted.current?.window as unknown as Record<string, unknown>)[
        PLUGIN_RUNTIME_GLOBAL
      ] as ((payload: PluginBridgeInbound) => void) | undefined;
      if (typeof deliver !== "function") {
        throw new Error("The document did not install its runtime inbox.");
      }
      deliver(JSON.parse(JSON.stringify(message)) as PluginBridgeInbound);
    },
  });

  const dom = new JSDOM(buildPluginHostDocument({ theme: THEME }), {
    beforeParse(window) {
      // The one WebView-provided global: the message channel. Everything the
      // document posts lands in the host exactly as it would on device.
      Object.defineProperty(window, "ReactNativeWebView", {
        configurable: true,
        value: {
          postMessage(raw: string) {
            outbound.push(JSON.parse(raw) as PluginBridgeOutbound);
            host.handleMessage(raw);
          },
        },
      });
    },
    pretendToBeVisual: true,
    runScripts: "dangerously",
    url: "https://plugin.ajiro.invalid/",
  });

  mounted.current = dom;

  return {
    close() {
      host.detach();
      dom.window.close();
    },
    dom,
    events,
    host,
    outbound,
    sent,
    services,
  };
}

/** Let the document's own timers and microtasks run. */
function settle(ms = 25): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const rigs: Rig[] = [];

function mount(overrides: Partial<PluginHostServices> = {}): Rig {
  const rig = mountDocument(overrides);
  rigs.push(rig);
  return rig;
}

afterEach(() => {
  while (rigs.length > 0) rigs.pop()?.close();
});

/**
 * A plugin that exercises the shim the way a real Acode plugin would: a page,
 * a storage write, a bridged storage read, a command, timers, and an unmount
 * callback.
 */
const PLUGIN_SOURCE = `
acode.setPluginInit("${PLUGIN_ID}", function (baseUrl, $page, cache) {
  $page.innerHTML = "<h1 id='title'>Hello from a plugin</h1>";
  $page.show();
  var storage = acode.require("storage");
  storage.set("runs", "5");
  // A bridged read: this resolves only when the host answers the request.
  storage.get("runs").then(function (value) {
    $page.innerHTML = "<h1 id='title'>Runs: " + value + "</h1>";
  });
  var commands = acode.require("commands");
  commands.addCommand({
    name: "greet",
    description: "Say hello",
    bindKey: { linux: "Ctrl-Shift-G" },
    exec: function () {
      document.getElementById("title").textContent = "Greeted";
      acode.pushNotification("Greeting", "The plugin command ran");
    },
  });
  window.setTimeout(function () {
    $page.shape = "settled";
  }, 5);
});

acode.setPluginUnmount("${PLUGIN_ID}", function () {
  // A real plugin persists state and tells the user as it shuts down, so
  // both must still be authorized while the unmount is completing.
  acode.require("storage").set("goodbye", "yes");
  acode.pushNotification("Bye", "unmounted");
});
`;

describe("plugin host document (executed in a real DOM)", () => {
  it("installs its runtime and reports ready", async () => {
    const rig = mount();
    await expect(rig.host.waitForReady(2_000)).resolves.toBeUndefined();

    expect((rig.dom.window as unknown as Record<string, unknown>)[PLUGIN_READY_GLOBAL]).toBe(
      true,
    );
    expect(rig.outbound.map((message) => message.type)).toContain("ready");
    expect(
      rig.dom.window.document.getElementById("ajiro-plugin-pages"),
    ).not.toBeNull();
  });

  it("runs a plugin entry script and renders its page into the DOM", async () => {
    const rig = mount({ readPluginData: async () => ({ runs: "4" }) });
    await rig.host.waitForReady(2_000);

    await rig.host.load(PLUGIN_ID, {
      baseUrl: "https://plugin.ajiro.invalid/com.example.real",
      grantedPermissions: ["commands", "notifications", "storage"],
      settings: {},
      source: PLUGIN_SOURCE,
      storage: { runs: "4" },
    });
    await rig.host.activate(PLUGIN_ID, { firstInit: true });

    // The page is real DOM the user could see, inside the page container.
    const container = rig.dom.window.document.getElementById("ajiro-plugin-pages");
    expect(container?.innerHTML).toContain('data-ajiro-page="main"');
    expect(rig.host.getPage()).toEqual({ pluginId: PLUGIN_ID, title: PLUGIN_ID });

    // The bridged storage read resolved with the value the host served, so
    // the request/response round trip works in both directions.
    await settle();
    expect(rig.dom.window.document.getElementById("title")?.textContent).toBe(
      "Runs: 4",
    );

    // Lifecycle reached the host as real messages.
    expect(rig.outbound.map((message) => message.type)).toEqual(
      expect.arrayContaining(["defined", "activated"]),
    );
    expect(rig.events.map((event) => event.type)).toContain("activated");
  });

  it("reads and writes plugin storage through the bridge", async () => {
    const writes: { kind: string; value: Record<string, unknown> }[] = [];
    const reads: string[] = [];
    const rig = mount({
      readPluginData: async (_pluginId, kind) => {
        reads.push(kind);
        return { runs: "4" };
      },
      writePluginData: async (_pluginId, kind, value) => {
        writes.push({ kind, value });
      },
    });
    await rig.host.waitForReady(2_000);
    await rig.host.load(PLUGIN_ID, {
      baseUrl: "https://plugin.ajiro.invalid/com.example.real",
      grantedPermissions: ["commands", "notifications", "storage"],
      settings: {},
      source: PLUGIN_SOURCE,
      storage: { runs: "4" },
    });
    await rig.host.activate(PLUGIN_ID, { firstInit: true });
    await settle();

    // Two reads: the plugin's `get`, and the read-modify-write behind `set`.
    expect(new Set(reads)).toEqual(new Set(["storage"]));
    expect(reads.length).toBeGreaterThanOrEqual(1);
    expect(writes).toHaveLength(1);
    expect(writes[0].kind).toBe("storage");
    // The value the plugin set is what the host persists.
    expect(writes[0].value).toEqual({ runs: "5" });
  });

  it("registers a command and executes it inside the document", async () => {
    const registered: string[] = [];
    const notices: string[] = [];
    const rig = mount({
      notify: (_pluginId, _level, text) => notices.push(text),
      onCommandRegistered: (_pluginId, command) => registered.push(command.name),
    });
    await rig.host.waitForReady(2_000);
    await rig.host.load(PLUGIN_ID, {
      baseUrl: "https://plugin.ajiro.invalid/com.example.real",
      grantedPermissions: ["commands", "notifications", "storage"],
      settings: {},
      source: PLUGIN_SOURCE,
      storage: {},
    });
    await rig.host.activate(PLUGIN_ID, { firstInit: true });

    expect(registered).toEqual(["greet"]);
    // The declared bindKey travelled with the registration, so the app can
    // bind it (§45).
    expect(rig.outbound).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: expect.objectContaining({ name: "greet" }),
          type: "command-register",
        }),
      ]),
    );
    expect(rig.host.runCommand("greet", { from: "test" })).toBe(true);
    await settle();

    // The plugin's own callback ran, changed its page, and its notification
    // reached the host with the permission it was granted.
    expect(
      rig.dom.window.document.getElementById("title")?.textContent,
    ).toBe("Greeted");
    // The notification carries the plugin id even though the command was
    // started by the app rather than by the plugin itself.
    expect(notices).toEqual(["Greeting — The plugin command ran"]);
  });

  it("reads and rewrites the active editor document, and nothing else", async () => {
    const open = {
      languageId: "typescript",
      path: "src/app.ts",
      text: "const value =   1;",
    };
    const writes: string[] = [];
    const rig = mount({
      readActiveEditor: () => ({ ...open }),
      writeActiveEditor: (text) => {
        writes.push(text);
        open.text = text;
        return true;
      },
    });
    await rig.host.waitForReady(2_000);
    await rig.host.load(PLUGIN_ID, {
      baseUrl: "https://plugin.ajiro.invalid/com.example.real",
      grantedPermissions: ["editor"],
      settings: {},
      source: `
acode.setPluginInit("${PLUGIN_ID}", function (baseUrl, $page) {
  var editor = acode.require("editor");
  editor.getFile().then(function (file) {
    $page.innerHTML =
      "<p id='file'>" + file.path + " (" + file.languageId + ")</p>";
  }).catch(function (error) {
    console.error("editor.getFile failed: " + (error && error.message));
  });
  editor.getText().then(function (text) {
    // A whitespace-collapsing transform, the kind of edit plugins perform.
    return editor.setText(text.replace(/\\s+/g, " "));
  }).catch(function (error) {
    console.error("editor.getText failed: " + (error && error.message));
  });
});
`,
      storage: {},
    });
    await rig.host.activate(PLUGIN_ID, { firstInit: true });
    await settle();

    expect(writes).toEqual(["const value = 1;"]);
    expect(rig.dom.window.document.getElementById("file")?.textContent).toBe(
      "src/app.ts (typescript)",
    );
  });

  it("refuses editor access the plugin was not granted", async () => {
    const reads: number[] = [];
    const rig = mount({
      readActiveEditor: () => {
        reads.push(1);
        return { languageId: null, path: "a.txt", text: "secret" };
      },
    });
    await rig.host.waitForReady(2_000);
    await rig.host.load(PLUGIN_ID, {
      baseUrl: "https://plugin.ajiro.invalid/com.example.real",
      grantedPermissions: ["storage"],
      settings: {},
      source: `
acode.setPluginInit("${PLUGIN_ID}", function () {
  acode.require("editor").getText();
});
`,
      storage: {},
    });
    await expect(rig.host.activate(PLUGIN_ID, { firstInit: true })).rejects.toThrow(
      /editor/,
    );
    // The host never even read the document: refusal happens before the data
    // leaves the app.
    expect(reads).toEqual([]);
  });

  it("refuses a bridge operation the plugin was not granted", async () => {
    const writes: unknown[] = [];
    const rig = mount({
      writePluginData: async () => {
        writes.push("written");
      },
    });
    await rig.host.waitForReady(2_000);
    await rig.host.load(PLUGIN_ID, {
      baseUrl: "https://plugin.ajiro.invalid/com.example.real",
      grantedPermissions: ["commands"],
      settings: {},
      source: PLUGIN_SOURCE,
      storage: {},
    });
    // `storage` was not granted, so the shim throws inside the plugin and the
    // failure is reported as an activation error instead of a silent write.
    await expect(rig.host.activate(PLUGIN_ID, { firstInit: true })).rejects.toThrow();
    expect(writes).toEqual([]);
    expect(rig.outbound.at(-1)).toMatchObject({ phase: "activate", type: "error" });
  });

  it("runs the plugin's unmount callback and tears its page down", async () => {
    const notices: string[] = [];
    const writes: Record<string, unknown>[] = [];
    const rig = mount({
      notify: (_pluginId, _level, text) => notices.push(text),
      readPluginData: async () => ({ runs: "4" }),
      writePluginData: async (_pluginId, _kind, value) => {
        writes.push(value);
      },
    });
    await rig.host.waitForReady(2_000);
    await rig.host.load(PLUGIN_ID, {
      baseUrl: "https://plugin.ajiro.invalid/com.example.real",
      grantedPermissions: ["commands", "notifications", "storage"],
      settings: {},
      source: PLUGIN_SOURCE,
      storage: {},
    });
    await rig.host.activate(PLUGIN_ID, { firstInit: true });
    await settle();
    expect(
      rig.dom.window.document.getElementById("ajiro-plugin-pages")?.innerHTML,
    ).toContain("Runs: 4");

    await rig.host.unmount(PLUGIN_ID);
    // Bridge writes are fire-and-forget: they land a tick after the callback.
    await settle();

    // The unmount callback could still reach the host: a plugin is allowed to
    // persist state or tell the user goodbye as it shuts down.
    expect(notices).toEqual(["Bye — unmounted"]);
    // The two writes this plugin makes may land in either order, so only
    // their content is asserted.
    expect(writes.some((value) => value.goodbye === "yes")).toBe(true);
    expect(
      rig.dom.window.document.getElementById("ajiro-plugin-pages")?.innerHTML,
    ).toBe("");
  });

  it("treats a plugin entry script that throws as a load failure, not a crash", async () => {
    const rig = mount();
    await rig.host.waitForReady(2_000);
    await expect(
      rig.host.load(PLUGIN_ID, {
        baseUrl: "https://plugin.ajiro.invalid/com.example.real",
        grantedPermissions: [],
        settings: {},
        source: `acode.setPluginInit("${PLUGIN_ID}", function () {
          throw new Error("init exploded");
        });`,
        storage: {},
      }),
    ).resolves.toBeUndefined();

    await expect(rig.host.activate(PLUGIN_ID, { firstInit: false })).rejects.toThrow(
      /init exploded/,
    );
    // The document survived: a second plugin still loads and activates.
    await rig.host.load("com.example.second", {
      baseUrl: "https://plugin.ajiro.invalid/second",
      grantedPermissions: [],
      settings: {},
      source: `acode.setPluginInit("com.example.second", function () {});`,
      storage: {},
    });
    await expect(
      rig.host.activate("com.example.second", { firstInit: true }),
    ).resolves.toBeUndefined();
  });

  it("reloads cleanly when the document is replaced", async () => {
    const first = mount();
    await first.host.waitForReady(2_000);
    await first.host.load(PLUGIN_ID, {
      baseUrl: "https://plugin.ajiro.invalid/com.example.real",
      grantedPermissions: ["commands", "notifications", "storage"],
      settings: {},
      source: PLUGIN_SOURCE,
      storage: {},
    });
    await first.host.activate(PLUGIN_ID, { firstInit: true });

    // A WebView remount is a brand-new document: the host must not believe
    // the previous document's registrations survived.
    first.host.detach();
    const second = mount({ readPluginData: async () => ({ runs: "4" }) });
    await second.host.waitForReady(2_000);
    expect(second.host.hasDefinition(PLUGIN_ID)).toBe(false);
    await second.host.load(PLUGIN_ID, {
      baseUrl: "https://plugin.ajiro.invalid/com.example.real",
      grantedPermissions: ["commands", "notifications", "storage"],
      settings: {},
      source: PLUGIN_SOURCE,
      storage: {},
    });
    await expect(
      second.host.activate(PLUGIN_ID, { firstInit: false }),
    ).resolves.toBeUndefined();
    await settle();
    expect(
      second.dom.window.document.getElementById("title")?.textContent,
    ).toBe("Runs: 4");
  });
});
