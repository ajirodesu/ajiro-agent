/**
 * Canonical Linux runtime type model.
 *
 * Single source of truth for runtime/rootfs/PRoot/session state across the
 * app. The legacy capability matrix in `src/modules/runtime/device-runtime.ts`
 * is intentionally untouched (existing tests pin its behavior); the new
 * on-device Linux execution path is described here and implemented by
 * `LinuxAgentRuntime`.
 */

export type RootfsPhase =
  | "idle"
  | "checking"
  | "downloading"
  | "extracting"
  | "validating"
  | "ready"
  | "error";

export interface RootfsInitializationProgress {
  phase: RootfsPhase;
  /** 0..1 overall progress within the current phase sequence. */
  progress: number;
  bytesTransferred?: number;
  totalBytes?: number;
  message?: string;
}

export interface RootfsStatus {
  ready: boolean;
  path: string | null;
  phase: RootfsPhase;
  detail: string;
}

export interface ProotLaunchConfig {
  /** Absolute host path of the extracted Debian rootfs. */
  rootfsPath: string;
  /** Guest working directory (always `/workspace`). */
  workDir: string;
  /** Extra guest environment variables (merged over defaults). */
  extraEnv?: Record<string, string>;
}

export interface ProotCommand {
  /** Full host-side argv, starting with the proot binary. */
  argv: string[];
  /** Guest environment for the spawned process. */
  env: Record<string, string>;
}

export type LinuxRuntimeState =
  | "idle"
  | "starting"
  | "ready"
  | "error";

export interface LinuxRuntimeStatus {
  state: LinuxRuntimeState;
  rootfs: RootfsStatus;
  detail: string;
}

export class LinuxRuntimeError extends Error {
  readonly code:
    | "not-started"
    | "rootfs-missing"
    | "rootfs-invalid"
    | "proot-missing"
    | "spawn-failed"
    | "exec-failed"
    | "timeout";
  constructor(code: LinuxRuntimeError["code"], message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "LinuxRuntimeError";
    this.code = code;
  }
}
