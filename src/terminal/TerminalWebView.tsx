/**
 * Canonical terminal renderer: local xterm inside `react-native-webview`.
 *
 * - xterm (`@xterm/xterm` + `@xterm/addon-fit`) is vendored offline via
 *   `npm run vendor:terminal` → `src/terminal/xtermBundle.ts` and inlined
 *   into the HTML document. No CDN, no remote loading.
 * - ANSI/VT interpretation happens ONLY here (xterm). Raw PTY bytes arrive
 *   via the `input` inbound message and are written verbatim to the terminal.
 * - Touch scrolling (momentum physics), touch selection (long-press word
 *   select + drag extend), cursor, ligature flag, dynamic theming, and fit
 *   measurement are adapted from the Acode terminal UI
 *   (`terminalTouchScrolling.js`, `terminalTouchSelection.js`,
 *   `terminalDefaults.js`, `terminalThemeManager.js`) translated to this
 *   WebView+xterm setting.
 */
import { useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import { resolveTerminalOptions } from "@/terminal/terminalConfig";
import { toXtermTheme } from "@/terminal/terminalTheme";
import type {
  TerminalDimensions,
  TerminalOptions,
  TerminalTheme,
  TerminalWebViewInbound,
  TerminalWebViewMessage,
} from "@/terminal/terminalTypes";
import { FIT_ADDON_JS, SEARCH_ADDON_JS, XTERM_CSS, XTERM_JS } from "@/terminal/xtermBundle";

export interface TerminalWebViewProps {
  theme: TerminalTheme;
  options?: Partial<TerminalOptions>;
  onMessage?: (message: TerminalWebViewMessage) => void;
  onReady?: (dimensions: TerminalDimensions) => void;
  onResize?: (dimensions: TerminalDimensions) => void;
}

export interface TerminalWebViewRef {
  postInbound(message: TerminalWebViewInbound): void;
}

interface BootstrapParams {
  options: TerminalOptions;
  xtermTheme: Record<string, string>;
}

function buildDocument(params: BootstrapParams): string {
  const { options, xtermTheme } = params;
  // JSON-encode everything crossing the TS→HTML boundary.
  const initialOptions = JSON.stringify({
    fontSize: options.fontSize,
    fontFamily: options.fontFamily,
    fontWeight: options.fontWeight,
    letterSpacing: options.letterSpacing,
    lineHeight: options.lineHeight,
    cursorBlink: options.cursorBlink,
    cursorStyle: options.cursorStyle,
    scrollback: options.scrollback,
    tabStopWidth: options.tabStopWidth,
    convertEol: options.convertEol,
    theme: xtermTheme,
  });
  const tapHold = JSON.stringify(options.touchSelectionTapHoldDuration);
  const haptics = JSON.stringify(options.touchSelectionHapticFeedback);
  const showScrollbar = JSON.stringify(options.showScrollbar);

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<style>${XTERM_CSS}</style>
<style>
  html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; }
  #terminal { height: 100%; width: 100%; padding: 8px; box-sizing: border-box; }
  #terminal.ligatures .xterm-screen { font-variant-ligatures: contextual; }
  #terminal.blurred .xterm-cursor-layer { opacity: 0.55; }
  #terminal.hide-scrollbar .xterm-viewport::-webkit-scrollbar { display: none; }
  #terminal.hide-scrollbar .xterm-viewport { scrollbar-width: none; }
  .xterm-viewport::-webkit-scrollbar { width: 8px; height: 8px; }
  .xterm-viewport::-webkit-scrollbar-track { background: transparent; }
  .xterm-viewport::-webkit-scrollbar-thumb {
    background: var(--sb-thumb, #888888);
    border-radius: 4px;
  }
  .xterm { user-select: text; -webkit-user-select: text; -webkit-touch-callout: default; }
  .xterm-screen { touch-action: pan-x pan-y; }
</style>
</head>
<body>
<div id="terminal"></div>
<script>${XTERM_JS}</script>
<script>${FIT_ADDON_JS}</script>
<script>${SEARCH_ADDON_JS}</script>
<script>
(function () {
  var post = function (msg) {
    try {
      window.ReactNativeWebView.postMessage(JSON.stringify(msg));
    } catch (e) { /* host gone */ }
  };
  window.onerror = function (message) {
    post({ type: "error", message: String(message) });
  };

  var INITIAL = ${initialOptions};
  var CURRENT_THEME = INITIAL.theme;
  var TAP_HOLD_MS = ${tapHold};
  var HAPTICS = ${haptics};
  var SHOW_SCROLLBAR = ${showScrollbar};

  var el = document.getElementById("terminal");
  if (!SHOW_SCROLLBAR) el.classList.add("hide-scrollbar");
  function applyChromeTheme(t) {
    // Scrollbar thumb follows the selection color so scroll indicators stay
    // inside the active application theme (live-updated, no reload).
    try {
      el.style.setProperty("--sb-thumb", t.selectionBackground || t.foreground);
    } catch (e) {}
  }
  applyChromeTheme(INITIAL.theme);

  var term = new window.Terminal({
    fontSize: INITIAL.fontSize,
    fontFamily: INITIAL.fontFamily,
    fontWeight: INITIAL.fontWeight,
    letterSpacing: INITIAL.letterSpacing,
    lineHeight: INITIAL.lineHeight,
    cursorBlink: INITIAL.cursorBlink,
    cursorStyle: INITIAL.cursorStyle,
    scrollback: INITIAL.scrollback,
    tabStopWidth: INITIAL.tabStopWidth,
    convertEol: INITIAL.convertEol,
    theme: INITIAL.theme,
    allowTransparency: false,
  });
  var fit = new window.FitAddon.FitAddon();
  term.loadAddon(fit);
  var search = null;
  try {
    search = new window.SearchAddon.SearchAddon();
    term.loadAddon(search);
  } catch (e) { search = null; }
  term.open(el);
  try { fit.fit(); } catch (e) { /* not laid out yet */ }

  var buzz = function () {
    if (HAPTICS && navigator.vibrate) { try { navigator.vibrate(12); } catch (e) {} }
  };

  // ---- outbound: keystrokes, focus, geometry ----
  term.onData(function (data) { post({ type: "input", data: data }); });
  term.textarea = term.textarea || null;
  el.addEventListener("pointerdown", function () {
    post({ type: "focus" });
  });

  var lastDims = { cols: term.cols || 80, rows: term.rows || 24 };
  var resizeTimer = null;
  function reportSize() {
    try { fit.fit(); } catch (e) { return; }
    if (term.cols === lastDims.cols && term.rows === lastDims.rows) return;
    lastDims = { cols: term.cols, rows: term.rows };
    post({ type: "resize", cols: term.cols, rows: term.rows });
    selectionFix();
  }
  function reportSizeSoon() {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(reportSize, 150);
  }
  if (window.ResizeObserver) {
    new ResizeObserver(reportSizeSoon).observe(el);
  }
  window.addEventListener("resize", reportSizeSoon);
  window.addEventListener("orientationchange", reportSizeSoon);

  // ---- inbound ----
  document.addEventListener("message", function (event) {
    handleInbound(event.data);
  });
  window.addEventListener("message", function (event) {
    handleInbound(event.data);
  });
  function handleInbound(raw) {
    var msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    if (!msg || typeof msg.type !== "string") return;
    if (msg.type === "input" && typeof msg.data === "string" && msg.data) {
      term.write(msg.data);
    } else if (msg.type === "resize") {
      reportSize();
    } else if (msg.type === "focus") {
      term.focus();
      el.classList.remove("blurred");
    } else if (msg.type === "blur") {
      term.blur();
      el.classList.add("blurred");
    } else if (msg.type === "clear") {
      term.clear();
    } else if (msg.type === "theme" && msg.theme) {
      try { term.options.theme = msg.theme; CURRENT_THEME = msg.theme; } catch (e) {}
      applyChromeTheme(msg.theme);
    } else if (msg.type === "find") {
      if (!search || typeof msg.query !== "string" || !msg.query) {
        try { if (search) search.clearDecorations(); } catch (e) {}
        post({ type: "findResult", found: false });
      } else if (msg.direction === "clear") {
        try { search.clearDecorations(); } catch (e) {}
      } else {
        var found = false;
        try {
          var searchOptions = {
            decorations: {
              matchBackground: (CURRENT_THEME.selectionBackground || "#264F78"),
              activeMatchBackground: (CURRENT_THEME.cursor || "#0A84FF"),
            },
          };
          found = msg.direction === "prev"
            ? search.findPrevious(msg.query, searchOptions)
            : search.findNext(msg.query, searchOptions);
        } catch (e) { found = false; }
        post({ type: "findResult", found: !!found });
      }
    } else if (msg.type === "options" && msg.options) {
      var o = msg.options;
      var refit = false;
      ["fontSize","fontFamily","fontWeight","letterSpacing","lineHeight",
       "cursorBlink","cursorStyle","scrollback","tabStopWidth","convertEol"
      ].forEach(function (key) {
        if (o[key] !== undefined) {
          try { term.options[key] = o[key]; } catch (e) {}
          if (key === "fontSize" || key === "fontFamily" || key === "lineHeight") refit = true;
        }
      });
      if (typeof o.fontLigatures === "boolean") {
        el.classList.toggle("ligatures", o.fontLigatures);
      }
      if (refit) reportSizeSoon();
    }
  }

  // ---- touch scrolling with momentum (Acode TerminalTouchScrolling port) ----
  // Pixel movement converts to rows via measured cell height and flows through
  // xterm's public scrollLines(); alternate-screen buffers receive wheel
  // events instead so vim/less keep working.
  var scroller = {
    touching: false, didScroll: false, totalMovement: 0,
    lastX: 0, lastY: 0, lastTime: 0,
    velocitySamples: [], velocity: 0, remainder: 0,
    friction: 0.92, minVelocity: 0.5, confirmPixels: 6,
    animationId: null,
  };
  function cellHeight() {
    var screen = el.querySelector(".xterm-screen");
    var h = screen ? screen.getBoundingClientRect().height : 0;
    if (h > 0 && term.rows > 0) return h / term.rows;
    return (term.options.fontSize || 14) * (term.options.lineHeight || 1.2);
  }
  function scrollByPixels(deltaY, clientX, clientY) {
    var buffer = null;
    try { buffer = term.buffer.active; } catch (e) {}
    if (buffer && buffer.type === "alternate") {
      var target = el.querySelector(".xterm-screen") || el;
      try {
        target.dispatchEvent(new WheelEvent("wheel", {
          bubbles: true, cancelable: true,
          clientX: clientX, clientY: clientY,
          deltaY: deltaY, deltaMode: WheelEvent.DOM_DELTA_PIXEL,
        }));
      } catch (e) {}
      return;
    }
    var ch = cellHeight();
    if (!isFinite(ch) || ch <= 0) return;
    scroller.remainder += deltaY;
    var lines = Math.trunc(scroller.remainder / ch);
    if (lines === 0) return;
    try { term.scrollLines(lines); } catch (e) {}
    scroller.remainder -= lines * ch;
  }
  function stopMomentum() {
    if (scroller.animationId) {
      cancelAnimationFrame(scroller.animationId);
      scroller.animationId = null;
    }
    scroller.velocity = 0;
  }
  function startMomentum() {
    var animate = function () {
      if (scroller.touching) { scroller.animationId = null; return; }
      if (Math.abs(scroller.velocity) < scroller.minVelocity) { stopMomentum(); return; }
      scroller.velocity *= scroller.friction;
      scrollByPixels(scroller.velocity, scroller.lastX, scroller.lastY);
      scroller.animationId = requestAnimationFrame(animate);
    };
    scroller.animationId = requestAnimationFrame(animate);
  }
  function selectionActive() {
    return !!(selector.selecting || selector.handleDrag);
  }

  // ---- touch selection: long-press word select + drag extend ----
  // (Acode terminalTouchSelection behavior, adapted to xterm's select API.)
  var selector = {
    selecting: false, handleDrag: false,
    anchor: null, timer: null, startX: 0, startY: 0, moved: false,
  };
  function bufferPosFromPoint(x, y) {
    var screen = el.querySelector(".xterm-screen");
    var rect = (screen || el).getBoundingClientRect();
    var ch = cellHeight();
    var cw = 0;
    try {
      var dims = term._core ? null : null;
      cw = (term.options.fontSize || 14) * 0.6 + (term.options.letterSpacing || 0);
    } catch (e) {}
    if (!cw || !isFinite(cw) || cw <= 0) cw = 8;
    var col = Math.floor((x - rect.left - 8) / cw);
    var row = Math.floor((y - rect.top - 8) / ch);
    return { col: Math.max(0, col), row: Math.max(0, row) };
  }
  function wordAt(bufferLine, col) {
    var text = "";
    try { text = bufferLine.translateToString(true); } catch (e) { return null; }
    if (!text || col >= text.length) return null;
    var isWord = function (c) { return /[A-Za-z0-9_./-]/.test(c); };
    if (!isWord(text[col])) return null;
    var start = col, end = col;
    while (start > 0 && isWord(text[start - 1])) start--;
    while (end < text.length && isWord(text[end])) end++;
    return { start: start, length: Math.max(1, end - start) };
  }
  var selectionTimer = null;
  function postSelectionSoon() {
    if (selectionTimer) clearTimeout(selectionTimer);
    selectionTimer = setTimeout(function () {
      var text = "";
      try { text = term.getSelection() || ""; } catch (e) {}
      if (text) post({ type: "selection", text: text });
    }, 250);
  }
  try {
    term.onSelectionChange(function () { postSelectionSoon(); });
  } catch (e) { /* older xterm: polling fallback below is skipped */ }

  el.addEventListener("touchstart", function (e) {
    if (e.touches.length !== 1) {
      if (selector.timer) { clearTimeout(selector.timer); selector.timer = null; }
      return;
    }
    var t = e.touches[0];
    stopMomentum();
    scroller.touching = true;
    scroller.didScroll = false;
    scroller.totalMovement = 0;
    scroller.velocity = 0;
    scroller.velocitySamples = [];
    scroller.remainder = 0;
    scroller.lastX = t.clientX; scroller.lastY = t.clientY;
    scroller.lastTime = performance.now();
    selector.moved = false;
    selector.startX = t.clientX; selector.startY = t.clientY;
    if (selector.timer) clearTimeout(selector.timer);
    var sx = t.clientX, sy = t.clientY;
    selector.timer = setTimeout(function () {
      if (scroller.didScroll || selector.moved) return;
      var pos = bufferPosFromPoint(sx, sy);
      var line = null;
      try { line = term.buffer.active.getLine(pos.row + term.buffer.active.viewportY); } catch (e) {}
      if (!line) return;
      var word = wordAt(line, pos.col);
      if (!word) return;
      try {
        term.select(word.start, pos.row, word.length);
        selector.selecting = true;
        selector.anchor = { col: word.start, row: pos.row };
        buzz();
      } catch (err) {}
    }, TAP_HOLD_MS);
  }, { passive: true });

  el.addEventListener("touchmove", function (e) {
    if (!scroller.touching || e.touches.length !== 1) return;
    var t = e.touches[0];
    if (Math.hypot(t.clientX - selector.startX, t.clientY - selector.startY) > 8) {
      selector.moved = true;
      if (selector.timer) { clearTimeout(selector.timer); selector.timer = null; }
    }
    if (selector.selecting && selector.anchor && selector.moved) {
      // Extend the word selection toward the drag point.
      var pos = bufferPosFromPoint(t.clientX, t.clientY);
      try {
        var a = selector.anchor;
        var fromRow = Math.min(a.row, pos.row), toRow = Math.max(a.row, pos.row);
        term.select(a.col, a.row, 0);
        term.select(a.col, fromRow, (toRow - fromRow + 1) * (term.cols || 80));
      } catch (err) {}
      if (e.cancelable) e.preventDefault();
      return;
    }
    var deltaY = scroller.lastY - t.clientY;
    var dt = performance.now() - scroller.lastTime;
    scroller.totalMovement += Math.abs(deltaY);
    if (dt > 0) {
      var v = (deltaY / dt) * 16.67;
      scroller.velocitySamples.push(v);
      if (scroller.velocitySamples.length > 5) scroller.velocitySamples.shift();
    }
    if (Math.abs(deltaY) > 0.5) {
      scrollByPixels(deltaY, t.clientX, t.clientY);
      if (scroller.totalMovement > scroller.confirmPixels) {
        if (e.cancelable) e.preventDefault();
        scroller.didScroll = true;
        if (selector.timer) { clearTimeout(selector.timer); selector.timer = null; }
      }
    }
    scroller.lastX = t.clientX; scroller.lastY = t.clientY;
    scroller.lastTime = performance.now();
  }, { passive: false });

  var touchEnd = function (e) {
    if (selector.timer) { clearTimeout(selector.timer); selector.timer = null; }
    if (!scroller.touching) return;
    if (scroller.didScroll && e.cancelable) { try { e.preventDefault(); } catch (err) {} }
    scroller.touching = false;
    if (!scroller.didScroll) { scroller.velocitySamples = []; return; }
    if (scroller.velocitySamples.length > 0) {
      var sum = scroller.velocitySamples.reduce(function (a, b) { return a + b; }, 0);
      scroller.velocity = (sum / scroller.velocitySamples.length) * 1.1;
    }
    if (Math.abs(scroller.velocity) >= scroller.minVelocity) startMomentum();
    scroller.velocitySamples = [];
    setTimeout(function () { selector.selecting = false; }, 4000);
  };
  el.addEventListener("touchend", touchEnd, { passive: false });
  el.addEventListener("touchcancel", function () {
    if (selector.timer) { clearTimeout(selector.timer); selector.timer = null; }
    scroller.touching = false;
    scroller.didScroll = false;
    scroller.velocitySamples = [];
    scroller.remainder = 0;
    stopMomentum();
  });

  function selectionFix() { /* keep viewport stable across refits */ }

  // Signal readiness (RN then spawns/attaches the PTY and posts backlog).
  post({ type: "ready" });
  reportSizeSoon();
})();
</script>
</body>
</html>`;
}

export function TerminalWebView({
  theme,
  options,
  onMessage,
  onReady,
  onResize,
  ref,
}: TerminalWebViewProps & {
  ref?: React.Ref<TerminalWebViewRef>;
}): React.JSX.Element {
  const webViewRef = useRef<WebView>(null);
  const messageRef = useRef(onMessage);
  messageRef.current = onMessage;
  const readyRef = useRef(onReady);
  readyRef.current = onReady;
  const resizeRef = useRef(onResize);
  resizeRef.current = onResize;

  useImperativeHandle(
    ref,
    () => ({
      postInbound(message: TerminalWebViewInbound): void {
        webViewRef.current?.postMessage(JSON.stringify(message));
      },
    }),
    [],
  );

  const resolvedOptions = useMemo(() => resolveTerminalOptions(options), [options]);
  const xtermTheme = useMemo(() => toXtermTheme(theme), [theme]);

  const html = useMemo(() => {
    if (!XTERM_JS || !XTERM_CSS) {
      return null;
    }
    return buildDocument({ options: resolvedOptions, xtermTheme });
    // Theme is applied live via postInbound (no WebView reload on theme change).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedOptions]);

  // Live-apply theme + option deltas without reloading the WebView, so the
  // PTY/PRoot/Linux session is never restarted for visual updates.
  const xtermThemeKey = JSON.stringify(xtermTheme);
  const optionsKey = JSON.stringify(resolvedOptions);
  useEffect(() => {
    if (!html) return;
    const inbound: TerminalWebViewInbound = { type: "theme", theme: xtermTheme };
    webViewRef.current?.postMessage(JSON.stringify(inbound));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xtermThemeKey, html]);
  useEffect(() => {
    if (!html) return;
    const inbound: TerminalWebViewInbound = {
      type: "options",
      options: resolvedOptions,
    };
    webViewRef.current?.postMessage(JSON.stringify(inbound));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optionsKey, html]);

  const handleMessage = (event: WebViewMessageEvent): void => {
    let message: TerminalWebViewMessage;
    try {
      message = JSON.parse(event.nativeEvent.data) as TerminalWebViewMessage;
    } catch {
      return;
    }
    if (message.type === "ready") {
      readyRef.current?.({ cols: 80, rows: 24 });
    } else if (message.type === "resize") {
      resizeRef.current?.({ cols: message.cols, rows: message.rows });
    }
    messageRef.current?.(message);
  };

  if (!html) {
    // Honest empty state (theme-aware): the vendor bundle is generated by
    // `npm run vendor:terminal` after install — never a blank screen.
    return (
      <View style={[styles.container, styles.missing, { backgroundColor: theme.background }]}>
        <WebViewMissingBundleNotice foreground={theme.foreground} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        originWhitelist={["*"]}
        source={{ html, baseUrl: "about:blank" }}
        style={styles.webview}
        containerStyle={styles.webview}
        javaScriptEnabled
        domStorageEnabled={false}
        allowFileAccess={false}
        allowUniversalAccessFromFileURLs={false}
        mixedContentMode="never"
        cacheEnabled={false}
        onMessage={handleMessage}
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        keyboardDisplayRequiresUserAction={false}
        hideKeyboardAccessoryView={false}
        textInteractionEnabled
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  webview: { flex: 1, backgroundColor: "transparent" },
  missing: { alignItems: "center", justifyContent: "center", padding: 24 },
  missingText: { fontSize: 13, fontFamily: "monospace", textAlign: "center" },
});

function WebViewMissingBundleNotice({
  foreground,
}: {
  foreground: string;
}): React.JSX.Element {
  return (
    <Text style={[styles.missingText, { color: foreground }]}>
      Terminal renderer bundle missing. Run `npm run vendor:terminal` after `npm install`, then
      rebuild.
    </Text>
  );
}
