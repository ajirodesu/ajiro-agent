/**
 * Typed contracts for the canonical native PTY bridge.
 *
 * This is the single source of truth for the shape of the native module
 * (`TerminalPty` Expo module, Android-only). No other file may access the
 * native terminal module directly — always go through `TerminalBridge.ts`.
 */

/** Result of a headless (non-interactive) command execution. */
export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Arguments for spawning an interactive PTY session. */
export interface SpawnSessionArgs {
  /** Client-generated session id (also used as the event routing key). */
  id: string;
  /** Initial command line to run inside PRoot (defaults to login bash). */
  initialCmd: string;
  /** Initial terminal width in columns. */
  cols: number;
  /** Initial terminal height in rows. */
  rows: number;
}

/** Result of a native rootfs archive extraction. */
export interface ExtractRootfsResult {
  extractedFiles: number;
  extractedDirs: number;
  extractedLinks: number;
  skippedEntries: number;
}

/** Raw native module surface (untyped at the platform boundary). */
export interface NativeTerminalPtyModule {
  spawnSession(id: string, initialCmd: string, cols: number, rows: number): Promise<void>;
  write(id: string, data: string): Promise<void>;
  resize(id: string, cols: number, rows: number): Promise<void>;
  killSession(id: string): Promise<void>;
  executeHeadless(cmd: string, timeoutMs?: number): Promise<CommandResult>;
  extractRootfs(archivePath: string, destPath: string, stripComponents?: number): Promise<ExtractRootfsResult>;
  /** Number of live PTY sessions (diagnostics). */
  sessionCount?(): Promise<number>;
}

/** Name under which the native module is registered. */
export const TERMINAL_PTY_MODULE_NAME = "TerminalPty" as const;

/** DeviceEventEmitter event carrying PTY output. */
export const TERMINAL_DATA_EVENT = "onTerminalData" as const;

/** DeviceEventEmitter event carrying PTY exit. */
export const TERMINAL_EXIT_EVENT = "onTerminalExit" as const;

/** DeviceEventEmitter event carrying rootfs extraction progress. */
export const ROOTFS_PROGRESS_EVENT = "onRootfsProgress" as const;
