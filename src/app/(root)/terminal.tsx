import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft, Plus, Search, X } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { Container } from "@/components/shared/container";
import { Button } from "@/components/ui/button";
import {
  AppHeader,
  CircleIconButton,
  CONTAINER_BORDER,
} from "@/components/ui/chrome";
import { withAlpha } from "@/components/ui/chrome-spec";
import { useTheme } from "@/hooks/use-theme";
import { useIdeWorkspace } from "@/providers/ide-workspace";
import { linuxAgentRuntime } from "@/runtime/LinuxAgentRuntime";
import type { RootfsInitializationProgress } from "@/runtime/runtimeTypes";
import {
  syncProjectToWorkspace,
  syncWorkspaceToProject,
} from "@/runtime/workspaceSyncAdapters";
import { LinuxTerminal } from "@/terminal/LinuxTerminal";
import type { LinuxTerminalRef } from "@/terminal/terminalTypes";

type Tab = {
  id: string;
  title: string;
};

let nextTabSeq = 1;

function newTabId(): string {
  nextTabSeq += 1;
  return `terminal-tab-${nextTabSeq}-${Date.now().toString(36)}`;
}

const MAX_TABS = 5;

/**
 * Canonical terminal screen: on-device Debian (PRoot + PTY) rendered by the
 * local xterm WebView. This is the SOLE terminal UI — the legacy
 * `TerminalView` + `InProcessAdapter` screen has been replaced.
 *
 * Two modes share the chrome:
 * - transcript: read-only output passed via route params (tool results);
 * - interactive: live PTY tabs backed by `LinuxAgentRuntime`, with font-size
 *   controls and xterm search. All tabs stay mounted so scrollback survives
 *   tab switches; inactive PTYs keep running natively.
 */
