/**
 * Offline CodeMirror document builder — the SOLE HTML factory for the
 * editor WebView.
 *
 * - The vendored `CM_BUNDLE_JS` string is inlined: no CDN, no runtime
 *   network fetch, no file access.
 * - `INITIAL` (theme + grammar key + document) crosses the TS→HTML
 *   boundary JSON-encoded with `<` escaped, so hostile document text
 *   (e.g. `</script>`) can never break out of the bootstrap block.
 * - The bootstrap creates one `EditorView` with compartmentalized language
 *   + theme (both reconfigurable live via `window.__ajiroEditorInbox`
 *   without reload), Acode-class editing (history, folding, autocompletion
 *   incl. any-word + emmet for the HTML family, bracket autoclosing,
 *   rectangular multi-cursor, search/replace API), and posts
 *   `EditorWebViewOutbound` messages back to React Native.
 */
import { CM_BUNDLE_JS } from "@/editor/cmBundle";
import type { EditorTheme } from "@/editor/editorTypes";

export interface EditorDocumentParams {
  theme: EditorTheme;
  /** Bundle grammar key from `grammarKeyForPath()`; null = plain text. */
  grammarKey: string | null;
  doc: string;
  /** Initial AI-autocomplete toggle state (live-toggled after mount). */
  autocompleteEnabled?: boolean;
}

/** Escape code so it can be inlined inside a `<script>` block. */
export function escapeInlineScript(code: string): string {
  return code.split("</script").join("<\\/script");
}

/** Escape data JSON so it can be embedded as a JS literal in HTML. */
export function escapeInlineJson(payload: string): string {
  return escapeInlineScript(payload).replace(/</g, "\\u003c");
}

