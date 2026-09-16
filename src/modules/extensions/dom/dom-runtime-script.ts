/**
 * The plugin host document: the in-WebView half of the DOM runtime
 * (prompt §35-§49).
 *
 * Everything here runs inside one `react-native-webview`, which is a real
 * browser environment: a plugin entry script gets a genuine `window`,
 * `document`, `HTMLElement`, `CustomEvent`, `Blob`, `URL`, `Response`, and
 * `fetch` — the web-context surface Acode plugins are written against.
 *
 * What a plugin cannot do is reach the native app. The document is a blank
 * page, navigation and file access are disabled by the surface component, and
 * everything that must affect Ajiro — reading package files, persisting
 * settings, registering commands, notifying the user, installing another
 * extension — travels back as a typed message on `bridge-protocol.ts` and is
 * permission-checked by the host.
 *
 * Plugin code is executed with `new Function` here because this document is
 * the only place on the device where dynamic code execution exists: React
 * Native's Hermes engine has no `eval`/`new Function`, and no DOM.
 *
 * The script is plain ES5-compatible JavaScript in a string so it can be
 * inlined into the document. It avoids backticks and `${` so it needs no
 * escaping, and takes its placeholders through explicit markers.
 */
import {
  PLUGIN_PAGE_CONTAINER_ID,
  PLUGIN_READY_GLOBAL,
  PLUGIN_RUNTIME_GLOBAL,
} from "./dom-protocol";

export type PluginDocumentParams = {
  /** Ajiro theme resolved into plain colors so plugin pages match (§67). */
  theme: {
    accent: string;
    background: string;
    backgroundElement: string;
    border: string;
    text: string;
    textSecondary: string;
  };
};

