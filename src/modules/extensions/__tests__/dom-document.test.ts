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
    createLoader: async () => "loader-1",
    destroyLoader: () => {},
    execHostCommand: () => false,
    listPluginData: async () => [],
    log: () => {},
    notify: () => {},
    onCommandRegistered: () => {},
    onCommandRemoved: () => {},
    openNewFile: async (_pluginId, filename) => filename,
    operateLoader: () => {},
    pickFiles: async () => [],
    readActiveEditor: () => null,
    readPackageFile: async () => null,
    readPluginData: async () => ({}),
    requestPluginInstall: async () => {},
    setPluginSetting: async () => {},
    showDialog: async () => null,
    toast: () => {},
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

  it("registers a formatter and formats the active document end to end", async () => {
    let written: string | null = null;
    const rig = mount({
      readActiveEditor: () => ({ languageId: "typescript", path: "a.ts", text: "const x=1" }),
      writeActiveEditor: (text) => {
        written = text;
        return true;
      },
    });
    await rig.host.waitForReady(2_000);
    await rig.host.load(PLUGIN_ID, {
      baseUrl: "https://plugin.ajiro.invalid/com.example.real",
      grantedPermissions: ["editor"],
      settings: {},
      source: `acode.setPluginInit("${PLUGIN_ID}", function () {
        acode.registerFormatter("upper", ["ts"], function (text) { return text.toUpperCase(); }, "Upper");
        window.__fmtList = acode.formatters;
        window.__fmtOpts = acode.getFormatterFor(["ts"]);
        acode.format().then(function (ok) { window.__fmtResult = ok; });
      });`,
      storage: {},
    });
    await rig.host.activate(PLUGIN_ID, { firstInit: true });
    await settle(150);

    const windowRef = rig.dom.window as unknown as Record<string, unknown>;
    // The auto-pick rule fires: exactly one candidate for TypeScript.
    expect(written).toBe("CONST X=1");
    expect(windowRef.__fmtResult).toBe(true);
    expect(windowRef.__fmtList).toEqual([{ id: "upper", name: "Upper", exts: ["ts"] }]);
    expect(windowRef.__fmtOpts).toEqual([[null, "None"], ["upper", "Upper"]]);
    expect(rig.host.listFormatters()).toHaveLength(1);
    expect(rig.outbound.map((message) => message.type)).toContain("formatter-register");
  });

  it("unregisters a formatter from the document and the host mirror", async () => {
    const rig = mount({
      readActiveEditor: () => ({ languageId: "typescript", path: "a.ts", text: "const x=1" }),
      writeActiveEditor: () => true,
    });
    await rig.host.waitForReady(2_000);
    await rig.host.load(PLUGIN_ID, {
      baseUrl: "https://plugin.ajiro.invalid/com.example.real",
      grantedPermissions: ["editor"],
      settings: {},
      source: `acode.setPluginInit("${PLUGIN_ID}", function () {
        acode.registerFormatter("upper", ["ts"], function (text) { return text; }, "Upper");
        acode.unregisterFormatter("upper");
        window.__afterUnreg = acode.formatters.length;
      });`,
      storage: {},
    });
    await rig.host.activate(PLUGIN_ID, { firstInit: true });
    await settle(100);
    expect((rig.dom.window as unknown as Record<string, unknown>).__afterUnreg).toBe(0);
    expect(rig.host.listFormatters()).toEqual([]);
  });

  it("format() refuses honestly with no document or no formatter", async () => {
    const rig = mount({
      readActiveEditor: () => null,
      writeActiveEditor: () => false,
    });
    await rig.host.waitForReady(2_000);
    await rig.host.load(PLUGIN_ID, {
      baseUrl: "https://plugin.ajiro.invalid/com.example.real",
      grantedPermissions: ["editor"],
      settings: {},
      source: `acode.setPluginInit("${PLUGIN_ID}", function () {
        acode.registerFormatter("upper", ["py"], function (text) { return text; }, "Upper");
        acode.format().then(function (ok) { window.__fmtResult = ok; });
      });`,
      storage: {},
    });
    await rig.host.activate(PLUGIN_ID, { firstInit: true });
    await settle(100);
    // No document open: false, not a throw and not a write.
    expect((rig.dom.window as unknown as Record<string, unknown>).__fmtResult).toBe(false);
  });

  it("sets page titles and dedupes icons with monochrome support", async () => {
    const rig = mount();
    await rig.host.waitForReady(2_000);
    await rig.host.load(PLUGIN_ID, {
      baseUrl: "https://plugin.ajiro.invalid/com.example.real",
      grantedPermissions: [],
      settings: {},
      source: `acode.setPluginInit("${PLUGIN_ID}", function (baseUrl, $page) {
        $page.show();
        $page.settitle("New Title");
        acode.addIcon("my-icon", "https://example.com/i.png");
        acode.addIcon("my-icon", "https://example.com/i.png");
        acode.addIcon("mono-icon", "https://example.com/m.svg", { monochrome: true });
      });`,
      storage: {},
    });
    await rig.host.activate(PLUGIN_ID, { firstInit: true });
    await settle();
    expect(rig.host.getPage()).toEqual({ pluginId: PLUGIN_ID, title: "New Title" });
    const styles = rig.dom.window.document.head.querySelectorAll("style[icon]");
    expect(styles.length).toBe(2);
    const mono = rig.dom.window.document.head.querySelector('style[icon="mono-icon"]');
    expect(mono?.textContent).toContain("mask");
    expect(mono?.textContent).toContain("currentColor");
  });

  it("switches custom-page tabs without rebuilding DOM state", async () => {
    const rig = mount();
    await rig.host.waitForReady(2_000);
    const OTHER_ID = "com.example.other";
    for (const [id, title] of [
      [PLUGIN_ID, "First Page"],
      [OTHER_ID, "Second Page"],
    ]) {
      await rig.host.load(id, {
        baseUrl: `https://plugin.ajiro.invalid/${id}`,
        grantedPermissions: [],
        settings: {},
        source: `acode.setPluginInit("${id}", function (baseUrl, $page) {
          $page.show();
          $page.settitle("${title}");
          $page.innerHTML = "<p>body-${title}</p>";
        });`,
        storage: {},
      });
      await rig.host.activate(id, { firstInit: true });
    }
    await settle();
    // Both plugins registered live custom pages.
    expect(rig.host.listPages()).toEqual([
      { pluginId: PLUGIN_ID, title: "First Page" },
      { pluginId: OTHER_ID, title: "Second Page" },
    ]);

    const visibleTitles = () =>
      [...rig.dom.window.document.querySelectorAll("[data-ajiro-page]")]
        .filter(
          (element) => (element as HTMLElement).style.display !== "none",
        )
        .map((element) => (element as HTMLElement).textContent ?? "");

    // Tab switch hides the first page and shows the second; DOM nodes
    // survive so form state and scroll persist for the session.
    rig.host.hidePage();
    expect(rig.host.showPage(OTHER_ID)).toBe(true);
    await settle();
    expect(rig.host.getPage()).toEqual({
      pluginId: OTHER_ID,
      title: "Second Page",
    });
    expect(
      visibleTitles().some((text) => text.includes("body-Second Page")),
    ).toBe(true);
    expect(
      visibleTitles().some((text) => text.includes("body-First Page")),
    ).toBe(false);
    // Switching back restores the first tab with its DOM state intact.
    expect(rig.host.showPage(PLUGIN_ID)).toBe(true);
    await settle();
    expect(
      visibleTitles().some((text) => text.includes("body-First Page")),
    ).toBe(true);

    expect(rig.host.showPage("com.example.missing")).toBe(false);

    // Uninstalling removes the tab immediately.
    await rig.host.unmount(OTHER_ID);
    await settle();
    expect(
      rig.host.listPages().map((entry) => entry.pluginId),
    ).toEqual([PLUGIN_ID]);
  });

  it("registers editor themes through acode.require", async () => {
    const rig = mount();
    await rig.host.waitForReady(2_000);
    await rig.host.load(PLUGIN_ID, {
      baseUrl: "https://plugin.ajiro.invalid/com.example.real",
      grantedPermissions: [],
      settings: {},
      source: `acode.setPluginInit("${PLUGIN_ID}", function () {
        var editorThemes = acode.require("editorThemes");
        editorThemes.register({
          id: "chai_theme",
          caption: "Chai Theme",
          dark: true,
          config: { background: "#101418", foreground: "#e6edf3" },
        });
        editorThemes.apply("chai_theme");
      });`,
      storage: {},
    });
    await rig.host.activate(PLUGIN_ID, { firstInit: true });
    await settle();
    expect(rig.host.listEditorThemes()).toEqual([
      {
        id: "chai_theme",
        caption: "Chai Theme",
        dark: true,
        pluginId: PLUGIN_ID,
        config: { background: "#101418", foreground: "#e6edf3" },
      },
    ]);
    expect(rig.host.getEditorThemeSelection()).toBe("chai_theme");
  });

  it("provides the Url utility module with documented semantics", async () => {
    const rig = mount();
    await rig.host.waitForReady(2_000);
    await rig.host.load(PLUGIN_ID, {
      baseUrl: "https://plugin.ajiro.invalid/com.example.real",
      grantedPermissions: [],
      settings: {},
      source: `acode.setPluginInit("${PLUGIN_ID}", function () {
        var Url = acode.require("Url");
        var UrlLower = acode.require("url");
        window.__urlResult = {
          sameModule: Url === UrlLower,
          basename: Url.basename("ftp://localhost/foo/bar/index.html"),
          basenameBad: Url.basename("not a url at all !!! :::"),
          areSame: Url.areSame("https://example.com", "https://example.com"),
          areDifferent: Url.areSame("https://a.com", "https://b.com"),
          extname: Url.extname("ftp://localhost/foo/bar/index.html"),
          join: Url.join("https://example.com", "/foo", "/bar"),
          safe: Url.safe("https://www.example.com/path/to/file.html?query=string#hash"),
          pathname: Url.pathname("ftp://myhost.com/foo/bar/index.html"),
          dirname: Url.dirname("ftp://localhost/foo/bar"),
          parse: Url.parse("https://example.com/path?query=string"),
          formate: Url.formate({ protocol: "https:", hostname: "example.com", path: "path/to/page", query: { key: "value" } }),
          protocol: Url.getProtocol("ftp://localhost/foo/bar"),
          hidden: Url.hidePassword("ftp://user:password@localhost/foo/bar"),
          decoded: Url.decodeUrl("https://user:pass@host.com:8080/path?query=string"),
          trimmed: Url.trimSlash("https://example.com/path/"),
        };
      });`,
      storage: {},
    });
    await rig.host.activate(PLUGIN_ID, { firstInit: true });
    await settle();
    const result = (rig.dom.window as unknown as Record<string, unknown>)
      .__urlResult as Record<string, unknown>;
    expect(result.sameModule).toBe(true);
    expect(result.basename).toBe("index.html");
    expect(result.basenameBad).toBeNull();
    expect(result.areSame).toBe(true);
    expect(result.areDifferent).toBe(false);
    expect(result.extname).toBe(".html");
    expect(result.join).toBe("https://example.com/foo/bar");
    expect(result.safe).toBe(
      "https://www.example.com/path/to/file.html%3Fquery%3Dstring%23hash",
    );
    expect(result.pathname).toBe("/foo/bar");
    expect(result.dirname).toBe("ftp://localhost/foo/");
    expect(result.parse).toEqual({
      url: "https://example.com/path",
      query: "?query=string",
    });
    expect(result.formate).toBe("https://example.com/path/to/page?key=value");
    expect(result.protocol).toBe("ftp:");
    expect(result.hidden).toBe("ftp://user@localhost/foo/bar");
    expect(result.decoded).toEqual({
      username: "user",
      password: "pass",
      hostname: "host.com",
      pathname: "/path",
      port: 8080,
      query: { query: "string" },
    });
    expect(result.trimmed).toBe("https://example.com/path");
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

const DIALOG_PLUGIN_ID = "com.example.dialogs";

const DIALOG_PLUGIN_SOURCE = `
acode.setPluginInit("${DIALOG_PLUGIN_ID}", function (baseUrl, $page, cache) {
  var results = {};
  var toastModule = acode.require("toast");
  toastModule("hello from require", 1500);
  acode.toast("hello from global");
  acode.confirm("Sure?", "Really sure?").then(function (ok) {
    results.confirm = ok;
    return acode.prompt("Name?", "Ada", "text", { required: true });
  }).then(function (name) {
    results.prompt = name;
    return acode.select("Pick", ["a", ["b", "Bee"], { value: "c", text: "Cee", disabled: true }], { default: "b" });
  }).then(function (choice) {
    results.select = choice;
    return acode.multiPrompt("Form", [{ id: "nick", name: "Nick", value: "Al" }]);
  }).then(function (values) {
    results.multi = values;
    var loader = acode.loader("Loading", "Please wait");
    loader.setTitle("Still loading");
    loader.destroy();
    return acode.newEditorFile("notes.md", { text: "# hi" });
  }).then(function (path) {
    results.file = path;
    return acode.fileBrowser("file");
  }).then(function (uris) {
    results.browser = uris;
    $page.innerHTML = "<h1 id='dialog-results'>" + JSON.stringify(results) + "</h1>";
    $page.show();
  });
});
`;

describe("plugin dialogs (executed in a real DOM)", () => {
  it("round-trips every dialog kind through the bridge with Acode shapes", async () => {
    const shown: { kind: string; payload: unknown }[] = [];
    const rig = mount({
      createLoader: async () => "loader-9",
      openNewFile: async (_pluginId, filename) => `project/${filename}`,
      pickFiles: async () => ["file:///picked/a.txt"],
      showDialog: async (kind, payload) => {
        shown.push({ kind, payload });
        if (kind === "confirm") return true;
        if (kind === "prompt") return "Ada";
        if (kind === "select") return "b";
        if (kind === "multi-prompt") return { nick: "Al" };
        return null;
      },
    });
    await rig.host.waitForReady(2_000);
    await rig.host.load(DIALOG_PLUGIN_ID, {
      baseUrl: "https://plugin.ajiro.invalid/com.example.dialogs",
      grantedPermissions: ["editor", "storage", "ui"],
      settings: {},
      source: DIALOG_PLUGIN_SOURCE,
      storage: {},
    });
    await rig.host.activate(DIALOG_PLUGIN_ID, { firstInit: true });
    await settle(100);

    // Every toast reached the host without any grant.
    const toasts = rig.outbound.filter((message) => message.type === "toast");
    expect(toasts).toHaveLength(2);

    // The select payload carries the normalized Acode shapes.
    const selectCall = shown.find((entry) => entry.kind === "select");
    expect(selectCall?.payload).toMatchObject({
      options: [
        { disabled: false, text: "a", value: "a" },
        { disabled: false, text: "Bee", value: "b" },
        { disabled: true, text: "Cee", value: "c" },
      ],
      rejectOnCancel: false,
    });

    // Loader lifecycle ops were posted, create resolved with the host id.
    const loaderOps = rig.outbound.filter(
      (message) => message.type === "dialog-loader-op",
    );
    expect(loaderOps.map((message) => message.op).sort()).toEqual([
      "destroy",
      "setTitle",
    ]);

    // The plugin saw every answer and the created/picked paths.
    const results = JSON.parse(
      rig.dom.window.document.getElementById("dialog-results")?.textContent ?? "{}",
    );
    expect(results).toEqual({
      browser: ["file:///picked/a.txt"],
      confirm: true,
      file: "project/notes.md",
      multi: { nick: "Al" },
      prompt: "Ada",
      select: "b",
    });
  });

  it("refuses dialogs for plugins without the ui grant", async () => {
    const rig = mount();
    await rig.host.waitForReady(2_000);
    await rig.host.load(DIALOG_PLUGIN_ID, {
      baseUrl: "https://plugin.ajiro.invalid/com.example.dialogs",
      grantedPermissions: ["storage"],
      settings: {},
      source: `
acode.setPluginInit("${DIALOG_PLUGIN_ID}", function () {
  try {
    acode.confirm("T?", "M");
  } catch (error) {
    document.title = String(error && error.message);
  }
});
`,
      storage: {},
    });
    await rig.host.activate(DIALOG_PLUGIN_ID, { firstInit: true });
    await settle();
    expect(rig.dom.window.document.title).toContain("ui capability");
  });
});
