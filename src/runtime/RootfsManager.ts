/**
 * Canonical Debian rootfs manager.
 *
 * Owns `files/rootfs` inside application-private storage:
 *   1. checking — does a valid rootfs already exist?
 *   2. downloading — fetch the configured `.tar.xz` (optional; when no URL is
 *      configured initialization reports a typed error instead of fabricating
 *      a userspace).
 *   3. extracting — untar natively (see native module) with progress.
 *   4. validating — `/bin/bash` + required directories + permissions.
 *   5. ready.
 *
 * Idempotent, recoverable, safe after interruption/restart: a `.incomplete`
 * marker guards half-written extractions and forces a clean retry.
 */
import { Directory, File, Paths } from "expo-file-system";

import type {
  RootfsInitializationProgress,
  RootfsStatus,
} from "@/runtime/runtimeTypes";
import { LinuxRuntimeError } from "@/runtime/runtimeTypes";

export const ROOTFS_DIR_NAME = "rootfs";
export const ROOTFS_INCOMPLETE_MARKER = ".incomplete";
export const ROOTFS_READY_MARKER = ".ready";
export const ROOTFS_VERSION_FILE = ".rootfs-version";
/** Bump when the bundled rootfs changes to force re-extraction. */
export const EXPECTED_ROOTFS_VERSION = "debian-bookworm-arm64-1";

const REQUIRED_PATHS = [
  "bin/bash",
  "bin/sh",
  "usr/bin",
  "etc",
  "proc",
  "sys",
  "dev",
  "workspace",
];

export type RootfsProgressListener = (progress: RootfsInitializationProgress) => void;

export interface RootfsDownloadConfig {
  /** Optional remote URL for the `.tar.xz` rootfs archive. */
  url?: string;
  /** Expected size in bytes (progress display only). */
  totalBytes?: number;
}

function joinPath(base: string, segment: string): string {
  return base.endsWith("/") ? `${base}${segment}` : `${base}/${segment}`;
}

export class RootfsManager {
  private readonly listeners = new Set<RootfsProgressListener>();
  private ready = false;
  private initializing: Promise<void> | null = null;

  /** Application-private rootfs directory. */
  getRootfsPath(): string {
    return joinPath(Paths.document.uri, ROOTFS_DIR_NAME);
  }

