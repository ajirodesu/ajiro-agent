/**
 * Canonical React binding for one interactive Linux PTY session.
 *
 * - Subscribes to `onTerminalData` / `onTerminalExit` filtered by session id.
 * - Forwards PTY output to the caller (which writes it into the WebView —
 *   raw ANSI/VT preserved, never pushed through React state per character).
 * - Cleans up listeners on unmount; never recreates the session for visual
 *   updates (theme changes flow through `TerminalWebView`, not here).
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { terminalBridge } from "@/native/TerminalBridge";
import {
  subscribeToTerminalData,
  subscribeToTerminalExit,
} from "@/native/terminalEvents";
import { linuxAgentRuntime } from "@/runtime/LinuxAgentRuntime";
import type { TerminalDimensions } from "@/terminal/terminalTypes";

export interface UseLinuxTerminalOptions {
  cols?: number;
  rows?: number;
  /** Called with raw PTY chunks (forward into the WebView). */
  onData?: (data: string) => void;
  onExit?: (exitCode: number) => void;
  onError?: (message: string) => void;
}

export interface UseLinuxTerminalResult {
  write: (data: string) => void;
  resize: (dimensions: TerminalDimensions) => void;
  kill: () => void;
  isAlive: boolean;
  bridgeAvailable: boolean;
}

export function useLinuxTerminal(
  sessionId: string,
  options: UseLinuxTerminalOptions = {},
): UseLinuxTerminalResult {
  const { cols = 80, rows = 24, onData, onExit, onError } = options;
  const [isAlive, setIsAlive] = useState(true);
  const callbacksRef = useRef({ onData, onExit, onError });
  callbacksRef.current = { onData, onExit, onError };
  const attachedRef = useRef(false);

  // Attach the native PTY once per session id.
  useEffect(() => {
    if (!sessionId || attachedRef.current) return;
    attachedRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        await linuxAgentRuntime.startRuntime();
        if (cancelled) return;
        linuxAgentRuntime.attachTerminal(sessionId, cols, rows);
      } catch (error) {
        if (cancelled) return;
        setIsAlive(false);
        callbacksRef.current.onError?.(
          error instanceof Error ? error.message : String(error),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
    // Intentionally session-scoped: dims are applied via resize(), the PTY is
    // never respawned for visual updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Route native PTY output/exit to this session only.
  useEffect(() => {
    if (!sessionId) return;
    const unsubscribeData = subscribeToTerminalData(sessionId, (data) => {
      callbacksRef.current.onData?.(data);
    });
    const unsubscribeExit = subscribeToTerminalExit(sessionId, (exitCode) => {
      setIsAlive(false);
      callbacksRef.current.onExit?.(exitCode);
    });
    return () => {
      unsubscribeData();
      unsubscribeExit();
    };
  }, [sessionId]);

  const write = useCallback(
    (data: string) => {
      if (!data) return;
      terminalBridge.write(sessionId, data).catch((error: unknown) => {
        callbacksRef.current.onError?.(
          error instanceof Error ? error.message : String(error),
        );
      });
    },
    [sessionId],
  );

  const resize = useCallback(
    (dimensions: TerminalDimensions) => {
      terminalBridge
        .resize(sessionId, dimensions.cols, dimensions.rows)
        .catch(() => {
          // Resize failures are non-fatal (session keeps old geometry).
        });
    },
    [sessionId],
  );

  const kill = useCallback(() => {
    linuxAgentRuntime.killTerminal(sessionId);
    setIsAlive(false);
  }, [sessionId]);

  // Kill the PTY when the last consumer unmounts (no leaked processes/FDs).
  useEffect(
    () => () => {
      linuxAgentRuntime.killTerminal(sessionId);
    },
    [sessionId],
  );

  return { write, resize, kill, isAlive, bridgeAvailable: terminalBridge.isAvailable };
}
