/**
 * Project runner engine — real execution behind the Run section.
 *
 * Pipeline (all against the real on-device backend, never mocked):
 *   1. Ensure `.ajiro` (generate / re-sync from `package.json` via SAF).
 *   2. Start the Linux runtime; provision Node.js via apt when missing.
 *   3. Sync project files SAF → the Linux workspace (skipping dependency,
 *      VCS, and build dirs).
 *   4. `npm install` when the workspace copy has no `node_modules`.
 *   5. Spawn the run command in a dedicated PTY session (`run-<project>`,
 *      independent from the interactive terminal) and stream output.
 *   6. Detect the printed server URL; build the shareable link (LAN IP
 *      preferred, loopback fallback).
 *
 * The PTY session outlives screen unmounts (explicit Stop only); remounts
 * reattach to the live session and rehydrate from the module registry.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import * as LegacyFileSystem from "expo-file-system/legacy";
import * as Network from "expo-network";

import { terminalBridge } from "@/native/TerminalBridge";
import {
  subscribeToTerminalData,
  subscribeToTerminalExit,
} from "@/native/terminalEvents";
import { createExternalFolderService } from "@/core/services/external-folder/external-folder-service";
import { readProjectText } from "@/modules/ide/project-files";
import {
  AJIRO_FILE_NAME,
  parsePackageScripts,
  serializeAjiroConfig,
  syncAjiroConfig,
  type AjiroRunConfig,
} from "@/modules/run/ajiro-config";
import {
  appendCapped,
  buildShareLink,
  detectServerUrl,
  shellQuote,
  stripAnsi,
  type ShareLink,
} from "@/modules/run/run-log";
import { linuxAgentRuntime } from "@/runtime/LinuxAgentRuntime";
import { rootfsManager } from "@/runtime/RootfsManager";
import type { ExternalFolderSession } from "@/core/types/app-state";

export type RunPhase =
  | "idle"
  | "starting"
  | "provisioning"
  | "syncing"
  | "installing"
  | "running"
  | "stopping"
  | "stopped"
  | "error";

export interface ProjectRunState {
  phase: RunPhase;
  lines: string[];
  liveUrl: string | null;
  shareLink: ShareLink | null;
  exitCode: number | null;
  error: string | null;
  statusNote: string | null;
  config: AjiroRunConfig | null;
  scripts: string[];
  notice: string | null;
}

const MAX_CONSOLE_LINES = 3000;
const STOP_GRACE_MS = 2500;
const NODE_CHECK_TIMEOUT_MS = 30_000;
const PROVISION_TIMEOUT_MS = 600_000;
const INSTALL_TIMEOUT_MS = 600_000;

/** Dependency/build dirs never cross into the Linux workspace. */
const SYNC_SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".gradle",
  "build",
  "dist",
  ".expo",
  ".idea",
  ".vscode",
]);
const MAX_SYNC_FILES = 3000;
const MAX_SYNC_FILE_BYTES = 25_000_000;

const initialState: ProjectRunState = {
  phase: "idle",
  lines: [],
  liveUrl: null,
  shareLink: null,
  exitCode: null,
  error: null,
  statusNote: null,
  config: null,
  scripts: [],
  notice: null,
};

interface StoredRun {
  sessionId: string | null;
  state: ProjectRunState;
}

const storedRuns = new Map<string, StoredRun>();

function fileUri(path: string): string {
  return path.startsWith("file://") ? path : `file://${path}`;
}

