/**
 * Canonical terminal session abstraction.
 *
 * This is the ONLY terminal session API production code may use. It is a thin
 * typed handle over one native PTY session owned by `LinuxAgentRuntime`:
 * rendering lives in xterm (WebView), execution lives in the native PTY —
 * this class owns neither, it only routes.
 *
 * Lifecycle: created by `LinuxAgentRuntime.attachTerminal()`, killed via
 * `kill()` (idempotent). Theme changes, resizes, and reattachments never
 * recreate the underlying PTY unless it has exited.
 */
import { terminalBridge } from "@/native/TerminalBridge";

export interface TerminalSession {
  readonly id: string;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  isAlive(): boolean;
}

export interface TerminalSessionEvents {
  onExit?: (exitCode: number) => void;
}

export class NativeTerminalSession implements TerminalSession {
  readonly id: string;
  private alive = true;
  private readonly events: TerminalSessionEvents;

  constructor(id: string, events: TerminalSessionEvents = {}) {
    this.id = id;
    this.events = events;
  }

  /** Fire-and-forget write; errors mark the session dead and notify. */
  write(data: string): void {
    if (!this.alive || !data) return;
    terminalBridge.write(this.id, data).catch(() => {
      this.markDead(127);
    });
  }

  resize(cols: number, rows: number): void {
    if (!this.alive) return;
    terminalBridge.resize(this.id, cols, rows).catch(() => {});
  }

  kill(): void {
    if (!this.alive) return;
    this.alive = false;
    terminalBridge.killSession(this.id).catch(() => {});
  }

  isAlive(): boolean {
    return this.alive;
  }

  /** Called by the runtime when the native layer reports process exit. */
  handleNativeExit(exitCode: number): void {
    this.markDead(exitCode);
  }

  private markDead(exitCode: number): void {
    if (!this.alive) return;
    this.alive = false;
    try {
      this.events.onExit?.(exitCode);
    } catch {
      // Listener errors must not break session teardown.
    }
  }
}