export default function TerminalScreen() {
  const theme = useTheme();
  const router = useRouter();
  const ide = useIdeWorkspace();
  const { command, output, pending } = useLocalSearchParams<{
    command?: string;
    output?: string;
    pending?: string;
    taskId?: string;
  }>();
  const commandText = typeof command === "string" ? command : "";
  const transcript = typeof output === "string" ? output : "";
  const transcriptMode = transcript.length > 0 || pending === "true";

  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [fontSize, setFontSize] = useState(14);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchStatus, setSearchStatus] = useState<"idle" | "found" | "not-found">("idle");
  const [runtimeNotice, setRuntimeNotice] = useState<string | null>(null);
  const [runtimeStarting, setRuntimeStarting] = useState(false);
  const terminalRefs = useRef(new Map<string, LinuxTerminalRef | null>());
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ref mirror so tab mutations never nest setState inside updaters.
  const tabsRef = useRef<Tab[]>([]);

  const applyTabs = useCallback((next: Tab[], active: string | null) => {
    tabsRef.current = next;
    setTabs(next);
    setActiveTabId(active);
  }, []);

  const ensureFirstTab = useCallback(() => {
    if (tabsRef.current.length > 0) return;
    const id = newTabId();
    applyTabs([{ id, title: "Term 1" }], id);
  }, [applyTabs]);

  // Boot the canonical runtime once (idempotent; agent headless exec shares it).
  // When a project is active, its SAF files sync into /workspace (background:
  // tabs open immediately, early `ls` may briefly show a syncing tree).
  useEffect(() => {
    if (transcriptMode) return;
    let cancelled = false;
    setRuntimeStarting(true);
    const syncSession = ide.activeSession;
    const unsubscribe = linuxAgentRuntime.onProgress(
      (progress: RootfsInitializationProgress) => {
        if (cancelled) return;
        if (progress.phase === "error") {
          setRuntimeNotice(progress.message ?? "Linux runtime failed to start.");
        }
      },
    );
    linuxAgentRuntime
      .startRuntime()
      .then(() => {
        if (cancelled) return;
        setRuntimeNotice(null);
        ensureFirstTab();
        if (syncSession) {
          setRuntimeNotice("Syncing project files into /workspace…");
          syncProjectToWorkspace(syncSession)
            .then((report) => {
              if (cancelled) return;
              setRuntimeNotice((current) =>
                current === "Syncing project files into /workspace…"
                  ? report.conflicts.length > 0
                    ? `${report.conflicts.length} sync conflict(s) kept project versions.`
                    : null
                  : current,
              );
            })
            .catch((error: unknown) => {
              if (cancelled) return;
              setRuntimeNotice(
                `Project sync failed: ${error instanceof Error ? error.message : String(error)}`,
              );
            });
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setRuntimeNotice(error instanceof Error ? error.message : String(error));
        // Still open a tab so the terminal renders its honest error banner.
        ensureFirstTab();
      })
      .finally(() => {
        if (!cancelled) setRuntimeStarting(false);
      });
    return () => {
      cancelled = true;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transcriptMode]);

  // Best-effort write-back: shell-created/modified files return to the SAF
  // project when leaving the screen. Failures are swallowed here (the files
  // remain intact in /workspace for the next visit).
  const syncSessionRef = useRef(ide.activeSession);
  syncSessionRef.current = ide.activeSession;
  useEffect(
    () => () => {
      const session = syncSessionRef.current;
      if (session && linuxAgentRuntime.isStarted()) {
        syncWorkspaceToProject(session).catch(() => {});
      }
    },
    [],
  );

  const openNewTab = useCallback(() => {
    const current = tabsRef.current;
    if (current.length >= MAX_TABS) return;
    const id = newTabId();
    applyTabs([...current, { id, title: `Term ${current.length + 1}` }], id);
  }, [applyTabs]);

  const closeTab = useCallback(
    (id: string) => {
      linuxAgentRuntime.killTerminal(id);
      terminalRefs.current.delete(id);
      const remaining = tabsRef.current.filter((tab) => tab.id !== id);
      if (remaining.length === 0) {
        const fresh = newTabId();
        applyTabs([{ id: fresh, title: "Term 1" }], fresh);
        return;
      }
      const nextActive =
        activeTabId === id ? (remaining[0]?.id ?? null) : activeTabId;
      applyTabs(
        remaining.map((tab, index) => ({ ...tab, title: `Term ${index + 1}` })),
        nextActive,
      );
    },
    [activeTabId, applyTabs],
  );

  const handleClose = useCallback(() => {
    router.back();
  }, [router]);

  const toggleSearch = useCallback(() => {
    if (searchOpen) {
      const active = activeTabId ? terminalRefs.current.get(activeTabId) : null;
      active?.find("", "clear");
      setSearchStatus("idle");
    }
    setSearchOpen(!searchOpen);
  }, [activeTabId, searchOpen]);

  const postFind = useCallback(
    (direction: "next" | "prev" | "clear") => {
      const active = activeTabId ? terminalRefs.current.get(activeTabId) : null;
      // Search travels through the WebView message channel (addon-search).
      active?.find(searchQuery, direction);
    },
    [activeTabId, searchQuery],
  );

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!searchOpen || !searchQuery.trim()) {
      setSearchStatus("idle");
      return;
    }
    searchTimer.current = setTimeout(() => postFind("next"), 300);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [searchQuery, searchOpen, postFind, activeTabId]);

  return (
    <Container
      className="bg-background dark:bg-background-dark"
      contentClassName="gap-sp-4 py-sp-4"
      contentStyle={{ paddingBottom: 0 }}
      includeBottomTabInset={false}
      safeArea
      edges={["top", "right", "bottom", "left"]}
    >
      <AppHeader
        left={
          <CircleIconButton accessibilityLabel="Back" onPress={handleClose}>
            <ChevronLeft color={theme.text} size={20} strokeWidth={2} />
          </CircleIconButton>
        }
        title="Terminal"
        right={
          !transcriptMode ? (
            <View className="ml-auto flex-row items-center gap-sp-1">
              <CircleIconButton
                accessibilityLabel="Search terminal"
                onPress={toggleSearch}
              >
                <Search color={theme.text} size={18} strokeWidth={2} />
              </CircleIconButton>
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
            </View>
          ) : undefined
        }
      />

      {!transcriptMode ? (
        <View className="flex-row items-center gap-sp-1">
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            className="flex-1"
            contentContainerClassName="gap-sp-1 pr-sp-1"
          >
            {tabs.map((tab) => {
              const selected = tab.id === activeTabId;
              return (
                <View
                  key={tab.id}
                  className="flex-row items-center rounded-full pr-1"
                  style={{
                    borderWidth: selected ? CONTAINER_BORDER : 0,
                    borderColor: selected ? theme.accent : "transparent",
                    backgroundColor: selected
                      ? withAlpha(theme.accent, 0.18)
                      : "transparent",
                  }}
                >
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setActiveTabId(tab.id)}
                    className="px-sp-2 py-1"
                  >
                    <Text
                      className={`font-mono text-sm ${selected ? "text-foreground dark:text-foreground-dark" : "text-muted-foreground dark:text-muted-foreground-dark"}`}
                    >
                      {tab.title}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityLabel={`Close ${tab.title}`}
                    accessibilityRole="button"
                    onPress={() => closeTab(tab.id)}
                    className="px-1 py-1"
                  >
                    <X color={theme.textSecondary} size={12} />
                  </Pressable>
                </View>
              );
            })}
          </ScrollView>
          {tabs.length < MAX_TABS ? (
            <Button
              leftIcon={<Plus color={theme.text} size={14} />}
              onPress={openNewTab}
              size="icon-xs"
              variant="ghost"
            />
          ) : null}
        </View>
      ) : null}

      {searchOpen && !transcriptMode ? (
        <View className="flex-row items-center gap-sp-2">
          <TextInput
            value={searchQuery}
            onChangeText={(text) => {
              setSearchQuery(text);
              setSearchStatus("idle");
            }}
            placeholder="Search output…"
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            className="min-w-0 flex-1 rounded-ui border border-border px-sp-2 py-1 font-mono text-sm text-foreground dark:border-border-dark dark:text-foreground-dark"
          />
          <Text className="font-mono text-xs text-muted-foreground dark:text-muted-foreground-dark">
            {searchStatus === "found" ? "found" : searchStatus === "not-found" ? "no match" : ""}
          </Text>
          <Button onPress={() => postFind("prev")} size="xs" variant="ghost">
            ↑
          </Button>
          <Button onPress={() => postFind("next")} size="xs" variant="ghost">
            ↓
          </Button>
        </View>
      ) : null}

      {runtimeNotice && !transcriptMode ? (
        <View className="rounded-ui border border-border px-sp-2 py-1 dark:border-border-dark">
          <Text className="font-mono text-xs text-muted-foreground dark:text-muted-foreground-dark">
            {runtimeStarting ? "Starting on-device Linux… " : ""}
            {runtimeNotice}
          </Text>
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
        ) : (
          tabs.map((tab) => (
            <View
              key={tab.id}
              className="flex-1 w-full"
              style={{ display: tab.id === activeTabId ? "flex" : "none" }}
            >
              <LinuxTerminal
                ref={(instance) => {
                  if (instance) terminalRefs.current.set(tab.id, instance);
                  else terminalRefs.current.delete(tab.id);
                }}
                sessionId={tab.id}
                autoFocus={tab.id === activeTabId}
                options={{ fontSize }}
                onError={(message) => setRuntimeNotice(message)}
                onFindResult={(found) => setSearchStatus(found ? "found" : "not-found")}
              />
            </View>
          ))
        )}
      </View>
    </Container>
  );
}