const RUNTIME_JS = String.raw`(function () {
  "use strict";

  var CONFIG = __AJIRO_CONFIG__;
  var PAGE_CONTAINER_ID = "__AJIRO_PAGE_CONTAINER__";

  var post = function (message) {
    try {
      window.ReactNativeWebView.postMessage(JSON.stringify(message));
    } catch (e) {
      /* host gone */
    }
  };

  var describe = function (value) {
    if (value instanceof Error) return value.message || String(value);
    if (typeof value === "string") return value;
    try {
      return JSON.stringify(value);
    } catch (e) {
      return String(value);
    }
  };

  /* ---------------------------------------------------------------- state */

  var currentPluginId = null;
  var requestSeq = 0;
  var definitions = Object.create(null);
  var modules = Object.create(null);
  var resources = Object.create(null);
  var pages = Object.create(null);
  var commands = Object.create(null);
  var pendingRequests = Object.create(null);
  var activated = Object.create(null);
  var waiters = Object.create(null);

  function describeError(value) {
    var message = describe(value);
    return message && message.length ? message : "Plugin error";
  }

  function reportError(pluginId, phase, error) {
    var message = describeError(error);
    post({
      type: "error",
      pluginId: pluginId || currentPluginId,
      phase: phase,
      message: message,
    });
    var reported = new Error(message);
    reported.__ajiroReported = true;
    return reported;
  }

  function resource(pluginId) {
    if (!resources[pluginId]) {
      resources[pluginId] = { listeners: [], pageIds: [], timers: [], visiblePage: null };
    }
    return resources[pluginId];
  }

  window.onerror = function (message, source, line, column, error) {
    post({
      type: "error",
      pluginId: currentPluginId,
      phase: "execute",
      message: describeError(error || message),
    });
    return false;
  };

  window.addEventListener("unhandledrejection", function (event) {
    post({
      type: "error",
      pluginId: currentPluginId,
      phase: "execute",
      message: "Unhandled promise rejection: " + describeError(event.reason),
    });
  });

  /* Timers and listeners created while a plugin executes are owned by that
     plugin so unmount can release them (§73). */
  var nativeSetTimeout = window.setTimeout.bind(window);
  var nativeSetInterval = window.setInterval.bind(window);
  var nativeClearTimeout = window.clearTimeout.bind(window);
  var nativeClearInterval = window.clearInterval.bind(window);
  var nativeAddEventListener = window.addEventListener.bind(window);

  window.setTimeout = function (fn, delay) {
    var id = nativeSetTimeout(fn, delay);
    if (currentPluginId && resources[currentPluginId]) {
      resources[currentPluginId].timers.push({ id: id, interval: false });
    }
    return id;
  };
  window.setInterval = function (fn, delay) {
    var id = nativeSetInterval(fn, delay);
    if (currentPluginId && resources[currentPluginId]) {
      resources[currentPluginId].timers.push({ id: id, interval: true });
    }
    return id;
  };
  window.clearTimeout = function (id) {
    nativeClearTimeout(id);
  };
  window.clearInterval = function (id) {
    nativeClearInterval(id);
  };
  window.addEventListener = function (type, listener, options) {
    if (currentPluginId) {
      resource(currentPluginId).listeners.push({ listener: listener, type: type });
    }
    return nativeAddEventListener(type, listener, options);
  };

  /* Network is a granted capability, not an ambient one (§50). Plugin-local
     reads (anything under the plugin's own baseUrl) are served from the
     package over the bridge instead of the network. */
  var nativeFetch = window.fetch ? window.fetch.bind(window) : null;

  function definitionFor(pluginId) {
    return pluginId ? definitions[pluginId] : null;
  }

  function hasPermission(pluginId, permission) {
    var definition = definitionFor(pluginId);
    if (!definition) return false;
    return definition.permissions.indexOf(permission) !== -1;
  }

  function resolveFetchUrl(input) {
    if (typeof input === "string") return input;
    if (input && typeof input.url === "string") return input.url;
    return "";
  }

  window.fetch = function (input, init) {
    var definition = definitionFor(currentPluginId);
    var url = resolveFetchUrl(input);
    if (definition && definition.baseUrl && url.indexOf(definition.baseUrl) === 0) {
      return request({
        type: "fs-read",
        pluginId: currentPluginId,
        path: url.slice(definition.baseUrl.length),
      }).then(function (text) {
        return new Response(text, {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        });
      });
    }
    if (currentPluginId && definition && !hasPermission(currentPluginId, "network")) {
      return Promise.reject(
        new Error("Network access was not granted to this plugin.")
      );
    }
    if (!nativeFetch) {
      return Promise.reject(new Error("fetch is unavailable in this runtime."));
    }
    return nativeFetch(input, init);
  };

  /* Console output is bridged so plugin logging is diagnosable. */
  ["log", "warn", "error"].forEach(function (level) {
    var original = console[level] ? console[level].bind(console) : function () {};
    console[level] = function () {
      var parts = [];
      for (var i = 0; i < arguments.length; i += 1) {
        parts.push(describe(arguments[i]));
      }
      post({
        type: "console",
        level: level,
        pluginId: currentPluginId,
        text: parts.join(" "),
      });
      original.apply(null, arguments);
    };
  });

  /* ------------------------------------------------------------- requests */

  function request(message) {
    requestSeq += 1;
    var id = requestSeq;
    message.requestId = id;
    // The pending entry must exist *before* the message is posted. A host
    // handler that answers synchronously (an editor read, for example) would
    // otherwise respond into nothing and the plugin's promise would hang
    // forever with no error anywhere.
    var pending = new Promise(function (resolve, reject) {
      pendingRequests[id] = { reject: reject, resolve: resolve };
    });
    post(message);
    return pending;
  }

  /* ---------------------------------------------------------------- pages */

  function pageContainer() {
    var container = document.getElementById(PAGE_CONTAINER_ID);
    if (!container) {
      container = document.createElement("div");
      container.id = PAGE_CONTAINER_ID;
      document.body.appendChild(container);
    }
    return container;
  }

  function themeStyles() {
    var theme = CONFIG.theme;
    return (
      "[data-ajiro-page] { color: " + theme.text + "; }" +
      "[data-ajiro-page] a { color: " + theme.accent + "; }" +
      "[data-ajiro-page] button { background: " + theme.accent + "; color: " +
      theme.background + "; border: 0; border-radius: 8px; padding: 8px 14px; font-size: 14px; }" +
      "[data-ajiro-page] code { background: " + theme.backgroundElement + "; border-radius: 6px; padding: 1px 4px; }" +
      "[data-ajiro-page] pre { background: " + theme.backgroundElement + "; border-radius: 10px; padding: 10px; overflow-x: auto; }" +
      "[data-ajiro-page] hr { border: 0; border-top: 1px solid " + theme.border + "; }" +
      "[data-ajiro-page] ::placeholder { color: " + theme.textSecondary + "; }"
    );
  }

  function createPage(pluginId, id, title) {
    var element = document.createElement("div");
    element.setAttribute("data-ajiro-page", id);
    element.style.display = "none";
    element.style.background = CONFIG.theme.background;
    element.style.color = CONFIG.theme.text;
    element.style.fontFamily = "system-ui, -apple-system, sans-serif";
    element.style.fontSize = "15px";
    element.style.boxSizing = "border-box";
    element.style.lineHeight = "22px";
    element.style.minHeight = "100vh";
    element.style.padding = "16px";

    var style = document.createElement("style");
    style.textContent = themeStyles();
    element.appendChild(style);
    pageContainer().appendChild(element);

    var page = {
      id: id,
      title: title || "Plugin",
      /* The backing element, so plugins can append to it directly. */
      element: element,
      onhide: null,
      onshow: null,
      get innerHTML() {
        return element.innerHTML;
      },
      set innerHTML(value) {
        element.innerHTML = String(value);
      },
      get textContent() {
        return element.textContent;
      },
      set textContent(value) {
        element.textContent = String(value);
      },
      get(id) {
        return element.querySelector("#" + id);
      },
      querySelector(selector) {
        return element.querySelector(selector);
      },
      querySelectorAll(selector) {
        return element.querySelectorAll(selector);
      },
      show() {
        element.style.display = "block";
        resource(pluginId).visiblePage = id;
        if (typeof page.onshow === "function") {
          try {
            page.onshow();
          } catch (error) {
            reportError(pluginId, "execute", error);
          }
        }
        post({ type: "page", action: "shown", pluginId: pluginId, title: page.title });
        return page;
      },
      hide() {
        element.style.display = "none";
        if (resource(pluginId).visiblePage === id) {
          resource(pluginId).visiblePage = null;
        }
        if (typeof page.onhide === "function") {
          try {
            page.onhide();
          } catch (error) {
            reportError(pluginId, "execute", error);
          }
        }
        post({ type: "page", action: "hidden", pluginId: pluginId, title: page.title });
      },
      remove() {
        if (element.parentNode) element.parentNode.removeChild(element);
        delete pages[pluginId + "::" + id];
      },
    };
    pages[pluginId + "::" + id] = page;
    resource(pluginId).pageIds.push(id);
    return page;
  }

  /* ------------------------------------------------------ module registry */

  function buildModules(pluginId, definition, values) {
    var scoped = Object.create(null);
    var permissions = definition.permissions;

    if (permissions.indexOf("commands") !== -1) {
      scoped.commands = {
        addCommand: function (command) {
          if (!command || typeof command.name !== "string" || !command.name) {
            throw new Error("commands.addCommand requires a name.");
          }
          commands[pluginId + "::" + command.name] = { command: command, pluginId: pluginId };
          post({
            type: "command-register",
            pluginId: pluginId,
            command: {
              name: command.name,
              bindKey: command.bindKey || null,
              description: command.description || null,
              exec: typeof command.exec === "function",
            },
          });
          return command.name;
        },
        removeCommand: function (name) {
          delete commands[pluginId + "::" + name];
          post({ type: "command-remove", pluginId: pluginId, name: name });
        },
      };
    }

    /* Plugin-scoped settings and storage: private to the plugin, namespaced
       on the native side as extensions.<pluginId>.<key> (§47/§59). */
    if (permissions.indexOf("storage") !== -1) {
      scoped.settings = {
        all: values.settings,
        get: function (key) {
          return values.settings[key];
        },
        set: function (key, value) {
          values.settings[key] = value;
          post({ type: "settings-set", pluginId: pluginId, key: key, value: value });
          return value;
        },
        update: function (updates) {
          Object.keys(updates || {}).forEach(function (key) {
            values.settings[key] = updates[key];
            post({
              type: "settings-set",
              pluginId: pluginId,
              key: key,
              value: updates[key],
            });
          });
          return values.settings;
        },
      };
      scoped.storage = {
        get: function (key) {
          return request({ type: "storage-get", pluginId: pluginId, key: String(key) });
        },
        set: function (key, value) {
          post({ type: "storage-set", pluginId: pluginId, key: String(key), value: value });
        },
        remove: function (key) {
          post({ type: "storage-remove", pluginId: pluginId, key: String(key) });
        },
      };
    }

    /* Scoped editor access (§39): read and replace the *active* document.
       Everything else about the editor, the project, and the filesystem stays
       behind the app's own boundary. */
    if (permissions.indexOf("editor") !== -1) {
      var readEditor = function () {
        return request({ type: "editor-read", pluginId: pluginId });
      };
      scoped.editor = {
        isAvailable: function () {
          return readEditor().then(function (file) {
            return !!file;
          });
        },
        getFile: function () {
          return readEditor().then(function (file) {
            return file ? { path: file.path, languageId: file.languageId } : null;
          });
        },
        getText: function () {
          return readEditor().then(function (file) {
            return file ? file.text : null;
          });
        },
        setText: function (text) {
          return request({
            type: "editor-write",
            pluginId: pluginId,
            text: String(text),
          });
        },
      };
    }

    if (permissions.indexOf("filesystem") !== -1) {
      scoped.filesystem = {
        readFile: function (path) {
          return request({ type: "fs-read", pluginId: pluginId, path: String(path) });
        },
        writeFile: function (path, text) {
          return request({
            type: "fs-write",
            pluginId: pluginId,
            path: String(path),
            text: String(text),
          });
        },
        list: function (path) {
          return request({ type: "fs-list", pluginId: pluginId, path: String(path) });
        },
      };
    }

    modules[pluginId] = scoped;
    return scoped;
  }

  /* ------------------------------------------------------------ the acode */

  function resolveWaiter(pluginId, error) {
    var list = waiters[pluginId] || [];
    waiters[pluginId] = [];
    list.forEach(function (entry) {
      if (error) entry.reject(error);
      else entry.resolve(true);
    });
  }

  var acode = {
    version: "ajiro-dom",
    setPluginInit: function (pluginId, init, settings) {
      if (typeof init !== "function") {
        throw new Error("acode.setPluginInit requires a function.");
      }
      var definition = definitions[pluginId];
      if (!definition) {
        definition = definitions[pluginId] = {
          baseUrl: null,
          init: null,
          permissions: [],
          settings: null,
          unmount: null,
        };
      }
      definition.init = init;
      definition.settings = settings || null;
      post({ type: "registered", pluginId: pluginId });
    },
    setPluginUnmount: function (pluginId, unmount) {
      var definition = definitions[pluginId];
      if (definition) definition.unmount = unmount;
    },
    define: function (name, value) {
      var key = String(name).toLowerCase();
      if (!key) throw new Error("acode.define requires a module name.");
      modules["global::" + key] = value;
    },
    require: function (name) {
      var key = String(name).toLowerCase();
      var shared = modules["global::" + key];
      if (shared) return shared;
      var scoped = modules[currentPluginId];
      if (scoped && scoped[key]) return scoped[key];
      throw new Error(
        'The module "' + name + '" is not available to this plugin: it is ' +
          "either a capability the user did not grant or a core module Ajiro " +
          "does not provide."
      );
    },
    exec: function (name, value) {
      var entry = commands[currentPluginId + "::" + name];
      if (entry && typeof entry.command.exec === "function") {
        return entry.command.exec(value);
      }
      post({
        type: "exec-request",
        pluginId: currentPluginId,
        name: String(name),
        value: value,
      });
      return undefined;
    },
    installPlugin: function (targetId, installerName) {
      return request({
        type: "install-plugin",
        pluginId: currentPluginId || String(installerName || "unknown"),
        targetId: String(targetId),
      });
    },
    waitForPlugin: function (pluginId) {
      if (activated[pluginId]) return Promise.resolve(true);
      if (!definitions[pluginId]) {
        return Promise.reject(new Error('Plugin "' + pluginId + '" does not exist.'));
      }
      return new Promise(function (resolve, reject) {
        if (!waiters[pluginId]) waiters[pluginId] = [];
        waiters[pluginId].push({ reject: reject, resolve: resolve });
      });
    },
    clearBrokenPluginMark: function () {
      /* broken marks live on the native side; this is a no-op here */
    },
    pushNotification: function (title, message, options) {
      post({
        type: "notify",
        pluginId: currentPluginId,
        level: (options && options.type) || "info",
        text: String(title || "") + (message ? " — " + String(message) : ""),
      });
    },
    addIcon: function (name, src) {
      var style = document.createElement("style");
      style.textContent =
        "." + String(name) + " { background-image: url(\"" + String(src) +
        "\"); background-size: contain; }";
      document.head.appendChild(style);
    },
    toInternalUrl: function (url) {
      var target = String(url);
      if (/^https?:/i.test(target)) return Promise.resolve(target);
      var definition = definitionFor(currentPluginId);
      var relative = target;
      if (definition && definition.baseUrl && target.indexOf(definition.baseUrl) === 0) {
        relative = target.slice(definition.baseUrl.length);
      }
      return request({
        type: "fs-read",
        pluginId: currentPluginId,
        path: relative,
      }).then(function (text) {
        return URL.createObjectURL(new Blob([text], { type: "text/plain" }));
      });
    },
    newEditorFile: function () {
      throw new Error("newEditorFile is not supported by the Ajiro plugin runtime.");
    },
    /* Ajiro-original: the page factory Acode passes into init as $page. */
    page: function (id, title) {
      return createPage(currentPluginId, id, title);
    },
  };

  window.acode = acode;

  /* ------------------------------------------------------------ lifecycle */

  function runPlugin(pluginId, source) {
    currentPluginId = pluginId;
    resource(pluginId);
    try {
      var factory = new Function(
        "acode",
        "window",
        "document",
        "require",
        "module",
        "exports",
        '"use strict";\n' + source
      );
      var moduleRef = { exports: {} };
      factory(
        acode,
        window,
        document,
        function (name) {
          return acode.require(name);
        },
        moduleRef,
        moduleRef.exports
      );
    } catch (error) {
      throw reportError(pluginId, "load", error);
    } finally {
      currentPluginId = null;
    }
  }

  function handleDefine(message) {
    var pluginId = message.pluginId;
    var definition = definitions[pluginId] || {
      baseUrl: null,
      init: null,
      permissions: [],
      settings: null,
      unmount: null,
    };
    definition.permissions = message.grantedPermissions || [];
    definitions[pluginId] = definition;
    buildModules(pluginId, definition, {
      settings: message.settings || {},
      storage: message.storage || {},
    });
    if (message.source) runPlugin(pluginId, message.source);
    post({
      type: "defined",
      pluginId: pluginId,
      hasInit: typeof definition.init === "function",
    });
  }

  function handleActivate(message) {
    var pluginId = message.pluginId;
    var definition = definitions[pluginId];
    currentPluginId = pluginId;
    try {
      if (!definition || typeof definition.init !== "function") {
        throw new Error(
          'Plugin "' + pluginId + '" registered no init callback. Entry scripts ' +
            "must call acode.setPluginInit."
        );
      }
      definition.baseUrl = message.baseUrl;
      definition.init(
        message.baseUrl,
        createPage(
          pluginId,
          "main",
          (definition.settings && definition.settings.title) || pluginId
        ),
        {
          cacheFile: null,
          cacheFileUrl: null,
          fileIcons: null,
          firstInit: message.firstInit === true,
        }
      );
      activated[pluginId] = true;
      resolveWaiter(pluginId, null);
      post({ type: "activated", pluginId: pluginId });
    } catch (error) {
      var failure = reportError(pluginId, "activate", error);
      resolveWaiter(pluginId, failure);
    } finally {
      currentPluginId = null;
    }
  }

  function handleUnmount(message) {
    var pluginId = message.pluginId;
    var definition = definitions[pluginId];
    var owned = resources[pluginId];
    currentPluginId = pluginId;
    try {
      if (definition && typeof definition.unmount === "function") {
        definition.unmount();
      }
    } catch (error) {
      reportError(pluginId, "unmount", error);
    } finally {
      currentPluginId = null;
    }
    if (owned) {
      owned.timers.forEach(function (timer) {
        if (timer.interval) nativeClearInterval(timer.id);
        else nativeClearTimeout(timer.id);
      });
      owned.listeners.forEach(function (entry) {
        try {
          window.removeEventListener(entry.type, entry.listener);
        } catch (e) {
          /* already removed */
        }
      });
      owned.pageIds.forEach(function (id) {
        var page = pages[pluginId + "::" + id];
        if (page && page.element && page.element.parentNode) {
          page.element.parentNode.removeChild(page.element);
        }
        delete pages[pluginId + "::" + id];
      });
    }
    Object.keys(commands).forEach(function (key) {
      if (key.indexOf(pluginId + "::") === 0) delete commands[key];
    });
    delete resources[pluginId];
    delete definitions[pluginId];
    delete modules[pluginId];
    delete activated[pluginId];
    resolveWaiter(pluginId, new Error('Plugin "' + pluginId + '" was unloaded.'));
    post({ type: "unmounted", pluginId: pluginId });
  }

  function handleResponse(message) {
    var entry = pendingRequests[message.requestId];
    if (!entry) return;
    delete pendingRequests[message.requestId];
    if (message.ok) entry.resolve(message.result);
    else entry.reject(new Error(message.error || "The request was refused."));
  }

  function hideAllPages() {
    Object.keys(pages).forEach(function (key) {
      var page = pages[key];
      if (page.element.style.display !== "none") page.hide();
    });
  }

  function runCommand(name, value) {
    var found = null;
    Object.keys(commands).forEach(function (key) {
      if (!found && commands[key].command.name === name) found = commands[key];
    });
    if (!found || typeof found.command.exec !== "function") return;
    // The command belongs to a plugin, so the plugin is the executing context
    // for its duration: without this, everything scoped to "the current
    // plugin" (storage, filesystem, notifications, acode.exec) would be
    // refused when the app runs a command from its own UI.
    var previousPluginId = currentPluginId;
    currentPluginId = found.pluginId;
    try {
      found.command.exec(value);
    } finally {
      currentPluginId = previousPluginId;
    }
  }

  function inbox(message) {
    if (!message || typeof message.type !== "string") return;
    try {
      if (message.type === "define-plugin") handleDefine(message);
      else if (message.type === "activate-plugin") handleActivate(message);
      else if (message.type === "unmount-plugin") handleUnmount(message);
      else if (message.type === "response") handleResponse(message);
      else if (message.type === "hide-page") hideAllPages();
      else if (message.type === "exec-command") runCommand(message.name, message.value);
    } catch (error) {
      /* runPlugin already reported load failures; everything else is here. */
      if (!error || !error.__ajiroReported) {
        reportError(currentPluginId, "execute", error);
      }
    }
  }

  document.documentElement.style.background = CONFIG.theme.background;
  document.body.style.background = CONFIG.theme.background;
  document.body.style.margin = "0";
  window["__AJIRO_RUNTIME_GLOBAL__"] = inbox;
  window["__AJIRO_READY_GLOBAL__"] = true;
  post({ type: "ready" });
})();`;

/** Build the single HTML document every plugin executes inside. */
export function buildPluginHostDocument(params: PluginDocumentParams): string {
  const config = JSON.stringify({ theme: params.theme })
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  const runtime = RUNTIME_JS.replace("__AJIRO_CONFIG__", () => config)
    .replace("__AJIRO_PAGE_CONTAINER__", () => PLUGIN_PAGE_CONTAINER_ID)
    .replace(
      '"__AJIRO_RUNTIME_GLOBAL__"',
      () => JSON.stringify(PLUGIN_RUNTIME_GLOBAL),
    )
    .replace('"__AJIRO_READY_GLOBAL__"', () => JSON.stringify(PLUGIN_READY_GLOBAL));
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<title>Ajiro plugin host</title>
<style>
  html, body { margin: 0; padding: 0; min-height: 100%; background: ${params.theme.background}; color: ${params.theme.text}; }
  #${PLUGIN_PAGE_CONTAINER_ID} { min-height: 100vh; }
</style>
</head>
<body>
<div id="${PLUGIN_PAGE_CONTAINER_ID}"></div>
<script>${runtime}</script>
</body>
</html>`;
}
