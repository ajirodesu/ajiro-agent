/**
 * Runtime-neutral process adapter + the in-process implementation.
 *
 * Every command passes Permission Engine -> Execution Broker ->
 * android_local. There is no shell: input lines map to either built-in
 * commands (help/echo/clear/history) or allow-listed exec checks via
 * `run <command-id> [path]`. Anything else fails closed with exit 127 and
 * an honest message — never a fabricated shell.
 *
 * Source provenance: [AJIRO ORIGINAL] adapter + builtins; [OPENCODE]
 * terminal workflow (bounded history, exit status) as observable behavior.
 */
import type { ExternalFolderSession } from "@/core/types/app-state";
import {
  evaluatePermission,
  type EvaluationContext,
  type PermissionPolicy,
} from "@/modules/permissions/engine";
import { executePrivileged } from "@/modules/runtime/execution-broker";
import { EXEC_COMMAND_IDS } from "@/modules/tools/coding/exec-commands";
import type {
  TerminalEvent,
  TerminalProcess,
  TerminalProcessAdapter,
  TerminalStartRequest,
} from "@/modules/terminal/types";

export type InProcessAdapterDeps = {
  policy: PermissionPolicy;
  permissions: EvaluationContext;
  agentId?: string;
  sessionId?: string;
  projectSession?: ExternalFolderSession;
  /** Default relative path for `run` when none is given (terminal cwd). */
  defaultPath?: string;
  /** Fires after each completed command line (IDE refresh hook). */
  onCommandComplete?: (command: string) => void;
};

type Listener = (event: TerminalEvent) => void;

class InProcess implements TerminalProcess {
  readonly id: string;
  private readonly listeners = new Set<Listener>();
  private readonly deps: InProcessAdapterDeps;
  private columns: number;
  private rows: number;
  private terminated = false;

  constructor(id: string, request: TerminalStartRequest, deps: InProcessAdapterDeps) {
    this.id = id;
    this.columns = request.columns;
    this.rows = request.rows;
    this.deps = deps;
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
        // Listener errors must not break the process.
      }
    }
  }

  private print(text: string): void {
    this.emit({ type: "data", data: text });
  }

  private exit(code: number): void {
    this.emit({ type: "exit", code });
  }

  async write(data: string): Promise<void> {
    if (this.terminated) return;
    // Lines arrive newline-terminated from the session; control bytes
    // (arrows etc.) have no line discipline here and are acknowledged.
    const lines = data.split("\n");
    for (const raw of lines) {
      const line = raw.replace(/\r$/, "");
      if (!line.trim()) continue;
      const done = await this.runLine(line.trim());
      try {
        this.deps.onCommandComplete?.(line.trim().split(/\s+/)[0] ?? "");
      } catch {
        // Completion hooks must not break the session.
      }
      if (done) return;
    }
  }

  private async runLine(line: string): Promise<boolean> {
    const [head, ...rest] = line.split(/\s+/);
    const command = (head ?? "").toLowerCase();
    switch (command) {
      case "help":
        this.print(
          "Ajiro terminal (self-contained, on-device).\r\n" +
            "Built-ins: help, echo <text>, clear, history, exit\r\n" +
            "Checks: run <command-id> [path]  (typecheck-js, lint-js, grep-count, file-stats, git-status)\r\n" +
            "There is no general shell on stock Android; commands are allow-listed, never shell strings.\r\n",
        );
        return false;
      case "echo":
        this.print(`${rest.join(" ")}\r\n`);
        return false;
      case "clear":
        this.print("\x1b[2J\x1b[H");
        return false;
      case "history":
        this.print("(history is shown per session in the terminal UI)\r\n");
        return false;
      case "exit":
        this.terminated = true;
        this.exit(0);
        return true;
      case "run": {
        await this.runCheck(rest[0] ?? "", rest.slice(1).join(" ") || undefined);
        return false;
      }
      default:
        this.print(
          `'${command}': not available on this device (exit 127). ` +
            `Type 'help' for the allow-listed commands.\r\n`,
        );
        return false;
    }
  }

  private async runCheck(commandId: string, path?: string): Promise<void> {
    if (!EXEC_COMMAND_IDS.includes(commandId as never)) {
      this.print(
        `Unknown check '${commandId}'. Available: ${EXEC_COMMAND_IDS.join(", ")}\r\n`,
      );
      return;
    }
    const action = {
      id: `terminal:run:${commandId}`,
      actionClass: "safe" as const,
      description: `Terminal check ${commandId}`,
      command: commandId,
    };
    const precheck = evaluatePermission(this.deps.policy, action, this.deps.permissions);
    if (precheck === "deny" || precheck === "ask") {
      this.print(
        `Check '${commandId}' needs approval first (permission: ${precheck}). ` +
          `Approve terminal checks in the agent approval UI, then retry.\r\n`,
      );
      return;
    }
    const result = await executePrivileged({
      action,
      operation: "exec.check",
      policy: this.deps.policy,
      permissions: this.deps.permissions,
      agentId: this.deps.agentId,
      sessionId: this.deps.sessionId,
      projectSession: this.deps.projectSession,
      execInput: { commandId, path: path ?? this.deps.defaultPath },
    });
    if (result.output) this.print(`${result.output}\r\n`);
    if (result.error) this.print(`[error] ${result.error}\r\n`);
  }

  async resize(columns: number, rows: number): Promise<void> {
    this.columns = columns;
    this.rows = rows;
    void this.columns;
    void this.rows;
  }

  async terminate(): Promise<void> {
    if (this.terminated) return;
    this.terminated = true;
    this.exit(0);
  }
}

export class InProcessAdapter implements TerminalProcessAdapter {
  private readonly deps: InProcessAdapterDeps;
  private readonly processes = new Map<string, InProcess>();
  private nextId = 1;

  constructor(deps: InProcessAdapterDeps) {
    this.deps = deps;
  }

  async start(request: TerminalStartRequest): Promise<TerminalProcess> {
    const process = new InProcess(`local-${this.nextId++}`, request, this.deps);
    this.processes.set(process.id, process);
    return process;
  }

  async write(id: string, data: string): Promise<void> {
    await this.processes.get(id)?.write(data);
  }

  async resize(id: string, columns: number, rows: number): Promise<void> {
    await this.processes.get(id)?.resize(columns, rows);
  }

  async terminate(id: string): Promise<void> {
    const process = this.processes.get(id);
    if (process) {
      await process.terminate();
      this.processes.delete(id);
    }
  }
}