export function useProjectRun(
  projectId: string | null,
  session: ExternalFolderSession | null,
): {
  state: ProjectRunState;
  supported: boolean;
  start: () => void;
  stop: () => void;
  selectScript: (script: string) => void;
  resync: () => void;
  clearConsole: () => void;
} {
  const supported = terminalBridge.isAvailable;
  const [state, setState] = useState<ProjectRunState>(() => {
    const stored = projectId ? storedRuns.get(projectId) : undefined;
    return stored ? { ...stored.state, lines: [...stored.state.lines] } : { ...initialState };
  });

  const stateRef = useRef(state);
  stateRef.current = state;
  const linesRef = useRef<string[]>([...state.lines]);
  const tailRef = useRef("");
  const partialRef = useRef("");
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busyRef = useRef(false);
  const manualStopRef = useRef(false);
  const startTimeRef = useRef(0);
  const sessionIdRef = useRef<string | null>(
    (projectId && storedRuns.get(projectId)?.sessionId) ?? null,
  );
  const unsubsRef = useRef<(() => void)[]>([]);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const patch = useCallback(
    (update: Partial<ProjectRunState>) => {
      const id = projectIdRef.current;
      setState((current) => {
        const next = { ...current, ...update };
        if (id) {
          const stored = storedRuns.get(id);
          storedRuns.set(id, {
            sessionId: stored?.sessionId ?? sessionIdRef.current,
            state: { ...next, lines: [...next.lines] },
          });
        }
        return next;
      });
    },
    [],
  );

  const flushLines = useCallback(() => {
    flushTimer.current = null;
    const snapshot = [...linesRef.current];
    patch({ lines: snapshot });
  }, [patch]);

  const scheduleFlush = useCallback(() => {
    if (flushTimer.current) return;
    flushTimer.current = setTimeout(flushLines, 120);
  }, [flushLines]);

  const appendOutput = useCallback(
    (chunk: string) => {
      if (!chunk) return;
      const clean = stripAnsi(chunk);
      tailRef.current = (tailRef.current + clean).slice(-4000);
      const text = partialRef.current + clean;
      const parts = text.split("\n");
      partialRef.current = parts.pop() ?? "";
      if (parts.length > 0) {
        linesRef.current = appendCapped(
          linesRef.current,
          parts.join("\n"),
          MAX_CONSOLE_LINES,
        );
        scheduleFlush();
      }
      const id = projectIdRef.current;
      if (id && !stateRef.current.liveUrl) {
        const found = detectServerUrl(tailRef.current);
        if (found?.port != null) {
          const liveUrl = `http://127.0.0.1:${found.port}`;
          Network.getIpAddressAsync()
            .catch(() => null)
            .then((lanIp) => {
              if (projectIdRef.current !== id) return;
              patch({
                liveUrl,
                shareLink: buildShareLink(lanIp, found.port as number),
              });
            });
          patch({ liveUrl });
        }
      }
    },
    [patch, scheduleFlush],
  );

  const detachListeners = useCallback(() => {
    for (const unsubscribe of unsubsRef.current) {
      try {
        unsubscribe();
      } catch {
        // Listener teardown must never break the engine.
      }
    }
    unsubsRef.current = [];
  }, []);

  const attachListeners = useCallback(
    (sessionId: string) => {
      detachListeners();
      unsubsRef.current = [
        subscribeToTerminalData(sessionId, (data) => {
          appendOutput(data);
        }),
        subscribeToTerminalExit(sessionId, (exitCode) => {
          if (flushTimer.current) {
            clearTimeout(flushTimer.current);
            flushTimer.current = null;
          }
          if (partialRef.current) {
            linesRef.current = appendCapped(
              linesRef.current,
              partialRef.current,
              MAX_CONSOLE_LINES,
            );
            partialRef.current = "";
          }
          const snapshot = [...linesRef.current];
          const manual = manualStopRef.current;
          manualStopRef.current = false;
          if (manual || stateRef.current.phase === "stopping") {
            patch({
              lines: snapshot,
              phase: "stopped",
              exitCode,
              statusNote: `Process exited (code ${exitCode}).`,
            });
            return;
          }
          const uptime = Date.now() - startTimeRef.current;
          if (exitCode !== 0 && uptime < 10_000) {
            patch({
              lines: snapshot,
              phase: "error",
              exitCode,
              error: `Process exited with code ${exitCode} seconds after start — see the console above.`,
            });
            return;
          }
          patch({
            lines: snapshot,
            phase: "stopped",
            exitCode,
            statusNote: `Process exited (code ${exitCode}).`,
          });
        }),
      ];
    },
    [appendOutput, detachListeners, patch],
  );

  // Remount: reattach to a live session and rehydrate (never auto-kill).
  useEffect(() => {
    const id = projectIdRef.current;
    const stored = id ? storedRuns.get(id) : undefined;
    if (!stored?.sessionId || stored.state.phase !== "running") return;
    let cancelled = false;
    (async () => {
      try {
        await linuxAgentRuntime.startRuntime();
        if (cancelled) return;
        linuxAgentRuntime.attachTerminal(stored.sessionId as string, 80, 24);
        if (cancelled) return;
        sessionIdRef.current = stored.sessionId;
        attachListeners(stored.sessionId as string);
      } catch {
        if (cancelled) return;
        patch({ phase: "stopped", statusNote: "Previous run is no longer alive." });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Unmount: flush + unsubscribe, but leave the PTY running (explicit Stop).
  useEffect(
    () => () => {
      if (flushTimer.current) {
        clearTimeout(flushTimer.current);
        flushTimer.current = null;
      }
      if (stopTimer.current) {
        clearTimeout(stopTimer.current);
        stopTimer.current = null;
      }
      detachListeners();
    },
    [detachListeners],
  );

  const syncWorkspace = useCallback(
    async (activeSession: ExternalFolderSession, id: string): Promise<string> => {
      const service = createExternalFolderService();
      const root = rootfsManager.getRootfsPath();
      const workDir = `${root}/workspace/run/${id}`;
      await LegacyFileSystem.makeDirectoryAsync(fileUri(workDir), {
        intermediates: true,
      });
      const { Buffer } = await import("buffer");
      let copied = 0;
      let skipped = 0;
      const walk = async (relative: string): Promise<void> => {
        const entries = service.listEntries(activeSession, relative);
        for (const entry of entries) {
          if (SYNC_SKIP_DIRS.has(entry.name)) continue;
          const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
          if (entry.kind === "directory") {
            await LegacyFileSystem.makeDirectoryAsync(
              fileUri(`${workDir}/${childRelative}`),
              { intermediates: true },
            ).catch(() => {});
            await walk(childRelative);
          } else {
            if (copied >= MAX_SYNC_FILES) {
              skipped += 1;
              continue;
            }
            if (entry.size != null && entry.size > MAX_SYNC_FILE_BYTES) {
              skipped += 1;
              continue;
            }
            const { bytes } = await service.readBytesFile(activeSession, childRelative);
            await LegacyFileSystem.writeAsStringAsync(
              fileUri(`${workDir}/${childRelative}`),
              Buffer.from(bytes).toString("base64"),
              { encoding: "base64" },
            );
            copied += 1;
          }
          if (copied + skipped > MAX_SYNC_FILES + 500) break;
        }
      };
      await walk("");
      return `${workDir} (+${copied} files${skipped > 0 ? `, ${skipped} skipped` : ""})`;
    },
    [],
  );

  const ensureAjiro = useCallback(
    async (
      activeSession: ExternalFolderSession,
    ): Promise<{ config: AjiroRunConfig; scripts: string[]; notice: string | null }> => {
      const service = createExternalFolderService();
      const pkg = await readProjectText(activeSession, "package.json");
      if (pkg.status !== "ok") {
        throw new Error(
          "No package.json at the project root — open a Node project to run it.",
        );
      }
      const scripts = parsePackageScripts(pkg.text);
      let existing: string | null = null;
      try {
        const ajiro = await readProjectText(activeSession, AJIRO_FILE_NAME);
        existing = ajiro.status === "ok" ? ajiro.text : null;
      } catch {
        existing = null;
      }
      const result = syncAjiroConfig(existing, pkg.text, scripts);
      if (result.changed) {
        await service.writeTextFile(
          activeSession,
          AJIRO_FILE_NAME,
          serializeAjiroConfig(result.config),
        );
      }
      return {
        config: result.config,
        scripts: Object.keys(scripts),
        notice: result.notice,
      };
    },
    [],
  );

  const start = useCallback(() => {
    const id = projectIdRef.current;
    const activeSession = sessionRef.current;
    if (!id || !activeSession || busyRef.current) return;
    const phase = stateRef.current.phase;
    if (phase === "running" || phase === "starting" || phase === "provisioning" || phase === "syncing" || phase === "installing" || phase === "stopping") {
      return;
    }
    if (!terminalBridge.isAvailable) {
      patch({
        phase: "error",
        error: "Running projects needs the native runtime (Android dev build).",
      });
      return;
    }
    busyRef.current = true;
    manualStopRef.current = false;
    startTimeRef.current = Date.now();
    linesRef.current = [];
    tailRef.current = "";
    partialRef.current = "";
    patch({
      phase: "starting",
      lines: [],
      liveUrl: null,
      shareLink: null,
      exitCode: null,
      error: null,
      statusNote: "Reading package.json…",
      notice: null,
    });

    void (async () => {
      try {
        const ensured = await ensureAjiro(activeSession);
        patch({
          config: ensured.config,
          scripts: ensured.scripts,
          notice: ensured.notice,
        });
        const command = ensured.config.run.command;
        if (!command) {
          throw new Error(
            "No runnable script (dev, start, serve, preview) in package.json — add one, then retry.",
          );
        }
        patch({ statusNote: "Starting Linux runtime…" });
        await linuxAgentRuntime.startRuntime();
        patch({ statusNote: "Checking Node.js…" });
        try {
          await terminalBridge.executeHeadless(
            "node --version && npm --version",
            NODE_CHECK_TIMEOUT_MS,
          );
        } catch {
          patch({
            phase: "provisioning",
            statusNote: "Installing Node.js (first run — may take minutes)…",
          });
          await terminalBridge.executeHeadless(
            "apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs npm",
            PROVISION_TIMEOUT_MS,
          );
          await terminalBridge.executeHeadless(
            "node --version && npm --version",
            NODE_CHECK_TIMEOUT_MS,
          );
        }
        patch({ phase: "syncing", statusNote: "Copying project files…" });
        const workInfo = await syncWorkspace(activeSession, id);
        const workDir = workInfo.split(" (+")[0] as string;
        const nodeModulesInfo = await LegacyFileSystem.getInfoAsync(
          fileUri(`${workDir}/node_modules`),
        );
        if (!nodeModulesInfo.exists) {
          patch({ phase: "installing", statusNote: "Installing dependencies…" });
          await terminalBridge.executeHeadless(
            `cd ${shellQuote(workDir)} && npm install --no-audit --no-fund`,
            INSTALL_TIMEOUT_MS,
          );
        }
        if (sessionIdRef.current) {
          try {
            linuxAgentRuntime.killTerminal(sessionIdRef.current);
          } catch {
            // Stale session ids are harmless.
          }
          detachListeners();
        }
        const sessionId = `run-${id}`;
        sessionIdRef.current = sessionId;
        attachListeners(sessionId);
        const session = linuxAgentRuntime.attachTerminal(sessionId, 80, 24);
        patch({ phase: "running", statusNote: `Running ${command}` });
        session.write(`cd ${shellQuote(workDir)} && ${command}\n`);
      } catch (error) {
        patch({
          phase: "error",
          error: error instanceof Error ? error.message : String(error),
          statusNote: null,
        });
      } finally {
        busyRef.current = false;
      }
    })();
  }, [attachListeners, detachListeners, ensureAjiro, patch, syncWorkspace]);

  const stop = useCallback(() => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    const phase = stateRef.current.phase;
    if (phase !== "running" && phase !== "starting") return;
    manualStopRef.current = true;
    patch({ phase: "stopping", statusNote: "Stopping…" });
    try {
      linuxAgentRuntime.attachTerminal(sessionId, 80, 24).write("\x03");
    } catch {
      // Fall through to kill.
    }
    if (stopTimer.current) clearTimeout(stopTimer.current);
    stopTimer.current = setTimeout(() => {
      try {
        linuxAgentRuntime.killTerminal(sessionId);
      } catch {
        // Already gone.
      }
      if (stateRef.current.phase === "stopping") {
        patch({ phase: "stopped", statusNote: "Stopped." });
      }
    }, STOP_GRACE_MS);
  }, [patch]);

  const selectScript = useCallback(
    (script: string) => {
      const id = projectIdRef.current;
      const activeSession = sessionRef.current;
      if (!id || !activeSession) return;
      const current = stateRef.current;
      const running = current.phase === "running";
      const config: AjiroRunConfig = {
        version: 1,
        run: { script, command: `npm run ${script}` },
      };
      patch({
        config,
        notice: running
          ? `Run script set to "${script}" — applies to the next run.`
          : null,
      });
      const service = createExternalFolderService();
      service
        .writeTextFile(activeSession, AJIRO_FILE_NAME, serializeAjiroConfig(config))
        .catch((error: unknown) => {
          patch({
            notice: null,
            error: error instanceof Error ? error.message : String(error),
          });
        });
    },
    [patch],
  );

  const resync = useCallback(() => {
    const activeSession = sessionRef.current;
    if (!activeSession || busyRef.current) return;
    busyRef.current = true;
    void (async () => {
      try {
        const ensured = await ensureAjiro(activeSession);
        patch({
          config: ensured.config,
          scripts: ensured.scripts,
          notice: ensured.notice ?? "package.json matches .ajiro.",
        });
      } catch (error) {
        patch({
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        busyRef.current = false;
      }
    })();
  }, [ensureAjiro, patch]);

  const clearConsole = useCallback(() => {
    linesRef.current = [];
    tailRef.current = "";
    partialRef.current = "";
    patch({ lines: [] });
  }, [patch]);

  return { state, supported, start, stop, selectScript, resync, clearConsole };
}