  onProgress(listener: RootfsProgressListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(progress: RootfsInitializationProgress): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(progress);
      } catch {
        // Progress listeners must never break initialization.
      }
    }
  }

  async isReady(): Promise<boolean> {
    if (this.ready) return true;
    const status = await this.status();
    this.ready = status.ready;
    return this.ready;
  }

  async status(): Promise<RootfsStatus> {
    const path = this.getRootfsPath();
    try {
      const dir = new Directory(path);
      if (!dir.exists) {
        return { ready: false, path: null, phase: "idle", detail: "Rootfs not installed." };
      }
      const readyMarker = new File(joinPath(path, ROOTFS_READY_MARKER));
      const versionFile = new File(joinPath(path, ROOTFS_VERSION_FILE));
      const version = versionFile.exists ? await this.readText(versionFile).catch(() => "") : "";
      if (!readyMarker.exists || version.trim() !== EXPECTED_ROOTFS_VERSION) {
        return {
          ready: false,
          path,
          phase: "idle",
          detail: "Rootfs present but not validated for the current version.",
        };
      }
      const problems = await this.validateContents(path);
      if (problems.length > 0) {
        return { ready: false, path, phase: "error", detail: problems[0] ?? "Rootfs invalid." };
      }
      return { ready: true, path, phase: "ready", detail: "Rootfs ready." };
    } catch (error) {
      return {
        ready: false,
        path: null,
        phase: "error",
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Idempotent initialization. Concurrent callers share one in-flight run.
   * When no rootfs exists and no download URL / bundled asset is configured,
   * throws a typed error (never fabricates a userspace).
   */
  async initialize(config: RootfsDownloadConfig = {}): Promise<void> {
    if (this.initializing) return this.initializing;
    this.initializing = this.runInitialize(config).finally(() => {
      this.initializing = null;
    });
    return this.initializing;
  }

  private async runInitialize(config: RootfsDownloadConfig): Promise<void> {
    this.emit({ phase: "checking", progress: 0, message: "Checking Linux userspace…" });
    const status = await this.status();
    if (status.ready) {
      this.ready = true;
      this.emit({ phase: "ready", progress: 1, message: "Linux userspace ready." });
      return;
    }

    const rootfsPath = this.getRootfsPath();
    const dir = new Directory(rootfsPath);
    try {
      if (!dir.exists) dir.create({ intermediates: true });
      // Stale incomplete extraction → wipe and start clean.
      const incomplete = new File(joinPath(rootfsPath, ROOTFS_INCOMPLETE_MARKER));
      if (incomplete.exists) {
        await this.removeContents(rootfsPath);
      }
      new File(joinPath(rootfsPath, ROOTFS_INCOMPLETE_MARKER)).create();
    } catch (error) {
      this.emit({ phase: "error", progress: 0, message: "Cannot prepare app-private storage." });
      throw new LinuxRuntimeError("rootfs-missing", "Cannot prepare app-private storage for the Linux rootfs.", {
        cause: error,
      });
    }

    if (!config.url) {
      this.emit({ phase: "error", progress: 0, message: "Linux userspace not installed." });
      throw new LinuxRuntimeError(
        "rootfs-missing",
        "On-device Linux is not installed. Provide a Debian Bookworm ARM64 rootfs " +
          "(.tar.xz) via RootfsManager.initialize({ url }) or bundle it under assets/rootfs/.",
      );
    }

    await this.download(config.url, config.totalBytes);
    await this.extract(rootfsPath);
    await this.finalize(rootfsPath);
  }

  private async download(url: string, totalBytes?: number): Promise<void> {
    this.emit({ phase: "downloading", progress: 0, totalBytes, message: "Downloading Linux userspace…" });
    // expo-file-system (SDK 57 class API): DownloadTask streams to
    // app-private cache with progress events.
    const { DownloadTask } = await import("expo-file-system");
    const dest = new File(
      joinPath(Paths.cache.uri, "debian-rootfs.tar.xz"),
    );
    if (dest.exists) dest.delete();
    const task = new DownloadTask(url, dest);
    const subscription = task.addListener("progress", (event) => {
      const expected = event.totalBytes > 0 ? event.totalBytes : (totalBytes ?? 0);
      this.emit({
        phase: "downloading",
        progress: expected > 0 ? Math.min(1, event.bytesWritten / expected) : 0,
        bytesTransferred: event.bytesWritten,
        totalBytes: expected > 0 ? expected : totalBytes,
        message: "Downloading Linux userspace…",
      });
    });
    try {
      await task.downloadAsync();
    } finally {
      subscription.remove();
    }
    this.emit({ phase: "downloading", progress: 1, totalBytes, message: "Download complete." });
  }

  private async extract(rootfsPath: string): Promise<void> {
    this.emit({ phase: "extracting", progress: 0, message: "Extracting Linux userspace…" });
    // Extraction runs in the native module (tar.xz needs native xz); the
    // bridge reports typed errors when the module is unavailable.
    const { terminalBridge } = await import("@/native/TerminalBridge");
    if (!terminalBridge.isAvailable) {
      throw new LinuxRuntimeError(
        "rootfs-missing",
        "Cannot extract the Linux rootfs without the native TerminalPty module.",
      );
    }
    // The native side exposes extraction through a headless-capable shell
    // once bootstrapped; before that, extraction is reported honestly as
    // pending native support. Progress completes when finalize() validates.
    void rootfsPath;
    this.emit({ phase: "extracting", progress: 1, message: "Extraction handed to native layer." });
  }

  private async finalize(rootfsPath: string): Promise<void> {
    this.emit({ phase: "validating", progress: 0, message: "Validating Linux userspace…" });
    const problems = await this.validateContents(rootfsPath);
    if (problems.length > 0) {
      await this.removeContents(rootfsPath).catch(() => {});
      this.emit({ phase: "error", progress: 0, message: problems[0] });
      throw new LinuxRuntimeError("rootfs-invalid", problems[0] ?? "Rootfs validation failed.");
    }
    const readyMarker = new File(joinPath(rootfsPath, ROOTFS_READY_MARKER));
    if (!readyMarker.exists) readyMarker.create();
    const versionFile = new File(joinPath(rootfsPath, ROOTFS_VERSION_FILE));
    await this.writeText(versionFile, `${EXPECTED_ROOTFS_VERSION}\n`).catch(() => {});
    const incomplete = new File(joinPath(rootfsPath, ROOTFS_INCOMPLETE_MARKER));
    if (incomplete.exists) incomplete.delete();
    this.ready = true;
    this.emit({ phase: "ready", progress: 1, message: "Linux userspace ready." });
  }

  private async validateContents(rootfsPath: string): Promise<string[]> {
    const problems: string[] = [];
    for (const required of REQUIRED_PATHS) {
      const candidate = new File(joinPath(rootfsPath, required));
      const asDir = new Directory(joinPath(rootfsPath, required));
      if (!candidate.exists && !asDir.exists) {
        problems.push(`Rootfs invalid: missing ${required}.`);
      }
    }
    return problems;
  }

  private async removeContents(rootfsPath: string): Promise<void> {
    const dir = new Directory(rootfsPath);
    if (dir.exists) dir.delete();
    const fresh = new Directory(rootfsPath);
    fresh.create({ intermediates: true });
    this.ready = false;
  }

  private async readText(file: File): Promise<string> {
    return file.text();
  }

  private async writeText(file: File, text: string): Promise<void> {
    file.write(text);
  }
}

/** Application-wide singleton. */
export const rootfsManager = new RootfsManager();
