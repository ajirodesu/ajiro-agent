/**
 * @deprecated INTERACTIVE USE REPLACED by `src/runtime/TerminalSession.ts`
 * (`NativeTerminalSession` over the native PTY). This in-process parser
 * session is no longer attached to any production UI. Kept for existing
 * unit tests; do not use in new code.
 *
 * Terminal session: owns one parser + buffer pair, emits typed events,
 * tracks title, and keeps a bounded command history. Rendering pulls
 * snapshots (lines + version); input is encoded to process bytes here so
 * Ctrl/arrow/IME behavior is identical for every adapter.
 */
import { SYSTEM16 } from "@/modules/terminal/attributes";
import { TerminalBuffer } from "@/modules/terminal/buffer";
import { CommandHistory } from "@/modules/terminal/history";
import { AnsiParser } from "@/modules/terminal/parser";
import type {
  TerminalEvent,
  TerminalLineRun,
} from "@/modules/terminal/types";

export type SessionSnapshot = {
  lines: TerminalLineRun[][];
  scrollback: { runs: TerminalLineRun[]; text: string }[];
  cursorX: number;
  cursorY: number;
  cursorVisible: boolean;
  title: string;
  version: number;
};

let nextSessionId = 1;

const ESC = "\x1b";

export class TerminalSession {
  readonly id: string;
  readonly buffer: TerminalBuffer;
  readonly history = new CommandHistory(500);
  readonly createdAt = new Date().toISOString();
  exitCode: number | null = null;

  private readonly parser: AnsiParser;
  private readonly listeners = new Set<(event: TerminalEvent) => void>();
  private title = "";
  private version = 0;
  private processWrite: ((data: string) => Promise<void>) | null = null;
  private echoInput = true;

  constructor(columns: number, rows: number) {
    this.id = `session-${nextSessionId++}-${Date.now().toString(36)}`;
    this.buffer = new TerminalBuffer(columns, rows);
    this.parser = new AnsiParser(this.buffer);
    this.parser.setTitleListener((title) => {
      this.title = title;
      this.emit({ type: "title", title });
      this.bump();
    });
  }

  get columns(): number {
    return this.buffer.cols;
  }

  get rows(): number {
    return this.buffer.rows;
  }

  get sessionTitle(): string {
    return this.title;
  }

  setPalette(palette: string[]): void {
    this.buffer.palette = palette.length >= 16 ? palette : SYSTEM16;
    this.bump();
  }

  attachProcessWriter(writer: ((data: string) => Promise<void>) | null): void {
    this.processWrite = writer;
  }

  setEchoInput(echo: boolean): void {
    this.echoInput = echo;
  }

  onEvent(callback: (event: TerminalEvent) => void): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  private emit(event: TerminalEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        // Listener errors must not break the session.
      }
    }
  }

  private bump(): void {
    this.version += 1;
  }

  /** Feed process output into the parser. */
  pushOutput(data: string): void {
    if (!data) return;
    this.parser.parse(data);
    this.emit({ type: "data", data });
    this.bump();
  }

  handleExit(code: number): void {
    this.exitCode = code;
    this.pushOutput(`\r\n[process exited with code ${code}]\r\n`);
    this.emit({ type: "exit", code });
  }

  handleError(message: string): void {
    this.pushOutput(`\r\n[terminal error: ${message}]\r\n`);
    this.emit({ type: "error", message });
  }

  resize(columns: number, rows: number): void {
    this.buffer.resize(columns, rows);
    this.emit({ type: "resize", columns, rows });
    this.bump();
  }

  clear(): void {
    this.buffer.clear();
    this.bump();
  }

  /**
   * Submit one input line: record history, echo (like a canonical shell),
   * and forward to the attached process with a newline.
   */
  async submitLine(line: string): Promise<void> {
    const cleaned = line.replace(/\r?\n$/, "");
    this.history.push(cleaned);
    if (this.echoInput) {
      this.pushOutput(`${cleaned}\r\n`);
    }
    if (this.processWrite) {
      await this.processWrite(`${cleaned}\n`);
    }
  }

  /** Send raw control bytes (Ctrl+C, Escape, arrows) to the process. */
  async sendControl(kind: "ctrl-c" | "escape" | "tab" | "up" | "down"): Promise<void> {
    const bytes =
      kind === "ctrl-c"
        ? "\x03"
        : kind === "escape"
          ? ESC
          : kind === "tab"
            ? "\t"
            : kind === "up"
              ? `${ESC}[A`
              : `${ESC}[B`;
    if (this.echoInput && (kind === "up" || kind === "down")) {
      const recalled = this.history.navigate(kind === "up" ? "up" : "down", "");
      if (recalled !== null) {
        this.pushOutput(`\r${recalled}`);
      }
      return;
    }
    if (this.processWrite) {
      await this.processWrite(bytes);
    }
  }

  snapshot(): SessionSnapshot {
    return {
      lines: this.buffer.viewportRuns(),
      scrollback: [...this.buffer.scrollback],
      cursorX: this.buffer.cursorX,
      cursorY: this.buffer.cursorY,
      cursorVisible: this.buffer.cursorVisible && this.exitCode === null,
      title: this.title,
      version: this.version,
    };
  }
}
