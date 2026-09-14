/**
 * Canonical terminal UI type model (TypeScript only).
 *
 * Adapted from the Acode terminal UI behavior
 * (`src/components/terminal/`: defaults, touch scrolling, touch selection,
 * theme management) translated to React Native + `react-native-webview` +
 * local `@xterm/xterm`. Acode's runtime/backend files are deliberately NOT
 * used — execution stays on `LinuxAgentRuntime → TerminalBridge → PTY →
 * PRoot → Debian`.
 */

export interface TerminalDimensions {
  cols: number;
  rows: number;
}

/** Cursor presentation (Acode `cursorStyle` subset supported by xterm). */
export type TerminalCursorStyle = "block" | "bar" | "underline";

/** Messages flowing RN → WebView (posted as JSON). */
export type TerminalWebViewInbound =
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "focus" }
  | { type: "blur" }
  | { type: "clear" }
  /** xterm `ITheme` shape (see `toXtermTheme`). Applied live, no reload. */
  | { type: "theme"; theme: Record<string, string> }
  | { type: "find"; query: string; direction: "next" | "prev" | "clear" }
  | { type: "options"; options: Partial<TerminalOptions> };

/** Messages flowing WebView → RN (posted as JSON). */
export type TerminalWebViewMessage =
  | { type: "ready" }
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "focus" }
  | { type: "blur" }
  | { type: "selection"; text: string }
  | { type: "findResult"; found: boolean }
  | { type: "error"; message: string };

/** Full 16-color ANSI palette + chrome colors for xterm. */
export interface TerminalTheme {
  background: string;
  foreground: string;
  cursor?: string;
  cursorAccent?: string;
  selectionBackground?: string;
  selectionForeground?: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

/**
 * Terminal options. Defaults mirror Acode `terminalDefaults.js`
 * (`DEFAULT_TERMINAL_SETTINGS`), adjusted for a phone viewport.
 */
export interface TerminalOptions {
  fontSize: number;
  fontFamily: string;
  fontWeight: "normal" | "bold";
  /** Best-effort: xterm renders per-cell; true ligatures unsupported. */
  fontLigatures: boolean;
  letterSpacing: number;
  lineHeight: number;
  cursorBlink: boolean;
  cursorStyle: TerminalCursorStyle;
  scrollback: number;
  showScrollbar: boolean;
  tabStopWidth: number;
  convertEol: boolean;
  /** Long-press duration (ms) that starts touch selection. */
  touchSelectionTapHoldDuration: number;
  touchSelectionHapticFeedback: boolean;
}

export interface LinuxTerminalProps {
  sessionId: string;
  autoFocus?: boolean;
  showToolbar?: boolean;
  options?: Partial<TerminalOptions>;
  onReady?: (dimensions: TerminalDimensions) => void;
  onResize?: (dimensions: TerminalDimensions) => void;
  onError?: (message: string) => void;
  onFindResult?: (found: boolean) => void;
}

export interface LinuxTerminalRef {
  focus(): void;
  blur(): void;
  clear(): void;
  paste(text: string): void;
  find(query: string, direction: "next" | "prev" | "clear"): void;
}
