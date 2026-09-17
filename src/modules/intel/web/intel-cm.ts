/**
 * CodeMirror intel UI (§3 pipeline, last hop).
 *
 * Binds a WebView intel session to a live `EditorView` and returns the
 * extensions the bootstrap composes into the editor: a semantic completion
 * source, an overlay plugin (semantic tokens, diagnostic squiggles, inline
 * ghost), touch handlers, and an update hook. Tooltips (hover, signature
 * help) are custom touch-friendly DOM — never desktop-style popups.
 *
 * CodeMirror runtime values arrive via the injected `cm` surface (the
 * vendored `window.AjiroCM`); all CodeMirror *types* are `import type`
 * (erased — zero bundle cost, fully typed here).
 */
import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";

import type { IntelWebSession } from "@/modules/intel/web/intel-web-entry";

export interface IntelCmSurface {
  autocompletion(options?: Record<string, unknown>): unknown;
  closeCompletion(view: unknown): boolean;
  Decoration: {
    mark(options: Record<string, unknown>): unknown;
    widget(options: Record<string, unknown>): unknown;
    set(of: unknown[], sort?: boolean): unknown;
    none: unknown;
  };
  ViewPlugin: {
    fromClass(
      cls: new (view: unknown) => { update?: (update: IntelViewUpdate) => void; destroy?: () => void },
      options?: { decorations?: (value: { decorations: unknown }) => unknown },
    ): unknown;
  };
  WidgetType: new () => {
    toDOM(): HTMLElement;
    eq(other: unknown): boolean;
    ignoreEvent(): boolean;
  };
  keymap: { of(bindings: unknown[]): unknown };
  Prec: { highest(extension: unknown): unknown };
  StateEffect: { define<T>(): { of(value: T): unknown } };
}

export interface IntelViewState {
  doc: {
    toString(): string;
    length: number;
    lineAt(offset: number): { number: number; from: number };
  };
  selection: { main: { head: number } };
}

export interface IntelViewUpdate {
  docChanged: boolean;
  selectionSet: boolean;
  transactions: { effects: unknown[] }[];
  state: IntelViewState;
  view: {
    dispatch(transaction: unknown): void;
    coordsAtPos(offset: number): { left: number; top: number; bottom: number } | null;
    scrollDOM: HTMLElement;
    contentDOM: HTMLElement;
    posAtCoords(coords: { x: number; y: number }): number | null;
  };
}

export interface IntelUiOptions {
  post(message: Record<string, unknown>): void;
  getUri(): string | null;
  getVersion(): number;
  colorFor(tokenType: string): string;
  errorColor: string;
  warningColor: string;
}

export interface IntelUiExtensions {
  /**
   * Raw completion source for the bootstrap's single `autocompletion`
   * instance (multiple instances must never coexist).
   */
  completionSource: (context: CompletionContext) => Promise<CompletionResult | null>;
  overlays: unknown;
  keymap: unknown;
  domEventHandlers: {
    touchstart(event: TouchEvent, view: unknown): void;
    touchend(): void;
    touchmove(): void;
    keydown?(event: KeyboardEvent, view: unknown): boolean;
  };
}

export interface IntelUiHandle {
  extensions: IntelUiExtensions;
  handleUpdate(update: IntelViewUpdate): void;
  refreshSemanticOverlays(): void;
  showHoverAtCursor(): void;
  acceptGhost(): boolean;
  dismissOverlays(): void;
  setGhost(text: string | null, version: number): void;
}

function offsetToLineCol(
  state: IntelViewState,
  offset: number,
): { line: number; column: number } {
  const safe = Math.max(0, Math.min(offset, state.doc.length));
  const line = state.doc.lineAt(safe);
  return { line: line.number, column: safe - line.from + 1 };
}

function lineColToOffset(state: IntelViewState, line: number, column: number): number {
  const text = state.doc.toString();
  const lines = text.split("\n");
  const clampedLine = Math.min(Math.max(line, 1), lines.length);
  let offset = 0;
  for (let i = 0; i < clampedLine - 1; i += 1) offset += (lines[i] ?? "").length + 1;
  return offset + Math.max(0, column - 1);
}

