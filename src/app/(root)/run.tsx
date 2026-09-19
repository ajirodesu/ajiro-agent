/**
 * Run section (`/run`): execute the active project and preview it live.
 *
 * Two pages behind a capsule toggle:
 * - Console (default): read-only live output of the run process. This is
 *   NOT a terminal — no input is accepted here; the interactive terminal
 *   (`/terminal`) is a separate feature with its own sessions.
 * - Webview: the running project's served pages in an embedded browser,
 *   with the live shareable link + copy action above it.
 *
 * Execution runs through `useProjectRun` (real PTY session per project,
 * `.ajiro` resolved from `package.json`). All chrome follows the shared
 * system and the active theme.
 */
import { useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import {
  Check,
  ChevronLeft,
  Copy,
  Globe,
  Link2,
  Play,
  RefreshCw,
  Square,
  SquareChevronRight,
} from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";

import { Button } from "@/components/ui/button";
import {
  AppHeader,
  AppTabs,
  CircleIconButton,
  ICON_INNER,
} from "@/components/ui/chrome";
import { withAlpha } from "@/components/ui/chrome-spec";
import { NativeViewUnavailable } from "@/components/ui/native-unavailable";
import { useProjectRun, type RunPhase } from "@/hooks/use-project-run";
import { useTheme } from "@/hooks/use-theme";
import { useIdeWorkspace } from "@/providers/ide-workspace";
import {
  getCatalogSnapshot,
  getExtensionStore,
  getPluginRuntimeBridge,
  subscribeExtensionEvents,
  type InstalledExtensionRecord,
  type PluginPageTab,
} from "@/modules/extensions";
import { pluginScopes } from "@/modules/extensions/scopes";

type RunPage = "console" | "webview";

/**
 * Preview engines: the default WebView plus every installed + enabled
 * store plugin with a live custom page in the webview scope. The choice
 * persists in extension preferences; a missing engine falls back to the
 * default. Selecting a plugin engine opens its custom page (the shared
 * tabbed container), which is the plugin's preview surface.
 */
export type PreviewEngine =
  | { kind: "default" }
  | { kind: "plugin"; pluginId: string; title: string };

function usePreviewEngines(): {
  engines: PreviewEngine[];
  selected: string | null;
  select: (pluginId: string | null) => void;
} {
  const bridge = getPluginRuntimeBridge();
  const [pages, setPages] = useState<PluginPageTab[]>(() =>
    bridge.status().pages,
  );
  const [records, setRecords] = useState<InstalledExtensionRecord[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => bridge.subscribe((status) => setPages(status.pages)), [
    bridge,
  ]);
  useEffect(() => {
    let cancelled = false;
    const refreshRecords = () => {
      getExtensionStore()
        .manager.listInstalled()
        .then((next) => {
          if (!cancelled) setRecords(next);
        })
        .catch(() => {});
    };
    const refreshSelection = () => {
      getExtensionStore()
        .preferences.load()
        .then((preferences) => {
          if (!cancelled) setSelected(preferences.previewEngine);
        })
        .catch(() => {});
    };
    refreshRecords();
    refreshSelection();
    return subscribeExtensionEvents((event) => {
      if (
        event.type === "installed" ||
        event.type === "uninstalled" ||
        event.type === "enabled" ||
        event.type === "disabled" ||
        event.type === "updated" ||
        event.type === "rolled-back"
      ) {
        refreshRecords();
        refreshSelection();
      }
    });
  }, []);

  const engines: PreviewEngine[] = (() => {
    const byId = new Map(records.map((record) => [record.id, record]));
    const catalogById = new Map(
      getCatalogSnapshot().entries.map((entry) => [entry.id, entry]),
    );
    const list: PreviewEngine[] = [{ kind: "default" }];
    for (const page of pages) {
      const record = byId.get(page.pluginId);
      if (
        !record?.enabled ||
        (record.source !== "registry" && record.source !== "bundled")
      ) {
        continue;
      }
      const entry = catalogById.get(page.pluginId);
      if (entry && !pluginScopes(entry).includes("webview")) continue;
      list.push({ kind: "plugin", pluginId: page.pluginId, title: page.title });
    }
    return list;
  })();

  return {
    engines,
    selected:
      selected &&
      engines.some(
        (engine) => engine.kind === "plugin" && engine.pluginId === selected,
      )
        ? selected
        : null,
    select: (pluginId: string | null) => {
      setSelected(pluginId);
      getExtensionStore()
        .preferences.save({ previewEngine: pluginId })
        .catch(() => {});
      if (pluginId) bridge.showPage(pluginId);
    },
  };
}

const PHASE_LABELS: Record<RunPhase, string> = {
  idle: "Idle",
  starting: "Starting",
  provisioning: "Provisioning Node.js",
  syncing: "Syncing files",
  installing: "Installing dependencies",
  running: "Running",
  stopping: "Stopping",
  stopped: "Stopped",
  error: "Error",
};

export default function RunScreen() {
  const router = useRouter();
  const theme = useTheme();
  const ide = useIdeWorkspace();
  const project = ide.activeProject;
  const session = ide.activeSession;
  const run = useProjectRun(project?.id ?? null, session ?? null);
  const { state } = run;
  const [page, setPage] = useState<RunPage>("console");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timeout = setTimeout(() => {
      setCopied(false);
    }, 1500);
    return () => {
      clearTimeout(timeout);
    };
  }, [copied]);

  if (!project || !session) {
    return (
      <SafeAreaView
        className="flex-1 bg-background dark:bg-background-dark"
        edges={["top", "left", "right", "bottom"]}
      >
        <View className="flex-1 px-sp-4" style={{ paddingTop: 56 }}>
          <View className="flex-1 items-center justify-center gap-sp-2 px-sp-6">
            <Text className="text-center font-sans text-base font-medium text-foreground dark:text-foreground-dark">
              No project selected.
            </Text>
            <Text className="text-center font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
              Open or select a project to run it.
            </Text>
            <Button
              onPress={() => {
                router.push("/files");
              }}
              variant="outline"
            >
              Open Files
            </Button>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const running = state.phase === "running";
  const busy =
    state.phase === "starting" ||
    state.phase === "provisioning" ||
    state.phase === "syncing" ||
    state.phase === "installing" ||
    state.phase === "stopping";
  const selectedScript = state.config?.run.script ?? null;

  return (
    <SafeAreaView
      className="flex-1 bg-background dark:bg-background-dark"
      edges={["top", "left", "right", "bottom"]}
    >
      <View className="flex-1 gap-sp-2 px-sp-4" style={{ paddingTop: 12 }}>
        <AppHeader
          left={
            <CircleIconButton
              accessibilityLabel="Back"
              onPress={() => {
                router.back();
              }}
            >
              <ChevronLeft color={theme.text} size={20} strokeWidth={2} />
            </CircleIconButton>
          }
          title="Run"
          subtitle={`${project.displayName} · ${PHASE_LABELS[state.phase]}`}
        />

        {run.supported ? null : (
          <Text className="font-sans text-sm text-destructive dark:text-destructive-dark">
            Running projects needs the native runtime (Android dev build).
          </Text>
        )}
        {state.error ? (
          <Text className="font-sans text-sm text-destructive dark:text-destructive-dark">
            {state.error}
          </Text>
        ) : null}
        {state.notice ? (
          <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
            {state.notice}
          </Text>
        ) : null}

        {state.scripts.length > 0 ? (
          <View className="gap-sp-1">
            <View className="flex-row items-center gap-sp-2">
              <View className="min-w-0 flex-1">
                <AppTabs
                  tabs={state.scripts.map((script) => ({
                    key: script,
                    label: script,
                  }))}
                  activeKey={selectedScript ?? ""}
                  onChange={(key) => {
                    run.selectScript(key);
                  }}
                />
              </View>
              <Pressable
                accessibilityLabel="Re-sync .ajiro with package.json"
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => {
                  run.resync();
                }}
                className="p-sp-1"
              >
                <RefreshCw color={theme.textSecondary} size={16} strokeWidth={2} />
              </Pressable>
            </View>
            <Text className="font-mono text-xs text-muted-foreground dark:text-muted-foreground-dark">
              .ajiro → {state.config?.run.command ?? "no runnable script"}
            </Text>
          </View>
        ) : null}

        <View
          accessibilityRole="adjustable"
          className="flex-row items-center justify-between rounded-full border border-border dark:border-border-dark"
          style={{
            height: 56,
            marginHorizontal: 16,
            paddingHorizontal: 8,
            backgroundColor: theme.backgroundElement,
          }}
        >
          <PageCell
            active={page === "console"}
            label="Console"
            onPress={() => {
              setPage("console");
            }}
          >
            <SquareChevronRight color={theme.text} size={20} strokeWidth={2} />
          </PageCell>
          <Pressable
            accessibilityLabel={running ? "Stop project" : "Run project"}
            accessibilityRole="button"
            onPress={() => {
              if (running) {
                run.stop();
              } else {
                run.start();
              }
            }}
            className="items-center justify-center rounded-full"
            style={{
              width: ICON_INNER,
              height: ICON_INNER,
              backgroundColor: running ? theme.destructive : theme.accent,
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? (
              <ActivityIndicator
                size="small"
                color={
                  running ? theme.destructiveForeground : theme.accentForeground
                }
              />
            ) : running ? (
              <Square
                color={theme.destructiveForeground}
                size={18}
                strokeWidth={2}
              />
            ) : (
              <Play color={theme.accentForeground} size={20} strokeWidth={2} />
            )}
          </Pressable>
          <PageCell
            active={page === "webview"}
            label="Webview"
            onPress={() => {
              setPage("webview");
            }}
          >
            <Globe color={theme.text} size={20} strokeWidth={2} />
          </PageCell>
        </View>

        {page === "console" ? (
          <ConsolePage
            emptyHint={
              state.phase === "idle"
                ? "Press Run to start the project."
                : null
            }
            lines={state.lines}
            statusLine={
              state.statusNote ??
              (state.phase === "running"
                ? `Running ${state.config?.run.command ?? ""}`
                : PHASE_LABELS[state.phase])
            }
          />
        ) : (
          <WebviewPage
            liveUrl={state.liveUrl}
            onCopy={() => {
              if (!state.shareLink) return;
              Clipboard.setStringAsync(state.shareLink.url)
                .then(() => {
                  setCopied(true);
                })
                .catch(() => {});
            }}
            copied={copied}
            running={running}
            shareScope={state.shareLink?.scope ?? null}
            shareUrl={state.shareLink?.url ?? null}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

function PageCell({
  active,
  children,
  label,
  onPress,
}: {
  active: boolean;
  children: React.ReactNode;
  label: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      className="items-center justify-center rounded-full"
      style={{
        width: ICON_INNER,
        height: ICON_INNER,
        backgroundColor: active
          ? withAlpha(theme.accent, 0.25)
          : "transparent",
      }}
    >
      {children}
    </Pressable>
  );
}

function ConsolePage({
  emptyHint,
  lines,
  statusLine,
}: {
  emptyHint: string | null;
  lines: string[];
  statusLine: string;
}) {
  const theme = useTheme();
  const scrollRef = useRef<ScrollView>(null);
  const stickRef = useRef(true);
  const stickToEnd = () => {
    scrollRef.current?.scrollToEnd({ animated: false });
  };
  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    stickRef.current =
      contentOffset.y + layoutMeasurement.height >= contentSize.height - 60;
  };
  return (
    <View className="min-h-0 flex-1 gap-sp-1">
      <Text className="font-mono text-xs text-muted-foreground dark:text-muted-foreground-dark">
        {statusLine}
      </Text>
      <ScrollView
        ref={scrollRef}
        className="min-h-0 flex-1 rounded-ui border border-border dark:border-border-dark"
        style={{ backgroundColor: theme.background }}
        showsVerticalScrollIndicator
        scrollEventThrottle={64}
        onScroll={handleScroll}
        onContentSizeChange={() => {
          if (stickRef.current) stickToEnd();
        }}
        contentContainerClassName="gap-0 p-sp-2"
      >
        {lines.length === 0 ? (
          <Text className="font-mono text-xs text-muted-foreground dark:text-muted-foreground-dark">
            {emptyHint ?? "Waiting for output…"}
          </Text>
        ) : (
          lines.map((line, index) => (
            <Text
              key={`${index}-${line.length}`}
              selectable
              className="font-mono text-xs text-foreground dark:text-foreground-dark"
            >
              {line || " "}
            </Text>
          ))
        )}
      </ScrollView>
    </View>
  );
}

function WebviewPage({
  copied,
  liveUrl,
  onCopy,
  running,
  shareScope,
  shareUrl,
}: {
  copied: boolean;
  liveUrl: string | null;
  onCopy: () => void;
  running: boolean;
  shareScope: "lan" | "local" | null;
  shareUrl: string | null;
}) {
  const theme = useTheme();
  const { engines, selected, select } = usePreviewEngines();
  if (!running || !liveUrl) {
    return (
      <View className="min-h-0 flex-1 items-center justify-center gap-sp-2 px-sp-6">
        <Globe color={theme.textSecondary} size={28} strokeWidth={2} />
        <Text className="text-center font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
          Start the project to preview its live output here.
        </Text>
      </View>
    );
  }
  if (Platform.OS === "web") {
    return (
      <View className="min-h-0 flex-1 justify-center px-sp-6">
        <NativeViewUnavailable
          title="Live preview unavailable"
          detail="The dev server runs on-device. Live app preview needs the Android app build."
        />
      </View>
    );
  }
  return (
    <View className="min-h-0 flex-1 gap-sp-1">
      {engines.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerClassName="gap-sp-1 px-sp-1"
          accessibilityRole="tablist"
          accessibilityLabel="Preview engine"
        >
          <Pressable
            key="__default__"
            accessibilityRole="tab"
            accessibilityState={{ selected: selected === null }}
            accessibilityLabel="Default preview engine"
            onPress={() => select(null)}
            className="rounded-full border px-sp-3 py-sp-1"
            style={{
              backgroundColor:
                selected === null
                  ? withAlpha(theme.accent, 0.16)
                  : "transparent",
              borderColor:
                selected === null ? theme.accent : theme.border,
            }}
          >
            <Text
              numberOfLines={1}
              className="font-sans text-xs text-foreground dark:text-foreground-dark"
              style={selected === null ? { fontWeight: "700" } : undefined}
            >
              Default
            </Text>
          </Pressable>
          {engines
            .filter(
              (engine): engine is Extract<PreviewEngine, { kind: "plugin" }> =>
                engine.kind === "plugin",
            )
            .map((engine) => {
              const active = selected === engine.pluginId;
              return (
                <Pressable
                  key={engine.pluginId}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`${engine.title} preview engine`}
                  onPress={() => select(engine.pluginId)}
                  className="rounded-full border px-sp-3 py-sp-1"
                  style={{
                    backgroundColor: active
                      ? withAlpha(theme.accent, 0.16)
                      : "transparent",
                    borderColor: active ? theme.accent : theme.border,
                  }}
                >
                  <Text
                    numberOfLines={1}
                    className="font-sans text-xs text-foreground dark:text-foreground-dark"
                    style={active ? { fontWeight: "700" } : undefined}
                  >
                    {engine.title}
                  </Text>
                </Pressable>
              );
            })}
        </ScrollView>
      ) : null}
      <View className="flex-row items-center gap-sp-2 rounded-ui border border-border bg-card px-sp-2 py-sp-2 dark:border-border-dark dark:bg-card-dark">
        <Link2 color={theme.textSecondary} size={16} strokeWidth={2} />
        <View className="min-w-0 flex-1">
          <Text
            numberOfLines={1}
            className="font-mono text-xs text-foreground dark:text-foreground-dark"
          >
            {shareUrl ?? liveUrl}
          </Text>
          <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
            {shareScope === "lan"
              ? "Live link — reachable on this network"
              : "Live link — this device only"}
          </Text>
        </View>
        <Pressable
          accessibilityLabel={copied ? "Link copied" : "Copy live link"}
          accessibilityRole="button"
          hitSlop={8}
          onPress={onCopy}
          className="flex-row items-center gap-sp-1 rounded-ui px-sp-2 py-sp-1"
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
        >
          {copied ? (
            <Check color={theme.textSecondary} size={15} />
          ) : (
            <Copy color={theme.textSecondary} size={15} />
          )}
          <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
            {copied ? "Copied" : "Copy"}
          </Text>
        </Pressable>
      </View>
      <View className="min-h-0 flex-1 overflow-hidden rounded-ui border border-border dark:border-border-dark">
        <WebView
          key={liveUrl}
          originWhitelist={["*"]}
          source={{ uri: liveUrl }}
          javaScriptEnabled
          domStorageEnabled
          allowFileAccess={false}
          allowUniversalAccessFromFileURLs={false}
          cacheEnabled={false}
          showsVerticalScrollIndicator={false}
          startInLoadingState
        />
      </View>
    </View>
  );
}
