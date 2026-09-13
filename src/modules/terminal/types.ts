/**
 * Strict terminal contracts (TypeScript only — no native modules).
 *
 * Source provenance: [AJIRO ORIGINAL] shapes follow the harness spec;
 * [OPENCODE] terminal-workflow behavior (sessions, scrollback, history) as
 * publicly observable behavior; VT/ANSI semantics follow publicly documented
 * terminal behavior ([ENGINEERING INFERENCE] where exact compat is stated as
 * compatible rather than identical).
 */
import type { ViewStyle } from "react-native";

export interface TerminalViewProps {
  style?: ViewStyle;
  fontSize: number;
  fontFamily?: string;
  backgroundColor?: string;
  foregroundColor?: string;
}

export interface TerminalViewRef {
  write(data: string): void;
  resize(columns: number, rows: number): void;
  clear(): void;
  /**
   * Scroll a combined scrollback+viewport row into view. Positions are
   * proportional estimates (uniform mono rows); the current-match highlight
   * marks the exact row.
   */
  scrollToLine(lineIndex: number, totalLines: number): void;
}

export interface TerminalDataEvent {
  data: string;
}

export interface TerminalTitleChangedEvent {
  title: string;
}

export type TerminalEvent =
  | {
      type: "data";
      data: string;
    }
  | {
      type: "title";
      title: string;
    }
  | {
      type: "exit";
      code: number;
    }
  | {
      type: "error";
      message: string;
    }
  | {
      type: "resize";
      columns: number;
      rows: number;
    };

export interface TerminalCell {
  codePoint: number;
  foreground: number;
  background: number;
  attributes: number;
}

export interface TerminalStartRequest {
  columns: number;
  rows: number;
  command?: string;
  args?: string[];
}

export interface TerminalProcess {
  id: string;
  write(data: string): Promise<void>;
  resize(columns: number, rows: number): Promise<void>;
  terminate(): Promise<void>;
  onEvent(callback: (event: TerminalEvent) => void): () => void;
}

export interface TerminalProcessAdapter {
  start(request: TerminalStartRequest): Promise<TerminalProcess>;
  write(id: string, data: string): Promise<void>;
  resize(id: string, columns: number, rows: number): Promise<void>;
  terminate(id: string): Promise<void>;
}

/** One rendered run inside a line: text plus resolved colors. */
export interface TerminalLineRun {
  text: string;
  foreground: string | null;
  background: string | null;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  inverse: boolean;
  strikethrough: boolean;
}

export interface TerminalTheme {
  background: string;
  foreground: string;
  cursor: string;
  selection: string;
  palette: string[];
}
