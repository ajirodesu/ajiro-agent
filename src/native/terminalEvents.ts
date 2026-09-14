/**
 * Typed terminal event bus (RCTDeviceEventEmitter wrapper).
 *
 * The native layer emits raw ANSI/VT bytes as opaque strings — this module
 * never interprets them (interpretation belongs to xterm in the WebView).
 * All subscriptions are filtered by session id so multiple sessions can
 * coexist without cross-talk.
 */
import { DeviceEventEmitter } from "react-native";

import {
  ROOTFS_PROGRESS_EVENT,
  TERMINAL_DATA_EVENT,
  TERMINAL_EXIT_EVENT,
} from "@/native/nativeTypes";

/** Raw PTY output chunk for one session. Preserves ANSI/VT verbatim. */
export interface TerminalDataEvent {
  sessionId: string;
  /** Raw PTY bytes as string (may contain ANSI/VT escape sequences). */
  data: string;
}

/** PTY process exit notification for one session. */
export interface TerminalExitEvent {
  sessionId: string;
  exitCode: number;
}

/** Rootfs extraction progress (compressed-stream bytes, monotonic). */
export interface RootfsProgressEvent {
  bytesTransferred: number;
  totalBytes: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asDataEvent(payload: unknown): TerminalDataEvent | null {
  if (!isRecord(payload)) return null;
  const { sessionId, data } = payload;
  if (typeof sessionId !== "string" || typeof data !== "string") return null;
  return { sessionId, data };
}

function asExitEvent(payload: unknown): TerminalExitEvent | null {
  if (!isRecord(payload)) return null;
  const { sessionId, exitCode } = payload;
  if (typeof sessionId !== "string" || typeof exitCode !== "number") return null;
  return { sessionId, exitCode };
}

/**
 * Subscribe to raw PTY output for a single session.
 * Returns an unsubscribe function. Safe to call during render cleanup.
 */
export function subscribeToTerminalData(
  sessionId: string,
  listener: (data: string) => void,
): () => void {
  const subscription = DeviceEventEmitter.addListener(
    TERMINAL_DATA_EVENT,
    (payload: unknown) => {
      const event = asDataEvent(payload);
      if (event && event.sessionId === sessionId && event.data) {
        listener(event.data);
      }
    },
  );
  return () => subscription.remove();
}

/** Subscribe to PTY exit for a single session. */
export function subscribeToTerminalExit(
  sessionId: string,
  listener: (exitCode: number) => void,
): () => void {
  const subscription = DeviceEventEmitter.addListener(
    TERMINAL_EXIT_EVENT,
    (payload: unknown) => {
      const event = asExitEvent(payload);
      if (event && event.sessionId === sessionId) {
        listener(event.exitCode);
      }
    },
  );
  return () => subscription.remove();
}

/** Subscribe to rootfs extraction progress (global, not per-session). */
export function subscribeToRootfsProgress(
  listener: (progress: RootfsProgressEvent) => void,
): () => void {
  const subscription = DeviceEventEmitter.addListener(
    ROOTFS_PROGRESS_EVENT,
    (payload: unknown) => {
      if (!isRecord(payload)) return;
      const { bytesTransferred, totalBytes } = payload;
      if (
        typeof bytesTransferred !== "number" ||
        typeof totalBytes !== "number"
      ) {
        return;
      }
      listener({ bytesTransferred, totalBytes });
    },
  );
  return () => subscription.remove();
}
