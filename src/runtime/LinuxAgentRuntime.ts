/**
 * Canonical on-device Linux coding-agent runtime.
 *
 * SINGLE SOURCE OF TRUTH for Linux execution. All agent shell execution and
 * all interactive terminal sessions go through this singleton:
 *
 *   Agent → LinuxAgentRuntime → TerminalBridge → native PTY → PRoot → Debian
 *
 * Startup sequence:
 *   1. RootfsManager.initialize()  (idempotent, recoverable)
 *   2. verify /bin/bash + /workspace
 *   3. mark ready; headless exec + PTY attach become available
 *
 * Interactive rendering (xterm/WebView) and headless tool execution share the
 * runtime but never depend on each other: the agent works with no terminal
 * mounted, and the terminal displays a live PTY without owning agent logic.
 */
import { DeviceEventEmitter, Platform } from "react-native";

import { terminalBridge } from "@/native/TerminalBridge";
import { TERMINAL_EXIT_EVENT } from "@/native/nativeTypes";
import { prootManager } from "@/runtime/ProotManager";
import { rootfsManager } from "@/runtime/RootfsManager";
import { NativeTerminalSession, type TerminalSession } from "@/runtime/TerminalSession";
import {
  LinuxRuntimeError,
  type LinuxRuntimeStatus,
  type RootfsInitializationProgress,
} from "@/runtime/runtimeTypes";

export type RuntimeProgressListener = (progress: RootfsInitializationProgress) => void;

const DEFAULT_HEADLESS_TIMEOUT_MS = 60_000;

let nextSessionSeq = 1;

export class LinuxAgentRuntime {
  private started = false;
  private startPromise: Promise<void> | null = null;
  private readonly sessions = new Map<string, NativeTerminalSession>();
  private readonly progressListeners = new Set<RuntimeProgressListener>();
  private exitSubscription: { remove(): void } | null = null;

  onProgress(listener: RuntimeProgressListener): () => void {
    this.progressListeners.add(listener);
    return () => {
      this.progressListeners.delete(listener);
    };
  }

  private emit(progress: RootfsInitializationProgress): void {
    for (const listener of [...this.progressListeners]) {
      try {
        listener(progress);
      } catch {
        // Progress listeners must never break the runtime.
      }
    }
  }

  /** Idempotent startup. Concurrent callers share one in-flight run. */
  async startRuntime(downloadUrl?: string): Promise<void> {
    if (this.started) return;
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.runStart(downloadUrl).finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  private async runStart(downloadUrl?: string): Promise<void> {
    if (Platform.OS !== "android") {
      throw new LinuxRuntimeError(
        "spawn-failed",
        `On-device Linux requires Android (current platform: ${Platform.OS}).`,
      );
    }
    const unsubscribe = rootfsManager.onProgress((progress) => this.emit(progress));
    try {
      await rootfsManager.initialize(downloadUrl ? { url: downloadUrl } : {});
    } finally {
      unsubscribe();
    }
    const ready = await rootfsManager.isReady();
    if (!ready) {
      throw new LinuxRuntimeError(
        "rootfs-missing",
        "Linux runtime cannot start: rootfs is not ready.",
      );
    }
    if (!terminalBridge.isAvailable) {
      throw new LinuxRuntimeError(
        "spawn-failed",
        "Linux runtime cannot start: native TerminalPty module is missing. Rebuild with the terminal-pty module.",
      );
    }
    this.installExitRouting();
    this.started = true;
  }

  status(): Promise<LinuxRuntimeStatus> {
    return (async () => {
      const rootfs = await rootfsManager.status();
      return {
        state: this.started && rootfs.ready ? "ready" : rootfs.phase === "error" ? "error" : "idle",
        rootfs,
        detail:
          this.started && rootfs.ready
            ? "Linux runtime ready."
            : "Linux runtime not started. Call startRuntime() first.",
      } satisfies LinuxRuntimeStatus;
    })();
  }

  isStarted(): boolean {
    return this.started;
  }

  private ensureStarted(): void {
    if (!this.started) {
      throw new LinuxRuntimeError("not-started", "Linux runtime not started. Call startRuntime() first.");
    }
  }

  /**
   * Headless tool execution for the autonomous agent. Independent of any
   * mounted terminal UI. Runs `command` via `bash -lc` inside PRoot's
   * `/workspace` and resolves stdout as a string (stderr/exit-code failures
   * throw a typed error carrying the captured output).
   */
  async runToolCommand(command: string, timeoutMs = DEFAULT_HEADLESS_TIMEOUT_MS): Promise<string> {
    this.ensureStarted();
    const rootfsPath = rootfsManager.getRootfsPath();
    const built = prootManager.buildHeadlessCommand({ rootfsPath, workDir: "/workspace" }, command);
    // The native layer owns argv splicing (proot binary resolution); the
    // guest command is what crosses the bridge.
    void built;
    const result = await terminalBridge.executeHeadless(command, timeoutMs).catch((error) => {
      throw new LinuxRuntimeError("exec-failed", "Agent command failed to execute.", { cause: error });
    });
    if (result.exitCode !== 0) {
      throw new LinuxRuntimeError(
        "exec-failed",
        `Command exited with code ${result.exitCode}${result.stderr ? `: ${result.stderr.slice(0, 500)}` : ""}`,
      );
    }
    return result.stdout;
  }

  /**
   * Attach (or reattach) an interactive terminal session. The returned handle
   * is the canonical `TerminalSession` — write/resize/kill route to the
   * native PTY that runs `proot … /bin/bash --login`.
   */
  attachTerminal(sessionId?: string, cols = 80, rows = 24): TerminalSession {
    this.ensureStarted();
    const id = sessionId ?? `agent-session-${nextSessionSeq++}-${Date.now().toString(36)}`;
    const existing = this.sessions.get(id);
    if (existing && existing.isAlive()) return existing;
    if (existing) this.sessions.delete(id);

    const session = new NativeTerminalSession(id, {
      onExit: () => {
        this.sessions.delete(id);
      },
    });
    this.sessions.set(id, session);
    // Interactive shells always boot to the coding-agent workspace.
    terminalBridge.spawnSession(id, "--login", cols, rows).catch(() => {
      this.sessions.delete(id);
      session.handleNativeExit(127);
    });
    return session;
  }

  /** Detach without killing (used across Activity recreation). */
  detachTerminal(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  killTerminal(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    this.sessions.delete(sessionId);
    session?.kill();
  }

  /** Shut down: kill all sessions, stop exit routing. */
  async shutdown(): Promise<void> {
    for (const [id, session] of [...this.sessions]) {
      this.sessions.delete(id);
      session.kill();
    }
    this.exitSubscription?.remove();
    this.exitSubscription = null;
    this.started = false;
  }

  private installExitRouting(): void {
    if (this.exitSubscription) return;
    this.exitSubscription = DeviceEventEmitter.addListener(
      TERMINAL_EXIT_EVENT,
      (payload: unknown) => {
        if (typeof payload !== "object" || payload === null) return;
        const { sessionId, exitCode } = payload as { sessionId?: unknown; exitCode?: unknown };
        if (typeof sessionId !== "string" || typeof exitCode !== "number") return;
        const session = this.sessions.get(sessionId);
        if (session) {
          this.sessions.delete(sessionId);
          session.handleNativeExit(exitCode);
        }
      },
    );
  }
}

/** Application-wide singleton — the canonical runtime. */
export const linuxAgentRuntime = new LinuxAgentRuntime();