export function mountIntelUI(
  cm: IntelCmSurface,
  view: EditorView,
  session: IntelWebSession,
  options: IntelUiOptions,
): IntelUiHandle {
  const runtimeView = view as unknown as IntelViewUpdate["view"] & {
    dispatch(transaction: unknown): void;
  };
  const runtimeState = (): IntelViewState =>
    (view as unknown as { state: IntelViewState }).state;

  let ghostText: string | null = null;
  let tooltip: HTMLElement | null = null;
  let signatureBox: HTMLElement | null = null;
  let overlayVersion = -1;
  let pendingDecorations: unknown = cm.Decoration.none;
  let signatureTimer: ReturnType<typeof setTimeout> | null = null;
  let diagnosticsTimer: ReturnType<typeof setTimeout> | null = null;

  const refreshEffect = cm.StateEffect.define<number>();

  function closeTooltip(): void {
    tooltip?.remove();
    tooltip = null;
  }

  function closeSignature(): void {
    signatureBox?.remove();
    signatureBox = null;
  }

  function bubble(text: string, role: string): HTMLElement {
    const element = document.createElement("div");
    element.setAttribute("role", role);
    element.style.cssText = [
      "position:absolute", "z-index:60", "max-width:82vw", "max-height:38vh",
      "overflow:auto", "border-radius:12px", "padding:10px 12px",
      "font:12px/1.5 monospace", "white-space:pre-wrap", "word-break:break-word",
      "background:rgba(20,22,28,0.96)", "color:#e8eaf0",
      "border:1px solid rgba(255,255,255,0.14)",
      "box-shadow:0 8px 28px rgba(0,0,0,0.45)",
      "-webkit-overflow-scrolling:touch",
    ].join(";");
    element.textContent = text;
    runtimeView.contentDOM.style.position = "relative";
    runtimeView.contentDOM.appendChild(element);
    return element;
  }

  function placeNear(element: HTMLElement, offset: number): void {
    const coords = runtimeView.coordsAtPos(offset);
    if (!coords) return;
    const top = coords.bottom - runtimeView.scrollDOM.scrollTop + 6;
    element.style.left = `${Math.max(8, coords.left)}px`;
    element.style.top = `${top}px`;
  }

  async function showHover(offset: number): Promise<void> {
    const uri = options.getUri();
    if (!uri) return;
    const state = runtimeState();
    const { line, column } = offsetToLineCol(state, offset);
    const info = await session.hover(uri, options.getVersion(), line, column);
    closeTooltip();
    if (!info || info.contents.length === 0) return;
    tooltip = bubble(info.contents.join("\n\n"), "tooltip");
    const dismiss = document.createElement("button");
    dismiss.textContent = "✕";
    dismiss.setAttribute("aria-label", "Dismiss");
    dismiss.style.cssText =
      "position:absolute;top:4px;right:6px;background:none;border:none;color:#999;font-size:14px;";
    dismiss.onclick = (event) => {
      event.stopPropagation();
      closeTooltip();
    };
    tooltip.appendChild(dismiss);
    tooltip.style.paddingRight = "30px";
    placeNear(tooltip, offset);
  }

  async function updateSignature(): Promise<void> {
    const uri = options.getUri();
    if (!uri) return;
    const state = runtimeState();
    const head = state.selection.main.head;
    const { line, column } = offsetToLineCol(state, head);
    const help = await session.signature(uri, options.getVersion(), line, column);
    closeSignature();
    if (!help || help.signatures.length === 0) return;
    const active = help.signatures[Math.min(help.activeSignature, help.signatures.length - 1)];
    if (!active) return;
    const lines = active.parameters.map((parameter, index) =>
      index === help.activeParameter ? `▶ ${parameter.label}` : `  ${parameter.label}`,
    );
    signatureBox = bubble(`${active.label}\n${lines.join("\n")}`, "status");
    signatureBox.style.maxHeight = "24vh";
    placeNear(signatureBox, head);
  }

  function scheduleSignature(): void {
    if (signatureTimer) clearTimeout(signatureTimer);
    signatureTimer = setTimeout(() => {
      signatureTimer = null;
      void updateSignature();
    }, 350);
  }

  function scheduleDiagnostics(): void {
    if (diagnosticsTimer) clearTimeout(diagnosticsTimer);
    diagnosticsTimer = setTimeout(() => {
      diagnosticsTimer = null;
      void refreshSemanticOverlays();
    }, 600);
  }

  // Ghost widget: tap the text to accept, ⇅ to cycle suggestions,
  // ✕ to dismiss. All touch-sized; keyboard Tab/Escape also work.
  class GhostWidget extends cm.WidgetType {
    constructor(private readonly text: string) {
      super();
    }
    toDOM(): HTMLElement {
      const wrap = document.createElement("span");
      wrap.setAttribute("data-ajiro-ghost", "1");
      const text = document.createElement("span");
      text.textContent = this.text.split("\n")[0] ?? "";
      text.style.cssText = "opacity:0.45;font-style:italic;";
      text.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        acceptGhost();
      };
      const next = document.createElement("span");
      next.textContent = " ⇅";
      next.setAttribute("role", "button");
      next.setAttribute("aria-label", "Next suggestion");
      next.style.cssText = "opacity:0.8;font-style:normal;padding:0 6px;";
      next.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        cycleGhost(1);
      };
      const dismiss = document.createElement("span");
      dismiss.textContent = "✕";
      dismiss.setAttribute("role", "button");
      dismiss.setAttribute("aria-label", "Dismiss suggestion");
      dismiss.style.cssText = "opacity:0.8;font-style:normal;padding:0 6px;";
      dismiss.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        rejectGhost();
      };
      wrap.appendChild(text);
      wrap.appendChild(next);
      wrap.appendChild(dismiss);
      return wrap;
    }
    eq(other: unknown): boolean {
      return other instanceof GhostWidget && other.text === this.text;
    }
    ignoreEvent(): boolean {
      return false;
    }
  }

  function acceptGhost(): boolean {
    if (!ghostText) return false;
    const state = runtimeState();
    const head = state.selection.main.head;
    runtimeView.dispatch({ changes: { from: head, insert: ghostText } });
    ghostText = null;
    return true;
  }

  // Local suggestion history so ⇅ cycles recent ghosts without a
  // round-trip. Entries are explicit user-accepted insertions only.
  const ghostHistory: string[] = [];
  let ghostIndex = -1;

  function redrawGhost(): void {
    rebuildDecorations(runtimeState(), options.getVersion());
    runtimeView.dispatch({ effects: refreshEffect.of(options.getVersion()) });
  }

  function cycleGhost(direction: 1 | -1): void {
    if (ghostHistory.length === 0) return;
    ghostIndex = (ghostIndex + direction + ghostHistory.length) % ghostHistory.length;
    ghostText = ghostHistory[ghostIndex] ?? null;
    redrawGhost();
  }

  function rejectGhost(): void {
    ghostText = null;
    redrawGhost();
  }

  function rebuildDecorations(state: IntelViewState, version: number): void {
    const decorations: unknown[] = [];
    if (ghostText && version === options.getVersion()) {
      const head = state.selection.main.head;
      decorations.push(
        (cm.Decoration.widget as (options: Record<string, unknown>) => { range(offset: number): unknown })({
          widget: new GhostWidget(ghostText),
          side: 1,
        }).range(head),
      );
    }
    pendingDecorations = cm.Decoration.set(decorations, true);
  }

  async function refreshSemanticOverlays(): Promise<void> {
    const uri = options.getUri();
    if (!uri) return;
    const version = options.getVersion();
    overlayVersion = version;
    const state = runtimeState();
    const visibleEnd = Math.min(state.doc.length, state.selection.main.head + 20000);
    const endLine = state.doc.lineAt(visibleEnd).number;
    const [tokens, diagnostics, inlays] = await Promise.all([
      session.tokens(uri, version).catch((): never[] => []),
      session.diagnose(uri, version).catch((): never[] => []),
      session
        .inlay(uri, version, {
          start: { line: Math.max(1, endLine - 400), column: 1 },
          end: { line: endLine, column: 1 },
        })
        .catch((): never[] => []),
    ]);
    if (overlayVersion !== options.getVersion()) return;
    options.post({
      type: "intel:diagnostics",
      version,
      diagnostics: diagnostics.map((diagnostic) => ({
        severity: diagnostic.severity,
        message: diagnostic.message,
        code: diagnostic.code,
        range: diagnostic.range,
      })),
    });
    const decorations: unknown[] = [];
    for (const hint of inlays.slice(0, 30)) {
      try {
        const at = lineColToOffset(state, hint.position.line, hint.position.column);
        const span = document.createElement("span");
        span.textContent = hint.label;
        span.style.cssText = "opacity:0.5;font-size:0.92em;";
        span.setAttribute("data-ajiro-inlay", hint.kind);
        class HintWidget extends cm.WidgetType {
          toDOM(): HTMLElement {
            return span;
          }
          eq(): boolean {
            return false;
          }
          ignoreEvent(): boolean {
            return true;
          }
        }
        decorations.push(
          (cm.Decoration.widget as (options: Record<string, unknown>) => { range(offset: number): unknown })({
            widget: new HintWidget(),
            side: 1,
          }).range(at),
        );
      } catch {
        // Ignore stale hint positions.
      }
    }
    for (const token of tokens.slice(0, 2000)) {
      try {
        const from = lineColToOffset(state, token.line, token.startColumn);
        decorations.push(
          (cm.Decoration.mark as (options: Record<string, unknown>) => { range(from: number, to: number): unknown })({
            attributes: { style: `color:${options.colorFor(token.tokenType)}` },
          }).range(from, from + token.length),
        );
      } catch {
        // Stale offsets must never break rendering.
      }
    }
    for (const diagnostic of diagnostics.slice(0, 200)) {
      try {
        const from = lineColToOffset(state, diagnostic.range.start.line, diagnostic.range.start.column);
        const to = lineColToOffset(state, diagnostic.range.end.line, diagnostic.range.end.column);
        const color = diagnostic.severity === "error" ? options.errorColor : options.warningColor;
        decorations.push(
          (cm.Decoration.mark as (options: Record<string, unknown>) => { range(from: number, to: number): unknown })({
            attributes: {
              style: `text-decoration:underline wavy ${color} 1px`,
              title: diagnostic.message,
            },
          }).range(Math.min(from, to), Math.max(from, to) + 1),
        );
      } catch {
        // Ignore stale ranges.
      }
    }
    if (ghostText && version === options.getVersion()) {
      const head = state.selection.main.head;
      decorations.push(
        (cm.Decoration.widget as (options: Record<string, unknown>) => { range(offset: number): unknown })({
          widget: new GhostWidget(ghostText),
          side: 1,
        }).range(head),
      );
    }
    pendingDecorations = cm.Decoration.set(decorations, true);
    runtimeView.dispatch({ effects: refreshEffect.of(version) });
  }

  async function completionSource(context: CompletionContext): Promise<CompletionResult | null> {
    const uri = options.getUri();
    if (!uri) return null;
    const version = options.getVersion();
    const state = context.state as unknown as IntelViewState;
    const { line, column } = offsetToLineCol(state, context.pos);
    const before = state.doc.toString().slice(0, context.pos);
    const wordMatch = /[A-Za-z_$][\w$]*$/.exec(before);
    const wordPrefix = wordMatch?.[0] ?? "";
    const stringMatch = /["'`]([^"'`]*)$/.exec(before.split("\n").pop() ?? "");
    const items = await session.complete(
      uri,
      version,
      line,
      column,
      wordPrefix,
      stringMatch !== null,
      stringMatch?.[1] ?? "",
      context.explicit,
      null,
    );
    if (items.length === 0) return null;
    return {
      from: context.pos - wordPrefix.length,
      filter: false,
      options: items.map((item) => ({
        label: item.label,
        type: item.kind,
        detail: item.detail ?? undefined,
        info: item.documentation ?? undefined,
        boost: item.source === "semantic" ? 2 : item.source === "ai" ? -1 : 0,
        apply: (viewArg: EditorView, _completion: unknown, from: number, to: number) => {
          const target = viewArg as unknown as { dispatch(tr: unknown): void; state: IntelViewState };
          const local: unknown[] = [{ changes: { from, to, insert: item.insertText } }];
          const here = options.getUri();
          for (const edit of item.additionalEdits) {
            if (edit.uri !== here) {
              // Cross-file import edits go through the host.
              options.post({ type: "intel:apply-local-edits", edits: item.additionalEdits });
              break;
            }
            try {
              local.push({
                changes: {
                  from: lineColToOffset(target.state, edit.range.start.line, edit.range.start.column),
                  to: lineColToOffset(target.state, edit.range.end.line, edit.range.end.column),
                  insert: edit.newText,
                },
              });
            } catch {
              // Skip unmappable edits; the main insert still applies.
            }
          }
          target.dispatch(local.length === 1 ? local[0] : local);
        },
      })),
    };
  }

  // The decorations getter reads the closure: every refresh dispatches
  // `refreshEffect`, which re-renders the plugin with the latest set.
  const overlays = cm.ViewPlugin.fromClass(
    class {},
    { decorations: () => pendingDecorations },
  );

  let pressTimer: ReturnType<typeof setTimeout> | null = null;

  return {
    extensions: {
      completionSource,
      overlays,
      keymap: cm.Prec.highest(
        cm.keymap.of([
          {
            key: "Tab",
            run: () => acceptGhost(),
          },
          {
            key: "Escape",
            run: () => {
              if (ghostText) {
                ghostText = null;
                rebuildDecorations(runtimeState(), options.getVersion());
                runtimeView.dispatch({ effects: refreshEffect.of(options.getVersion()) });
                return true;
              }
              closeTooltip();
              closeSignature();
              return false;
            },
          },
        ]),
      ),
      domEventHandlers: {
        touchstart(event: TouchEvent) {
          if (pressTimer) clearTimeout(pressTimer);
          const touch = event.touches[0];
          if (!touch) return;
          pressTimer = setTimeout(() => {
            try {
              const pos = runtimeView.posAtCoords({ x: touch.clientX, y: touch.clientY });
              if (pos !== null && pos !== undefined) void showHover(pos);
            } catch {
              // Hit-testing must never break touch input.
            }
          }, 500);
        },
        touchend() {
          if (pressTimer) {
            clearTimeout(pressTimer);
            pressTimer = null;
          }
        },
        touchmove() {
          if (pressTimer) {
            clearTimeout(pressTimer);
            pressTimer = null;
          }
        },
      },
    },
    handleUpdate(update) {
      if (update.docChanged) {
        ghostText = null;
        closeTooltip();
        closeSignature();
        rebuildDecorations(update.state, options.getVersion());
        scheduleSignature();
        scheduleDiagnostics();
      } else if (update.selectionSet) {
        scheduleSignature();
      }
    },
    refreshSemanticOverlays,
    showHoverAtCursor() {
      void showHover(runtimeState().selection.main.head);
    },
    acceptGhost,
    dismissOverlays() {
      closeTooltip();
      closeSignature();
      ghostText = null;
    },
    setGhost(text, version) {
      ghostText = text && text.length > 0 ? text : null;
      if (ghostText && ghostHistory[0] !== ghostText) {
        ghostHistory.unshift(ghostText);
        if (ghostHistory.length > 5) ghostHistory.pop();
      }
      ghostIndex = ghostText ? 0 : -1;
      rebuildDecorations(runtimeState(), version);
      runtimeView.dispatch({ effects: refreshEffect.of(version) });
    },
  };
}
