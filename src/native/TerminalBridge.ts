/**
 * Canonical typed bridge to the native PTY layer.
 *
 * SINGLE SOURCE OF TRUTH for native terminal access. Do not use
 * `NativeModules` / `requireNativeModule` for terminal functionality
 * anywhere else — import the `terminalBridge` singleton from here.
 *
 * - Android: delegates to the `TerminalPty` Expo module (Kotlin + JNI + C++,
 *   openpty/forkpty, PRoot + Debian).
 * - Other platforms / module missing (Expo Go, web, iOS): every method fails
 *   closed with a typed `TerminalBridgeError` instead of crashing, so the UI
 *   can render an honest empty/error state.
 */
import { Platform } from "react-native";

import {
  TERMINAL_PTY_MODULE_NAME,
  type CommandResult,
  type ExtractRootfsResult,
  type NativeTerminalPtyModule,
} from "@/native/nativeTypes";

export interface TerminalBridge {
  readonly isAvailable: boolean;
  spawnSession(id: string, initialCmd: string, cols: number, rows: number): Promise<void>;
  write(id: string, data: string): Promise<void>;
  resize(id: string, cols: number, rows: number): Promise<void>;
  killSession(id: string): Promise<void>;
  executeHeadless(command: string, timeoutMs?: number): Promise<CommandResult>;
  extractRootfs(archivePath: string, destPath: string, stripComponents?: number): Promise<ExtractRootfsResult>;
}

export class TerminalBridgeError extends Error {
  readonly code:
    | "unavailable"
    | "invalid-args"
    | "spawn-failed"
    | "write-failed"
    | "resize-failed"
    | "kill-failed"
    | "exec-failed"
    | "extract-failed";
  constructor(
    code: TerminalBridgeError["code"],
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "TerminalBridgeError";
    this.code = code;
  }
}

function loadNativeModule(): NativeTerminalPtyModule | null {
  if (Platform.OS !== "android") return null;
  try {
    // Lazy require so non-Android bundles never resolve the native module.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { requireNativeModule } = require("expo") as {
      requireNativeModule: <T>(name: string) => T;
    };
    return requireNativeModule<NativeTerminalPtyModule>(TERMINAL_PTY_MODULE_NAME);
  } catch {
    return null;
  }
}

class TerminalBridgeImpl implements TerminalBridge {
  private readonly native: NativeTerminalPtyModule | null = loadNativeModule();

  get isAvailable(): boolean {
    return this.native !== null;
  }

  private ensureAvailable(): NativeTerminalPtyModule {
    if (!this.native) {
      throw new TerminalBridgeError(
        "unavailable",
        Platform.OS === "android"
          ? "On-device Linux terminal is not available (native module TerminalPty is missing). Rebuild the dev client / APK with the terminal-pty module included."
          : `On-device Linux terminal requires Android (current platform: ${Platform.OS}).`,
      );
    }
    return this.native;
  }

  async spawnSession(
    id: string,
    initialCmd: string,
    cols: number,
    rows: number,
  ): Promise<void> {
    if (!id || !initialCmd) {
      throw new TerminalBridgeError("invalid-args", "spawnSession requires a session id and initial command.");
    }
    const safeCols = Math.max(20, Math.min(400, Math.floor(cols) || 80));
    const safeRows = Math.max(5, Math.min(200, Math.floor(rows) || 24));
    try {
      await this.ensureAvailable().spawnSession(id, initialCmd, safeCols, safeRows);
    } catch (error) {
      if (error instanceof TerminalBridgeError) throw error;
      throw new TerminalBridgeError("spawn-failed", `Failed to spawn terminal session "${id}".`, { cause: error });
    }
  }

  async write(id: string, data: string): Promise<void> {
    if (!id || !data) return;
    try {
      await this.ensureAvailable().write(id, data);
    } catch (error) {
      if (error instanceof TerminalBridgeError) throw error;
      throw new TerminalBridgeError("write-failed", `Failed to write to terminal session "${id}".`, { cause: error });
    }
  }

  async resize(id: string, cols: number, rows: number): Promise<void> {
    if (!id) return;
    const safeCols = Math.max(20, Math.min(400, Math.floor(cols) || 80));
    const safeRows = Math.max(5, Math.min(200, Math.floor(rows) || 24));
    try {
      await this.ensureAvailable().resize(id, safeCols, safeRows);
    } catch (error) {
      if (error instanceof TerminalBridgeError) throw error;
      throw new TerminalBridgeError("resize-failed", `Failed to resize terminal session "${id}".`, { cause: error });
    }
  }

  async killSession(id: string): Promise<void> {
    if (!id) return;
    try {
      await this.ensureAvailable().killSession(id);
    } catch (error) {
      if (error instanceof TerminalBridgeError) throw error;
      throw new TerminalBridgeError("kill-failed", `Failed to kill terminal session "${id}".`, { cause: error });
    }
  }

  async executeHeadless(command: string, timeoutMs = 60_000): Promise<CommandResult> {
    if (!command.trim()) {
      return { stdout: "", stderr: "Empty command.", exitCode: 127 };
    }
    try {
      const result = await this.ensureAvailable().executeHeadless(
        command,
        Math.max(1_000, Math.min(300_000, timeoutMs)),
      );
      return {
        stdout: typeof result.stdout === "string" ? result.stdout : "",
        stderr: typeof result.stderr === "string" ? result.stderr : "",
        exitCode: typeof result.exitCode === "number" ? result.exitCode : 127,
      };
    } catch (error) {
      if (error instanceof TerminalBridgeError) throw error;
      throw new TerminalBridgeError("exec-failed", "Headless command execution failed.", { cause: error });
    }
  }

  async extractRootfs(
    archivePath: string,
    destPath: string,
    stripComponents = 0,
  ): Promise<ExtractRootfsResult> {
    if (!archivePath || !destPath) {
      throw new TerminalBridgeError("invalid-args", "extractRootfs requires an archive path and destination.");
    }
    try {
      const result = await this.ensureAvailable().extractRootfs(
        archivePath,
        destPath,
        Math.max(0, Math.floor(stripComponents)),
      );
      return {
        extractedFiles: Number(result.extractedFiles ?? 0),
        extractedDirs: Number(result.extractedDirs ?? 0),
        extractedLinks: Number(result.extractedLinks ?? 0),
        skippedEntries: Number(result.skippedEntries ?? 0),
      };
    } catch (error) {
      if (error instanceof TerminalBridgeError) throw error;
      throw new TerminalBridgeError("extract-failed", "Rootfs extraction failed.", { cause: error });
    }
  }
}

/** Application-wide singleton. */
export const terminalBridge: TerminalBridge = new TerminalBridgeImpl();
