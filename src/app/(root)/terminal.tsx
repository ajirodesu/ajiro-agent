import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft, Plus, Search, X } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { Container } from "@/components/shared/container";
import { Button } from "@/components/ui/button";
import { TerminalView } from "@/components/ui/terminal-view";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useConfig } from "@/hooks/use-config";
import { useTheme } from "@/hooks/use-theme";
import {
  PermissionStore,
  policyFromApprovalMode,
} from "@/modules/permissions/engine";
import { useIdeWorkspace } from "@/providers/ide-workspace";
import { TerminalController } from "@/modules/terminal/controller";
import { InProcessAdapter } from "@/modules/terminal/process-adapter";
import {
  nextMatchIndex,
  searchTerminalLines,
  type TerminalSearchMatch,
} from "@/modules/terminal/search";
import type { TerminalSession } from "@/modules/terminal/session";
import type { TerminalViewRef } from "@/modules/terminal/types";

type TabRuntime = {
  adapter: InProcessAdapter;
  processId: string | null;
  unsubscribers: (() => void)[];
};

/**
 * Embedded Ajiro terminal: fully self-contained (React Native + TypeScript,
 * no Termux, no external terminal app, no native terminal modules).
 *
 * Two modes share the screen chrome:
 * - transcript: read-only output passed via route params (opened from a
 *   tool result), same mono presentation as before;
 * - interactive: live local sessions (tabs) backed by the execution broker
 *   (allow-listed commands only, permission-gated), with clear, font size,
 *   and search.
 *
 * Author: AjiroDesu
 */
