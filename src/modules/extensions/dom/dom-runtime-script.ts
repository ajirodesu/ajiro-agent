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
      pluginId: pluginId || executingPluginId(),
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
      pluginId: executingPluginId(),
      phase: "execute",
      message: describeError(error || message),
    });
    return false;
  };

  window.addEventListener("unhandledrejection", function (event) {
    post({
      type: "error",
      pluginId: executingPluginId(),
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
    var id = nativeSetTimeout(
      withPluginContext(executingPluginId(), fn),
      delay
    );
    var timerOwner = executingPluginId();
    if (timerOwner && resources[timerOwner]) {
      resources[timerOwner].timers.push({ id: id, interval: false });
    }
    return id;
  };
  window.setInterval = function (fn, delay) {
    var id = nativeSetInterval(
      withPluginContext(executingPluginId(), fn),
      delay
    );
    var intervalOwner = executingPluginId();
    if (intervalOwner && resources[intervalOwner]) {
      resources[intervalOwner].timers.push({ id: id, interval: true });
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
    var listenerOwner = executingPluginId();
    if (listenerOwner) {
      resource(listenerOwner).listeners.push({ listener: listener, type: type });
    }
    return nativeAddEventListener(
      type,
      withPluginContext(executingPluginId(), listener),
      options
    );
  };

  /* Async plugin context: init/unmount return before their promise chains
   * settle, and currentPluginId is cleared synchronously on return — so a
   * bridged call inside .then(), a timer, or a listener would otherwise look
   * ownerless and be refused. Capturing the calling plugin at registration
   * and restoring it around the callback keeps confirm().then(prompt())
   * chains (and notifications, exec, format, fetch) working the way Acode
   * plugins expect. The previous context is restored on return, so nothing
   * leaks across plugins. */
  var asyncPluginId = null;

  function executingPluginId() {
    return currentPluginId || asyncPluginId;
  }

  function withPluginContext(pluginId, fn) {
    if (typeof fn !== "function") return fn;
    return function () {
      var previous = asyncPluginId;
      asyncPluginId = pluginId;
      try {
        return fn.apply(this, arguments);
      } finally {
        asyncPluginId = previous;
      }
    };
  }

  var nativeThen = Promise.prototype.then;
  Promise.prototype.then = function (onFulfilled, onRejected) {
    var captured = executingPluginId();
    return nativeThen.call(
      this,
      withPluginContext(captured, onFulfilled),
      withPluginContext(captured, onRejected)
    );
  };

  /* Network is a granted capability, not an ambient one (§50). Plugin-local
     reads (anything under the plugin's own baseUrl) are served from the
     package over the bridge instead of the network. */
  var nativeFetch = window.fetch ? window.fetch.bind(window) : null;

  function requireUi(api) {
    if (!hasPermission(executingPluginId(), "ui")) {
      throw new Error("acode." + api + " requires the ui capability.");
    }
  }

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
    var definition = definitionFor(executingPluginId());
    var url = resolveFetchUrl(input);
    if (definition && definition.baseUrl && url.indexOf(definition.baseUrl) === 0) {
      return request({
        type: "fs-read",
        pluginId: executingPluginId(),
        path: url.slice(definition.baseUrl.length),
      }).then(function (text) {
        return new Response(text, {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        });
      });
    }
    var fetchCaller = executingPluginId();
    if (fetchCaller && definition && !hasPermission(fetchCaller, "network")) {
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
        pluginId: executingPluginId(),
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
      /* Acode's page title setter (used by real plugins, e.g. the Python
       * plugin's $page.settitle call): updates the overlay title. */
      settitle(title) {
        page.title = String(title == null ? "" : title) || "Plugin";
        if (resource(pluginId).visiblePage === id) {
          post({ type: "page", action: "shown", pluginId: pluginId, title: page.title });
        }
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

    /* Native dialog modules (§48): the same functions acode.* exposes,
     * requireable the way Acode defines them (toast, alert, select,
     * loader, prompt, confirm, multiPrompt). Acode's generic DOM
     * builders (dialogBox, colorPicker, palette, ...) are not mapped:
     * they construct Acode's own DOM, which does not exist here. */
    if (permissions.indexOf("ui") !== -1) {
      scoped.toast = acode.toast;
      scoped.alert = acode.alert;
      scoped.confirm = acode.confirm;
      scoped.prompt = acode.prompt;
      scoped.select = acode.select;
      scoped.loader = acode.loader;
      scoped.multiPrompt = acode.multiPrompt;
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

  /* Formatter registry (verified against Acode's acode.js): newest first,
   * records shaped like id, name, exts and format, with extensions
   * normalized exactly as Acode normalizes them (array filtered, single
   * string wrapped, otherwise match-all). */
  var formatters = {};

  function normalizeFormatterExtensions(input) {
    var cleaned;
    if (Array.isArray(input)) {
      cleaned = input
        .filter(function (entry) { return typeof entry === "string"; })
        .map(function (entry) { return entry.trim().toLowerCase().replace(/^\.+/, ""); })
        .filter(function (entry) { return !!entry; });
      return cleaned.length > 0 ? cleaned : ["*"];
    }
    if (typeof input === "string" && input.trim()) {
      return [input.trim().toLowerCase().replace(/^\.+/, "")];
    }
    return ["*"];
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
      var scoped = modules[executingPluginId()];
      if (scoped && scoped[key]) return scoped[key];
      throw new Error(
        'The module "' + name + '" is not available to this plugin: it is ' +
          "either a capability the user did not grant or a core module Ajiro " +
          "does not provide."
      );
    },
    exec: function (name, value) {
      var entry = commands[executingPluginId() + "::" + name];
      if (entry && typeof entry.command.exec === "function") {
        return entry.command.exec(value);
      }
      post({
        type: "exec-request",
        pluginId: executingPluginId(),
        name: String(name),
        value: value,
      });
      return undefined;
    },
    installPlugin: function (targetId, installerName) {
      return request({
        type: "install-plugin",
        pluginId: executingPluginId() || String(installerName || "unknown"),
        targetId: String(targetId),
      });
    },
    registerFormatter: function (id, extensions, format, displayName) {
      var formatterId = String(id == null ? "" : id).trim();
      if (!formatterId) throw new Error("acode.registerFormatter requires an id.");
      if (typeof format !== "function") {
        throw new Error("acode.registerFormatter requires a format function.");
      }
      var exts = normalizeFormatterExtensions(extensions);
      formatters[formatterId] = {
        pluginId: executingPluginId(),
        extensions: exts,
        displayName: displayName == null ? "" : String(displayName),
        format: format,
      };
      post({
        type: "formatter-register",
        pluginId: executingPluginId(),
        formatterId: formatterId,
        extensions: exts,
        displayName: displayName == null ? "" : String(displayName),
      });
    },
    unregisterFormatter: function (id) {
      var formatterId = String(id == null ? "" : id).trim();
      var entry = formatters[formatterId];
      /* Only the owning plugin may remove its formatter: silent cross-plugin
       * removal is sabotage, not compatibility. */
      if (entry && entry.pluginId === executingPluginId()) delete formatters[formatterId];
      post({ type: "formatter-unregister", pluginId: executingPluginId(), formatterId: formatterId });
    },
    get formatters() {
      return Object.keys(formatters).map(function (formatterId) {
        var entry = formatters[formatterId];
        return { id: formatterId, name: entry.displayName || formatterId, exts: entry.extensions.slice() };
      });
    },
    getFormatterFor: function (extensions) {
      var wanted = {};
      (Array.isArray(extensions) ? extensions : [extensions]).forEach(function (entry) {
        if (typeof entry === "string" && entry.trim()) wanted[entry.trim().toLowerCase()] = true;
      });
      var options = [[null, "None"]];
      Object.keys(formatters).forEach(function (formatterId) {
        var entry = formatters[formatterId];
        var supports = entry.extensions.indexOf("*") !== -1 ||
          entry.extensions.some(function (ext) { return !!wanted[ext]; });
        if (supports) options.push([formatterId, entry.displayName || formatterId]);
      });
      return options;
    },
    format: function (selectIfNull) {
      /* Capture the caller now: the async context propagates it through
       * .then() chains, timers, and listeners, so a format() issued from a
       * promise continuation still attributes to the calling plugin. */
      var callerId = executingPluginId();
      return request({ type: "format-request", pluginId: callerId })
        .then(function (job) {
          if (!job || !job.formatterId) return false;
          var entry = formatters[job.formatterId];
          if (!entry || typeof entry.format !== "function") return false;
          var previousPluginId = currentPluginId;
          currentPluginId = entry.pluginId;
          try {
            var result = entry.format(job.text, { languageId: job.languageId, path: job.path });
            return Promise.resolve(result).then(function (text) {
              if (typeof text !== "string") return false;
              return request({
                type: "format-apply",
                pluginId: callerId,
                text: text,
              }).then(function () { return true; });
            });
          } catch (error) {
            return false;
          } finally {
            currentPluginId = previousPluginId;
          }
        })
        .catch(function () { return false; });
      void selectIfNull;
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
        pluginId: executingPluginId(),
        level: (options && options.type) || "info",
        text: String(title || "") + (message ? " — " + String(message) : ""),
      });
    },
    addIcon: function (name, src, options) {
      var className = String(name);
      if (!className) throw new Error("acode.addIcon requires an icon name.");
      /* Acode registers each icon once; a second call for the same icon is
       * a no-op rather than a duplicate stylesheet. */
      if (document.head.querySelector('style[icon="' + className + '"]')) return;
      var safeSrc = String(src).replace(/"/g, "%22");
      var style = document.createElement("style");
      style.setAttribute("icon", className);
      if (options && options.monochrome) {
        /* Acode's monochrome mask form (versionCode 967+): inherits the
         * theme's currentColor instead of the source colors. */
        style.textContent =
          ".icon." + className + "::before { content: ''; display: inline-block; " +
          "width: 24px; height: 24px; vertical-align: middle; " +
          "-webkit-mask: url(\"" + safeSrc + "\") no-repeat center / contain; " +
          "mask: url(\"" + safeSrc + "\") no-repeat center / contain; " +
          "background-color: currentColor; }";
      } else {
        style.textContent =
          ".icon." + className + " { background-image: url(\"" + safeSrc +
          "\"); background-size: contain; }";
      }
      document.head.appendChild(style);
    },
    toInternalUrl: function (url) {
      var target = String(url);
      if (/^https?:/i.test(target)) return Promise.resolve(target);
      var definition = definitionFor(executingPluginId());
      var relative = target;
      if (definition && definition.baseUrl && target.indexOf(definition.baseUrl) === 0) {
        relative = target.slice(definition.baseUrl.length);
      }
      return request({
        type: "fs-read",
        pluginId: executingPluginId(),
        path: relative,
      }).then(function (text) {
        return URL.createObjectURL(new Blob([text], { type: "text/plain" }));
      });
    },
    /* Native dialogs (verified against Acode's src/dialogs/* + acode.js).
     * Arguments are collected here; the app renders. Option shapes accept
     * everything Acode accepts (bare strings, positional arrays, objects);
     * function-valued options (match/test/onclick/onchange) cannot cross the
     * bridge — match may be a RegExp, whose source is forwarded. */
    alert: function (title, message, onhide) {
      requireUi("alert");
      var dialog = { title: title, message: message };
      request({ type: "dialog", kind: "alert", pluginId: executingPluginId(), payload: dialog })
        .then(function () { if (typeof onhide === "function") onhide(); })
        .catch(function () { if (typeof onhide === "function") onhide(); });
    },
    confirm: function (title, message) {
      requireUi("confirm");
      return request({
        type: "dialog", kind: "confirm", pluginId: executingPluginId(),
        payload: { title: title, message: message },
      });
    },
    prompt: function (message, defaultValue, type, options) {
      requireUi("prompt");
      var opts = options || {};
      var payload = {
        message: message,
        defaultValue: defaultValue == null ? "" : String(defaultValue),
        type: type == null ? "text" : String(type),
        placeholder: typeof opts.placeholder === "string" ? opts.placeholder : "",
        required: opts.required === true,
      };
      if (opts.match instanceof RegExp) payload.matchSource = opts.match.source;
      return request({ type: "dialog", kind: "prompt", pluginId: executingPluginId(), payload: payload });
    },
    select: function (title, options, config) {
      requireUi("select");
      var items = [];
      (Array.isArray(options) ? options : [options]).forEach(function (item) {
        if (typeof item === "string") {
          if (item.trim()) items.push({ value: item, text: item, disabled: false });
        } else if (Array.isArray(item)) {
          var value = item[0];
          if (typeof value !== "string" || !value) return;
          var flag = null;
          item.slice(2).forEach(function (entry) {
            if (typeof entry === "boolean" && flag === null) flag = entry;
          });
          items.push({
            value: value,
            text: typeof item[1] === "string" && item[1] ? item[1] : value,
            disabled: flag === null ? false : !flag,
          });
        } else if (item && typeof item === "object") {
          if (typeof item.value !== "string" || !item.value) return;
          items.push({
            value: item.value,
            text: typeof item.text === "string" && item.text ? item.text : item.value,
            subText: typeof item.subText === "string" ? item.subText : undefined,
            disabled: item.disabled === true,
          });
        }
      });
      var rejectOnCancel = config === true || (!!config && config.rejectOnCancel === true);
      return request({
        type: "dialog", kind: "select", pluginId: executingPluginId(),
        payload: {
          title: title, options: items.slice(0, 50),
          defaultValue: config && typeof config.default === "string" ? config.default : undefined,
          rejectOnCancel: rejectOnCancel,
        },
      });
    },
    multiPrompt: function (title, inputs, help) {
      requireUi("multiPrompt");
      var flat = [];
      (Array.isArray(inputs) ? inputs : []).forEach(function (entry) {
        if (Array.isArray(entry)) flat.push.apply(flat, entry);
        else flat.push(entry);
      });
      var fields = [];
      flat.forEach(function (entry) {
        if (!entry || typeof entry !== "object" || typeof entry.id !== "string" || !entry.id) return;
        if (fields.length >= 12) return;
        fields.push({
          id: entry.id,
          label: typeof entry.name === "string" ? entry.name : undefined,
          type: typeof entry.type === "string" ? entry.type : "text",
          defaultValue: entry.value == null ? "" : String(entry.value),
          placeholder: typeof entry.placeholder === "string" ? entry.placeholder : undefined,
          required: entry.required === true,
          disabled: entry.disabled === true,
          hidden: entry.hidden === true,
        });
      });
      return request({
        type: "dialog", kind: "multi-prompt", pluginId: executingPluginId(),
        payload: { title: title, inputs: fields, help: typeof help === "string" ? help : undefined },
      });
    },
    loader: function (title, message, options) {
      requireUi("loader");
      var proxy = { id: null, destroyed: false };
      var queue = [];
      var timeoutMs = options && typeof options.timeout === "number" ? options.timeout : undefined;
      request({
        type: "dialog-loader-create", pluginId: executingPluginId(),
        title: title, message: message, options: { timeoutMs: timeoutMs },
      }).then(function (id) {
        proxy.id = id;
        // The queue already holds destroy when destroy() ran before create
        // resolved, so flushing is the whole teardown — no second post.
        queue.forEach(function (op) { post(op); });
        queue = [];
      }).catch(function () {});
      var send = function (op, value) {
        var message = { type: "dialog-loader-op", pluginId: executingPluginId(), loaderId: proxy.id, op: op, value: value };
        if (proxy.id) post(message);
        else queue.push(message);
      };
      proxy.setTitle = function (value) { send("setTitle", String(value)); };
      proxy.setMessage = function (value) { send("setMessage", String(value)); };
      proxy.hide = function () { send("hide"); };
      proxy.show = function () { send("show"); };
      proxy.destroy = function () { proxy.destroyed = true; send("destroy"); };
      return proxy;
    },
    toast: function (text, duration) {
      post({ type: "toast", pluginId: executingPluginId(), text: String(text == null ? "" : text), durationMs: duration });
    },
    fileBrowser: function (mode, info, openLast) {
      requireUi("fileBrowser");
      void info; void openLast;
      return request({
        type: "file-browser", pluginId: executingPluginId(),
        mode: typeof mode === "string" ? mode : "file",
      }).then(function (uris) { return Array.isArray(uris) ? uris : []; });
    },
    newEditorFile: function (filename, options) {
      var opts = options || {};
      return request({
        type: "editor-new-file", pluginId: executingPluginId(),
        filename: String(filename == null ? "" : filename),
        text: typeof opts.text === "string" ? opts.text : "",
      });
    },
    /* Ajiro-original: the page factory Acode passes into init as $page. */
    page: function (id, title) {
      return createPage(executingPluginId(), id, title);
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
    Object.keys(formatters).forEach(function (formatterId) {
      if (formatters[formatterId] && formatters[formatterId].pluginId === pluginId) {
        delete formatters[formatterId];
      }
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
        reportError(executingPluginId(), "execute", error);
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