const BOOTSTRAP = `(function () {
  var post = function (msg) {
    try { window.ReactNativeWebView.postMessage(JSON.stringify(msg)); }
    catch (e) { /* host gone */ }
  };
  window.onerror = function (message) {
    post({ type: "error", message: String(message) });
  };
  var INITIAL = __INITIAL__;
  var CM = window.AjiroCM;
  var T = CM.tags;
  var currentGrammarKey = INITIAL.grammarKey;
  var currentAutocomplete = INITIAL.autocompleteEnabled !== false;

  // Plugin command chords (canonical ids pushed by the host, §45). Only the
  // chords in this set are claimed; everything else stays the editor's.
  var boundChords = {};

  function chordIdForEvent(event) {
    if (!event) return null;
    var key = String(event.key || "").toLowerCase();
    if (key === " " || key === "spacebar") key = "space";
    if (key === "esc") key = "escape";
    if (key === "return") key = "enter";
    var parts = [];
    if (event.ctrlKey) parts.push("ctrl");
    if (event.altKey) parts.push("alt");
    if (event.shiftKey) parts.push("shift");
    if (event.metaKey) parts.push("meta");
    parts.push(key);
    return parts.join("-");
  }

  function supportFor(key) {
    if (!key) return null;
    try {
      if (CM.MODERN_FACTORIES && CM.MODERN_FACTORIES[key]) {
        return CM.MODERN_FACTORIES[key]();
      }
      if (CM.LEGACY_SUPPORTS && CM.LEGACY_SUPPORTS[key]) {
        return new CM.LanguageSupport(CM.LEGACY_SUPPORTS[key]);
      }
    } catch (e) { /* unknown grammar -> plain text */ }
    return null;
  }

  var HTML_FAMILY = {
    html: 1, xml: 1, css: 1, sCSS: 1, sass: 1,
    less: 1, vue: 1, angular: 1,
  };

  function highlightFor(t) {
    return CM.HighlightStyle.define([
      { tag: T.keyword, color: t.keyword },
      { tag: T.controlKeyword, color: t.keyword },
      { tag: T.string, color: t.string },
      { tag: T.comment, color: t.comment, fontStyle: "italic" },
      { tag: T.number, color: t.number },
      { tag: T.bool, color: t.number },
      { tag: T.function(T.variableName), color: t.function },
      { tag: T.definition(T.function(T.variableName)), color: t.function },
      { tag: T.typeName, color: t.type },
      { tag: T.className, color: t.type },
      { tag: T.operator, color: t.operator },
      { tag: T.tagName, color: t.tag },
      { tag: T.attributeName, color: t.attribute },
      { tag: T.variableName, color: t.variable },
      { tag: T.punctuation, color: t.punctuation },
      { tag: T.regexp, color: t.regex },
    ]);
  }

  function chromeFor(t) {
    var sep = t.gutterBorder && t.gutterBorder !== t.gutterBackground
      ? "1px solid " + t.gutterBorder
      : "none";
    return CM.EditorView.theme({
      "&": { color: t.foreground, backgroundColor: t.background },
      ".cm-content": {
        caretColor: t.cursor,
        fontFamily: "monospace",
        fontSize: "13px",
        lineHeight: "20px",
      },
      // Gutter spacing (relative units, tied to the editor font size):
      // left inset before the number, centered numbers, a fixed chevron
      // cell on every row so the 1px separator stays perfectly straight,
      // and a fixed code margin after the separator.
      ".cm-gutter": { paddingLeft: "1ch" },
      ".cm-lineNumbers .cm-gutterElement": {
        textAlign: "center",
        minWidth: "2ch",
        padding: "0 0.5ch 0 0",
      },
      ".cm-foldGutter": { width: "1.6ch" },
      ".cm-foldGutter .cm-gutterElement": {
        textAlign: "center",
        color: t.gutterForeground,
        width: "1.6ch",
      },
      ".cm-gutters": {
        backgroundColor: t.gutterBackground,
        color: t.gutterForeground,
        border: "none",
        borderRight: sep,
        marginRight: "1.25ch",
      },
      ".cm-content": {
        caretColor: t.cursor,
        fontFamily: "monospace",
        fontSize: "13px",
        lineHeight: "20px",
        paddingRight: "1.25ch",
      },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: t.cursor },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
        backgroundColor: t.selection,
      },
      ".cm-activeLine": { backgroundColor: t.activeLine },
      ".cm-activeLineGutter": {
        backgroundColor: t.activeLine,
        color: t.gutterForeground,
      },
      ".cm-matchingBracket": { backgroundColor: t.matchingBracket },
      // Indentation guides: faint vertical lines at each indent level.
      ".cm-indentGuide": {
        borderLeft: "1px solid " + t.indentGuide,
      },
    }, { dark: t.dark });
  }

  var langCompartment = new CM.Compartment();
  var themeCompartment = new CM.Compartment();
  var autocompleteCompartment = new CM.Compartment();
  var view = null;

  function autocompleteExt(enabled, grammarKey) {
    if (!enabled) return [];
    var emmet = grammarKey && HTML_FAMILY[grammarKey];
    if (emmet) {
      return [
        CM.abbreviationTracker(),
        CM.autocompletion({
          activateOnTyping: true,
          maxRenderedOptions: 6,
          override: [CM.emmetCompletionSource, CM.completeAnyWord],
        }),
      ];
    }
    return [
      CM.autocompletion({ activateOnTyping: true, maxRenderedOptions: 6 }),
    ];
  }

  function extensionsFor(grammarKey, theme, autocompleteEnabled) {
    var support = supportFor(grammarKey);
    var extensions = [
      langCompartment.of(support ? support : []),
      themeCompartment.of([
        chromeFor(theme),
        CM.syntaxHighlighting(highlightFor(theme)),
      ]),
      autocompleteCompartment.of(autocompleteExt(autocompleteEnabled, grammarKey)),
      CM.lineNumbers(),
      CM.highlightActiveLineGutter(),
      CM.highlightSpecialChars(),
      CM.history(),
      CM.foldGutter({
        // Centered chevron cell inside the gutter: down = expanded,
        // right = collapsed. Only lines opening a foldable block render
        // one at all — CodeMirror's foldGutter decides that for real
        // foldable regions (functions, if/for/while, literals, comments).
        markerDOM: function (open) {
          var el = document.createElement("span");
          el.textContent = open ? "▾" : "▸";
          el.setAttribute("aria-hidden", "true");
          return el;
        },
      }),
      CM.drawSelection(),
      CM.dropCursor(),
      CM.rectangularSelection(),
      CM.crosshairCursor(),
      CM.highlightActiveLine(),
      CM.search(),
      CM.closeBrackets(),
      CM.keymap.of([
        CM.closeBracketsKeymap,
        CM.defaultKeymap,
        CM.historyKeymap,
        CM.completionKeymap,
        CM.foldKeymap,
      ]),
      CM.indentOnInput(),
      // A chord a plugin command owns is reported and consumed here. The
      // handler reads the live set, so re-binding needs no reload.
      CM.EditorView.domEventHandlers({
        keydown: function (event) {
          var id = chordIdForEvent(event);
          if (!id || !boundChords[id]) return false;
          post({ type: "command-key", chord: id });
          return true;
        },
      }),
      CM.EditorView.updateListener.of(function (update) {
        if (update.docChanged) {
          try { post({ type: "change", text: update.state.doc.toString() }); }
          catch (e) { /* unreachable */ }
        }
        if (update.selectionSet) {
          try {
            var head = update.state.selection.main.head;
            var line = update.state.doc.lineAt(head);
            post({
              type: "cursor",
              line: line.number,
              column: head - line.from + 1,
            });
          } catch (e) { /* unreachable */ }
        }
      }),
    ];
    return extensions;
  }

  function countMatches(query) {
    if (!query || !view) return 0;
    try {
      var cursor = new CM.SearchCursor(
        view.state.doc,
        query.toLowerCase(),
        0,
        view.state.doc.length,
        function (s) { return s.toLowerCase(); },
      );
      var count = 0;
      while (!cursor.next().done) {
        count += 1;
        if (count > 10000) break;
      }
      return count;
    } catch (e) {
      return 0;
    }
  }

  function applySearch(action, query, replace) {
    if (!view || !query) return;
    try {
      view.dispatch({ effects: CM.setSearchQuery.of(new CM.SearchQuery({
        search: query,
        replace: replace || "",
      })) });
      if (action === "next") CM.findNext(view);
      else if (action === "prev") CM.findPrevious(view);
      else if (action === "select-next") CM.selectNextOccurrence(view);
      else if (action === "replace-one") CM.replaceNext(view);
      else if (action === "replace-all") CM.replaceAll(view);
      post({ type: "find-count", count: countMatches(query) });
    } catch (e) { /* no-op on bad queries */ }
  }

  window.__ajiroEditorInbox = function (msg) {
    if (!view || !msg) return;
    try {
      if (msg.type === "set-doc") {
        if (view.state.doc.toString() !== msg.text) {
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: msg.text },
          });
        }
      } else if (msg.type === "grammar") {
        currentGrammarKey = msg.key;
        var support = supportFor(msg.key);
        view.dispatch({
          effects: [
            langCompartment.reconfigure(support ? support : []),
            autocompleteCompartment.reconfigure(
              autocompleteExt(currentAutocomplete, msg.key),
            ),
          ],
        });
      } else if (msg.type === "theme") {
        view.dispatch({
          effects: themeCompartment.reconfigure([
            chromeFor(msg.theme),
            CM.syntaxHighlighting(highlightFor(msg.theme)),
          ]),
        });
      } else if (msg.type === "autocomplete") {
        currentAutocomplete = msg.enabled !== false;
        view.dispatch({
          effects: autocompleteCompartment.reconfigure(
            autocompleteExt(currentAutocomplete, currentGrammarKey),
          ),
        });
      } else if (msg.type === "undo") {
        CM.undo(view);
      } else if (msg.type === "redo") {
        CM.redo(view);
      } else if (msg.type === "indent") {
        if (msg.outdent) CM.indentLess(view); else CM.indentMore(view);
      } else if (msg.type === "focus") {
        view.focus();
      } else if (msg.type === "search") {
        applySearch(msg.action, msg.query, msg.replace);
      } else if (msg.type === "count") {
        post({ type: "find-count", count: countMatches(msg.query || "") });
      } else if (msg.type === "keybindings") {
        boundChords = {};
        var chords = msg.chords || [];
        for (var i = 0; i < chords.length; i++) {
          if (chords[i]) boundChords[String(chords[i])] = true;
        }
      }
    } catch (e) { /* malformed inbound -> ignore */ }
  };

  try {
    var state = CM.EditorState.create({
      doc: INITIAL.doc,
      extensions: extensionsFor(
        INITIAL.grammarKey,
        INITIAL.theme,
        INITIAL.autocompleteEnabled !== false,
      ),
    });
    view = new CM.EditorView({
      state: state,
      parent: document.getElementById("editor"),
    });
    var head = state.selection.main.head;
    var firstLine = state.doc.lineAt(head);
    post({ type: "ready" });
    post({
      type: "cursor",
      line: firstLine.number,
      column: head - firstLine.from + 1,
    });
  } catch (e) {
    post({ type: "error", message: String((e && e.message) || e) });
  }
})();`;

export function buildEditorDocument(
  params: EditorDocumentParams,
): string {
  const initial = escapeInlineJson(
    JSON.stringify({
      theme: params.theme,
      grammarKey: params.grammarKey,
      doc: params.doc,
      autocompleteEnabled: params.autocompleteEnabled !== false,
    }),
  );
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<style>
  html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; }
  #editor { height: 100%; width: 100%; }
  #editor .cm-editor { height: 100%; }
  #editor .cm-scroller { -webkit-overflow-scrolling: touch; }
  #editor .cm-content { touch-action: manipulation; }
</style>
</head>
<body>
<div id="editor"></div>
<script>${escapeInlineScript(CM_BUNDLE_JS)}</script>
<script>${BOOTSTRAP.replace("__INITIAL__", () => initial)}</script>
</body>
</html>`;
}