export default function TerminalScreen() {
  const theme = useTheme();
  const colorScheme = useColorScheme();
  const router = useRouter();
  const { toolApprovalMode } = useConfig();
  const ide = useIdeWorkspace();
  const ideRef = useRef(ide);
  ideRef.current = ide;
  const { command, output, pending } = useLocalSearchParams<{
    command?: string;
    output?: string;
    pending?: string;
    taskId?: string;
  }>();
  const commandText = typeof command === "string" ? command : "";
  const transcript = typeof output === "string" ? output : "";
  const transcriptMode = transcript.length > 0 || pending === "true";

  const storeRef = useRef<PermissionStore | null>(null);
  if (!storeRef.current) storeRef.current = new PermissionStore();

  const controller = useMemo(() => new TerminalController(), []);
  const runtimesRef = useRef(new Map<string, TabRuntime>());
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [tabVersion, setTabVersion] = useState(0);
  const [fontSize, setFontSize] = useState(14);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const [sessionTitle, setSessionTitle] = useState("");
  const approvalRef = useRef(toolApprovalMode);
  approvalRef.current = toolApprovalMode;

  const startProcessFor = useCallback(
    (session: TerminalSession) => {
      const existing = runtimesRef.current.get(session.id);
      if (existing?.processId) return;
      const ideState = ideRef.current;
      const projectSession = ideState.activeSession ?? undefined;
      const project = ideState.activeProject;
      const cwd = project
        ? (ideState.getProjectUiState(project.id).terminalCwd ?? "")
        : "";
      const adapter = new InProcessAdapter({
        policy: policyFromApprovalMode(approvalRef.current),
        permissions: { store: storeRef.current! },
        sessionId: session.id,
        projectSession,
        defaultPath: cwd || undefined,
        onCommandComplete: (command) => {
          if (project) {
            ideState.emit({
              type: "TERMINAL_COMMAND_COMPLETED",
              projectId: project.id,
              command,
            });
          }
        },
      });
      const runtime: TabRuntime = {
        adapter,
        processId: null,
        unsubscribers: [],
      };
      runtimesRef.current.set(session.id, runtime);
      adapter
        .start({ columns: session.columns, rows: session.rows })
        .then((started) => {
          runtime.processId = started.id;
          session.attachProcessWriter((data) =>
            adapter.write(started.id, data),
          );
        session.pushOutput(
          "Ajiro terminal — on-device, allow-listed commands only.\r\n" +
            (project
              ? `Project: ${project.displayName}${cwd ? ` · ${cwd}` : ""}\r\n`
              : "No project active — open one in Files to run checks.\r\n") +
            "Type 'help' to list commands.\r\n",
        );
          runtime.unsubscribers.push(
            session.onEvent((event) => {
              if (event.type === "resize") {
                adapter
                  .resize(started.id, event.columns, event.rows)
                  .catch(() => {});
              }
            }),
            started.onEvent((event) => {
              if (event.type === "data") session.pushOutput(event.data);
              else if (event.type === "exit") session.handleExit(event.code);
              else if (event.type === "error")
                session.handleError(event.message);
            }),
          );
        })
        .catch((error) => {
          session.handleError(
            error instanceof Error ? error.message : String(error),
          );
        });
    },
    [],
  );

  const teardownTab = useCallback((id: string) => {
    const runtime = runtimesRef.current.get(id);
    runtimesRef.current.delete(id);
    if (!runtime) return;
    for (const unsubscribe of runtime.unsubscribers.splice(0)) {
      try {
        unsubscribe();
      } catch {
        // Ignore teardown errors.
      }
    }
    if (runtime.processId) {
      runtime.adapter.terminate(runtime.processId).catch(() => {});
    }
  }, []);

  // First tab on mount (interactive mode only).
  useEffect(() => {
    if (transcriptMode || activeTabId) return;
    const session = controller.create(80, 24);
    controller.setActive(session.id);
    setActiveTabId(session.id);
    startProcessFor(session);
    setTabVersion((version) => version + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transcriptMode]);

  // Tear everything down on unmount.
  useEffect(() => {
    const runtimes = runtimesRef.current;
    return () => {
      for (const id of [...runtimes.keys()]) {
        teardownTab(id);
      }
      controller.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeSession = activeTabId
    ? controller.get(activeTabId)
    : null;

  // Re-render (match counts, tab titles) as the active session streams.
  const [outputTick, setOutputTick] = useState(0);
  useEffect(() => {
    if (!activeSession) return;
    return activeSession.onEvent(() => {
      setOutputTick((tick) => tick + 1);
    });
  }, [activeSession]);

  const openNewTab = () => {
    const session = controller.create(80, 24);
    controller.setActive(session.id);
    setActiveTabId(session.id);
    startProcessFor(session);
    setTabVersion((version) => version + 1);
  };

  const closeTab = (id: string) => {
    const remaining = controller
      .list()
      .map((entry) => entry.id)
      .filter((entryId) => entryId !== id);
    teardownTab(id);
    controller.destroy(id);
    if (remaining.length === 0) {
      const session = controller.create(80, 24);
      controller.setActive(session.id);
      setActiveTabId(session.id);
      startProcessFor(session);
    } else if (activeTabId === id) {
      const next = remaining[0]!;
      controller.setActive(next);
      setActiveTabId(next);
    }
    setTabVersion((version) => version + 1);
  };

  const handleClose = () => {
    for (const id of [...runtimesRef.current.keys()]) {
      teardownTab(id);
    }
    router.back();
  };

  // Search matches over scrollback + viewport text (render order).
  // outputTick/tabVersion are re-render stamps (never negative): reading
  // them subscribes this memo to stream and tab updates.
  const matches = useMemo<TerminalSearchMatch[]>(() => {
    if (outputTick < 0 || tabVersion < 0) return [];
    if (!activeSession || !searchQuery.trim()) return [];
    const snap = activeSession.snapshot();
    const lines = [
      ...snap.scrollback.map((line) => line.text),
      ...snap.lines.map((runs) =>
        runs.map((run) => run.text).join(""),
      ),
    ];
    return searchTerminalLines(lines, searchQuery.trim(), false);
  }, [activeSession, searchQuery, tabVersion, outputTick]);
  const matchCount = matches.length;

  const terminalViewRef = useRef<TerminalViewRef | null>(null);

  const stepMatch = (direction: "next" | "prev") => {
    const next = nextMatchIndex(matches, matchIndex, direction);
    setMatchIndex(next);
    if (next >= 0 && matches[next]) {
      terminalViewRef.current?.scrollToLine(
        matches[next].lineIndex,
        // Total rendered rows: scrollback + viewport.
        (activeSession?.snapshot().scrollback.length ?? 0) +
          (activeSession?.snapshot().lines.length ?? 0),
      );
    }
  };

  useEffect(() => {
    setMatchIndex(0);
  }, [searchQuery, activeTabId]);

  return (
    <Container
      className="bg-background dark:bg-background-dark"
      contentClassName="gap-sp-4 py-sp-4"
      contentStyle={{ paddingBottom: 0 }}
      includeBottomTabInset={false}
      safeArea
      edges={["top", "right", "bottom", "left"]}
    >
      <View className="flex-row items-center gap-sp-2">
        <Button
          leftIcon={<ChevronLeft color={theme.text} size={16} />}
          onPress={handleClose}
          size="icon-xs"
          variant="ghost"
        />
        <Text className="font-sans text-xl font-semibold text-foreground dark:text-foreground-dark">
          {sessionTitle || "Terminal"}
        </Text>
        {!transcriptMode ? (
          <View className="ml-auto flex-row items-center gap-sp-1">
            <Button
              leftIcon={<Search color={theme.text} size={16} />}
              onPress={() => setSearchOpen((open) => !open)}
              size="icon-xs"
              variant="ghost"
            />
            <Button
              onPress={() => setFontSize((size) => Math.max(10, size - 2))}
              size="xs"
              variant="ghost"
            >
              A−
            </Button>
            <Button
              onPress={() => setFontSize((size) => Math.min(22, size + 2))}
              size="xs"
              variant="ghost"
            >
              A+
            </Button>
            <Button
              onPress={() => activeSession?.clear()}
              size="xs"
              variant="ghost"
            >
              Clear
            </Button>
          </View>
        ) : null}
      </View>

      {!transcriptMode ? (
        <View className="flex-row items-center gap-sp-1">
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            className="flex-1"
            contentContainerClassName="gap-sp-1 pr-sp-1"
          >
            {controller.list().map((entry, index) => {
              const selected = entry.id === activeTabId;
              return (
                <View
                  key={entry.id}
                  className={`flex-row items-center rounded-ui pr-1 ${selected ? "bg-secondary dark:bg-secondary-dark" : ""}`}
                >
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      controller.setActive(entry.id);
                      setActiveTabId(entry.id);
                    }}
                    className="px-sp-2 py-1"
                  >
                    <Text
                      className={`font-mono text-sm ${selected ? "text-foreground dark:text-foreground-dark" : "text-muted-foreground dark:text-muted-foreground-dark"}`}
                    >
                      {entry.title && entry.title !== "Terminal"
                        ? entry.title
                        : `Term ${index + 1}`}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityLabel={`Close ${entry.title || "terminal"}`}
                    accessibilityRole="button"
                    onPress={() => closeTab(entry.id)}
                    className="px-1 py-1"
                  >
                    <X color={theme.textSecondary} size={12} />
                  </Pressable>
                </View>
              );
            })}
          </ScrollView>
          <Button
            leftIcon={<Plus color={theme.text} size={14} />}
            onPress={openNewTab}
            size="icon-xs"
            variant="ghost"
          />
        </View>
      ) : null}

      {searchOpen && !transcriptMode ? (
        <View className="flex-row items-center gap-sp-2">
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search output…"
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            className="min-w-0 flex-1 rounded-ui border border-border px-sp-2 py-1 font-mono text-sm text-foreground dark:border-border-dark dark:text-foreground-dark"
          />
          <Text className="font-mono text-xs text-muted-foreground dark:text-muted-foreground-dark">
            {matchCount === 0
              ? "0"
              : `${matchIndex + 1 > matchCount ? matchCount : matchIndex + 1}/${matchCount}`}
          </Text>
          <Button onPress={() => stepMatch("prev")} size="xs" variant="ghost">
            ↑
          </Button>
          <Button onPress={() => stepMatch("next")} size="xs" variant="ghost">
            ↓
          </Button>
        </View>
      ) : null}

      <View className="flex-1 w-full">
        {transcriptMode ? (
          <ScrollView
            className="flex-1"
            contentContainerClassName="gap-sp-1 pb-sp-4"
            showsVerticalScrollIndicator={false}
          >
            <View className="flex-row items-start gap-sp-2">
              <Text className="font-mono text-base text-muted-foreground dark:text-muted-foreground-dark">
                $
              </Text>
              <Text className="min-w-0 flex-1 font-mono text-base text-foreground dark:text-foreground-dark">
                {commandText || "(command)"}
              </Text>
            </View>
            {transcript ? (
              <Text
                selectable
                className="font-mono text-base leading-6 text-foreground dark:text-foreground-dark"
              >
                {transcript}
              </Text>
            ) : null}
            {!transcript && pending === "true" ? (
              <Text className="font-mono text-base text-muted-foreground dark:text-muted-foreground-dark">
                Waiting for output…
              </Text>
            ) : null}
          </ScrollView>
        ) : activeSession ? (
          <TerminalView
            key={activeSession.id}
            ref={terminalViewRef}
            session={activeSession}
            fontSize={fontSize}
            themeMode="dark"
            systemDark={colorScheme !== "light"}
            onTitleChange={setSessionTitle}
            searchQuery={searchQuery}
            currentMatchIndex={matchIndex}
          />
        ) : null}
      </View>
    </Container>
  );
}
