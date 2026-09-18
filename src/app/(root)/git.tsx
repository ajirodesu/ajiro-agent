import { useFocusEffect, useRouter } from "expo-router";
import {
  BookMarked,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Download,
  ExternalLink,
  GitBranch,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
  Settings,
  Upload,
  User,
} from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/ui/button";
import { AppHeader, CircleIconButton, HeaderShadow } from "@/components/ui/chrome";
import { withAlpha } from "@/components/ui/chrome-spec";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { FileTypeIcon } from "@/file-icons/FileTypeIcon";
import { useTheme } from "@/hooks/use-theme";
import { secureSecretStore } from "@/core/services/secrets";
import { useIdeWorkspace } from "@/providers/ide-workspace";
import type { ConflictFile } from "@/modules/ide/git-conflicts";
import {
  formatRelativeTime,
  parseRemoteRepo,
} from "@/modules/ide/git-display";

type DiffView = { path: string; staged: boolean; text: string } | null;

export default function GitScreen() {
  const router = useRouter();
  const theme = useTheme();
  const ide = useIdeWorkspace();

  const project = ide.activeProject;
  const session = ide.activeSession;
  const [status, setStatus] = useState<import("@/modules/ide/git-ops").GitStatusSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diff, setDiff] = useState<DiffView>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [commitDescription, setCommitDescription] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [branches, setBranches] = useState<{
    current: string | null;
    local: string[];
    remote: string[];
  } | null>(null);
  const [history, setHistory] = useState<
    import("@/modules/ide/git-ops").GitCommitInfo[]
  >([]);
  const [conflicts, setConflicts] = useState<ConflictFile[]>([]);
  const [branchModal, setBranchModal] = useState(false);
  const [branchDrawer, setBranchDrawer] = useState(false);
  const [messageCollapsed, setMessageCollapsed] = useState(false);
  const [reviewExpanded, setReviewExpanded] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);
  const [newBranch, setNewBranch] = useState("");
  const [remoteUrl, setRemoteUrl] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!session || !project) return;
    setLoading(true);
    setError(null);
    try {
      const ops = await import("@/modules/ide/git-ops");
      const summary = await ops.getStatus(session);
      setStatus(summary);
      const [branchInfo, log, conflictList, remote] = await Promise.all([
        ops.listBranches(session).catch(() => null),
        ops.getHistory(session, 30).catch(() => []),
        ops.findConflicts(session).catch(() => []),
        ops.getRemoteUrl(session).catch(() => null),
      ]);
      setBranches(branchInfo);
      setHistory(log);
      setConflicts(conflictList);
      setRemoteUrl(remote);
      if (conflictList.length > 0) {
        ide.emit({
          type: "GIT_CONFLICT",
          projectId: project.id,
          paths: conflictList.map((entry) => entry.path),
        });
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.uri, project?.id]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  useEffect(() => {
    if (!project) return;
    return ide.subscribe((event) => {
      if (event.type.startsWith("GIT_") || event.type.startsWith("FILE_")) {
        void refresh();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  const fail = (error: unknown) => {
    setError(error instanceof Error ? error.message : String(error));
  };

  const openDiff = async (path: string, staged: boolean) => {
    if (!session || !project) return;
    setDiff({ path, staged, text: "" });
    setDiffLoading(true);
    try {
      const { getDiff } = await import("@/modules/ide/git-ops");
      const text = await getDiff(session, path, staged);
      setDiff({ path, staged, text });
    } catch (error) {
      fail(error);
      setDiff(null);
    } finally {
      setDiffLoading(false);
    }
  };

  const withBusy = async (key: string, action: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (error) {
      fail(error);
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const authed = async () => {
    if (!remoteUrl) return undefined;
    try {
      const host = new URL(remoteUrl).hostname.toLowerCase();
      const token =
        (await secureSecretStore.getProviderApiKey(`git:${host}`)) ?? undefined;
      return token ? { token } : undefined;
    } catch {
      return undefined;
    }
  };

  const stageAll = () =>
    withBusy("stage", async () => {
      if (!session || !project) return;
      const { stageAll } = await import("@/modules/ide/git-ops");
      await stageAll(session);
      ide.emit({ type: "GIT_STATUS_CHANGED", projectId: project.id });
    });

  const stageOne = (path: string) =>
    withBusy("stage", async () => {
      if (!session || !project) return;
      const { stagePaths } = await import("@/modules/ide/git-ops");
      await stagePaths(session, [path]);
      ide.emit({ type: "GIT_STATUS_CHANGED", projectId: project.id });
    });

  const unstageOne = (path: string) =>
    withBusy("stage", async () => {
      if (!session || !project) return;
      const { unstagePaths } = await import("@/modules/ide/git-ops");
      await unstagePaths(session, [path]);
      ide.emit({ type: "GIT_STATUS_CHANGED", projectId: project.id });
    });

  const discardOne = (path: string) =>
    withBusy("discard", async () => {
      if (!session || !project) return;
      const { discardPaths } = await import("@/modules/ide/git-ops");
      await discardPaths(session, [path]);
      ide.emit({ type: "GIT_STATUS_CHANGED", projectId: project.id });
    });

  const trackProgress = (progress: {
    phase: string;
    loaded: number;
    total: number;
  }) => {
    setProgress(`${progress.phase} ${progress.loaded}/${progress.total}`);
  };

  const doPush = () =>
    withBusy("push", async () => {
      if (!session || !project) return;
      const { pushChanges } = await import("@/modules/ide/git-ops");
      const auth = await authed();
      const result = await pushChanges(session, auth, trackProgress);
      if (!result.ok) throw new Error(result.message);
      ide.emit({ type: "GIT_STATUS_CHANGED", projectId: project.id });
    });

  const doPull = () =>
    withBusy("pull", async () => {
      if (!session || !project) return;
      const { pullChanges } = await import("@/modules/ide/git-ops");
      const auth = await authed();
      const result = await pullChanges(session, auth, trackProgress);
      if (!result.ok) throw new Error(result.message);
      setLastFetchedAt(Date.now());
      ide.emit({ type: "GIT_STATUS_CHANGED", projectId: project.id });
    });

  const doSync = () =>
    withBusy("sync", async () => {
      if (!session || !project) return;
      const { pullChanges, pushChanges } = await import(
        "@/modules/ide/git-ops"
      );
      const auth = await authed();
      const pulled = await pullChanges(session, auth, trackProgress);
      if (!pulled.ok) throw new Error(pulled.message);
      setLastFetchedAt(Date.now());
      const pushed = await pushChanges(session, auth, trackProgress);
      if (!pushed.ok) throw new Error(pushed.message);
      ide.emit({ type: "GIT_STATUS_CHANGED", projectId: project.id });
    });

  const doCommitAll = async () => {
    if (!commitMessage.trim()) {
      setError("Enter a commit message.");
      return;
    }
    const fullMessage = commitDescription.trim()
      ? `${commitMessage.trim()}\n\n${commitDescription.trim()}`
      : commitMessage.trim();
    await withBusy("commit", async () => {
      if (!session || !project) return;
      const { stageAll, commitChanges } = await import(
        "@/modules/ide/git-ops"
      );
      await stageAll(session);
      await commitChanges(session, fullMessage);
      setCommitMessage("");
      setCommitDescription("");
      ide.emit({ type: "GIT_STATUS_CHANGED", projectId: project.id });
    });
  };

  const openRemoteRepo = async () => {
    const parsed = parseRemoteRepo(remoteUrl);
    if (!parsed) {
      setError("Could not determine the remote repository URL.");
      return;
    }
    try {
      await Linking.openURL(parsed.httpsUrl);
    } catch {
      setError("Could not open the remote repository.");
    }
  };

  const doCheckout = (ref: string) =>
    withBusy("checkout", async () => {
      if (!session || !project) return;
      const { checkoutBranch } = await import("@/modules/ide/git-ops");
      const result = await checkoutBranch(session, ref);
      if (!result.switched && result.needsConfirm) {
        Alert.alert(
          "Uncommitted changes",
          "Switching branches will touch files you modified. Commit, stash, or discard first — or switch anyway and risk conflicts.",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Discard & switch",
              style: "destructive",
              onPress: () => {
                void (async () => {
                  const { discardPaths, checkoutBranch: retry } = await import(
                    "@/modules/ide/git-ops"
                  );
                  const current = await import(
                    "@/modules/ide/git-ops"
                  ).then((ops) => ops.getStatus(session));
                  const dirty = current.files
                    .filter((file) => file.unstaged)
                    .map((file) => file.path);
                  if (dirty.length > 0) await discardPaths(session, dirty);
                  await retry(session, ref);
                  ide.emit({ type: "GIT_CHECKOUT", projectId: project.id, ref });
                  await refresh();
                })().catch(fail);
              },
            },
          ],
        );
        return;
      }
      ide.emit({ type: "GIT_CHECKOUT", projectId: project.id, ref });
    });

  const doCreateBranch = () =>
    withBusy("branch", async () => {
      if (!session || !project || !newBranch.trim()) return;
      const { validateBranchName } = await import(
        "@/modules/ide/git-validate"
      );
      const invalid = validateBranchName(newBranch);
      if (invalid) throw new Error(invalid);
      const { createBranch } = await import("@/modules/ide/git-ops");
      await createBranch(session, newBranch.trim());
      setNewBranch("");
      setBranchModal(false);
    });

  if (!project || !session) {
    return (
      <SafeAreaView
        className="flex-1 bg-background dark:bg-background-dark"
        edges={["top", "left", "right", "bottom"]}
      >
        <View className="flex-1 px-sp-4" style={{ paddingTop: 56 }}>
          <Text className="font-sans text-xl font-semibold text-foreground dark:text-foreground-dark">
            Git
          </Text>
          <View className="flex-1 items-center justify-center gap-sp-2 px-sp-6">
            <Text className="text-center font-sans text-base font-medium text-foreground dark:text-foreground-dark">
              No project selected.
            </Text>
            <Text className="text-center font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
              Open or select a project to use Git.
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

  const unstaged = (status?.files ?? []).filter((file) => file.unstaged);
  const staged = (status?.files ?? []).filter((file) => file.staged);

  const currentBranch = branches?.current ?? status?.branch ?? null;
  const remote = parseRemoteRepo(remoteUrl);
  const tracking = status?.upstream ??
    (currentBranch ? `origin/${currentBranch}` : null);
  const ahead = status?.ahead ?? 0;
  const behind = status?.behind ?? 0;
  const canPull = behind > 0;
  const canPush = ahead > 0;
  const canSync = canPull || canPush;
  const changeCount = unstaged.length + staged.length;

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
          title="Git"
          subtitle={`${project.displayName}${status?.branch ? ` · ${status.branch}` : ""}${
            status && (status.ahead || status.behind)
              ? ` · ↑${status.ahead ?? 0} ↓${status.behind ?? 0}`
              : ""
          }`}
          right={
            loading ? (
              <ActivityIndicator size="small" color={theme.textSecondary} />
            ) : undefined
          }
        />

        <View
          className="flex-row items-center gap-sp-2 border-b border-border px-sp-4 py-sp-2 dark:border-border-dark"
          style={{ marginHorizontal: -16 }}
        >
          <GitBranch color={theme.textSecondary} size={18} strokeWidth={2} />
          <Text
            numberOfLines={1}
            className="min-w-0 flex-1 font-mono text-base text-foreground dark:text-foreground-dark"
          >
            {currentBranch ?? "no branch"}
          </Text>
          <Pressable
            accessibilityLabel="Switch branch"
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => {
              setBranchDrawer(true);
            }}
            className="p-sp-1"
          >
            <ChevronDown color={theme.textSecondary} size={18} strokeWidth={2} />
          </Pressable>
          <Pressable
            accessibilityLabel="Git settings"
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => {
              router.push("./settings");
            }}
            className="p-sp-1"
          >
            <Settings color={theme.textSecondary} size={18} strokeWidth={2} />
          </Pressable>
          <Pressable
            accessibilityLabel="Refresh status"
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => {
              void refresh();
            }}
            className="p-sp-1"
          >
            <RefreshCw color={theme.textSecondary} size={18} strokeWidth={2} />
          </Pressable>
        </View>

        {error ? (
          <Text className="font-sans text-sm text-destructive dark:text-destructive-dark">
            {error}
          </Text>
        ) : null}
        {progress ? (
          <Text className="font-mono text-xs text-muted-foreground dark:text-muted-foreground-dark">
            {progress}
          </Text>
        ) : null}

        <View className="relative min-h-0 flex-1">
          <HeaderShadow visible={scrolled} />
          <ScrollView
            className="min-h-0 flex-1"
            showsVerticalScrollIndicator={false}
            contentContainerClassName="gap-sp-3 pb-sp-6"
            scrollEventThrottle={32}
            onScroll={(event) => {
              setScrolled(event.nativeEvent.contentOffset.y > 4);
            }}
          >
          {conflicts.length > 0 ? (
            <View className="gap-sp-2 rounded-card border border-border bg-card p-sp-3 dark:border-border-dark dark:bg-card-dark">
              <Text className="font-sans text-base font-semibold text-foreground dark:text-foreground-dark">
                Merge Conflict{conflicts.length === 1 ? "" : "s"} (
                {conflicts.length})
              </Text>
              {conflicts.map((file) => (
                <ConflictCard
                  key={file.path}
                  file={file}
                  session={session}
                  projectId={project.id}
                  onResolved={() => {
                    ide.emit({
                      type: "GIT_RESOLVED",
                      projectId: project.id,
                    });
                    void refresh();
                  }}
                  onError={fail}
                />
              ))}
            </View>
          ) : null}

          <View className="gap-sp-2">
            <View className="flex-row items-center gap-sp-2">
              <Text className="font-sans text-lg font-semibold text-foreground dark:text-foreground-dark">
                Remote Updates
              </Text>
              <View className="flex-1" />
              {remote ? (
                <View className="flex-row items-center gap-sp-1">
                  <BookMarked
                    color={theme.textSecondary}
                    size={15}
                    strokeWidth={2}
                  />
                  <Text className="font-mono text-sm text-foreground dark:text-foreground-dark">
                    {remote.owner}/{remote.repo}
                  </Text>
                  <Pressable
                    accessibilityLabel="Open remote repository"
                    accessibilityRole="button"
                    hitSlop={8}
                    onPress={() => {
                      void openRemoteRepo();
                    }}
                    className="p-sp-1"
                  >
                    <ExternalLink
                      color={theme.textSecondary}
                      size={15}
                      strokeWidth={2}
                    />
                  </Pressable>
                </View>
              ) : (
                <Text className="font-mono text-sm text-muted-foreground dark:text-muted-foreground-dark">
                  No remote
                </Text>
              )}
            </View>
            <View className="gap-sp-2 rounded-card border border-border bg-card p-sp-3 dark:border-border-dark dark:bg-card-dark">
              <View className="flex-row items-center gap-sp-2">
                <Text
                  numberOfLines={1}
                  className="min-w-0 flex-1 font-mono text-sm text-foreground dark:text-foreground-dark"
                >
                  {tracking ? `${tracking} • upstream` : "no upstream"}
                </Text>
                <Text className="font-mono text-xs text-muted-foreground dark:text-muted-foreground-dark">
                  {lastFetchedAt
                    ? `last fetched ${formatRelativeTime(Math.floor(lastFetchedAt / 1000))}`
                    : "never fetched"}
                </Text>
                <Pressable
                  accessibilityLabel="Refresh status"
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={() => {
                    void refresh();
                  }}
                  className="p-sp-1"
                >
                  <RefreshCw
                    color={theme.textSecondary}
                    size={16}
                    strokeWidth={2}
                  />
                </Pressable>
              </View>
              <View className="flex-row gap-sp-1 rounded-ui bg-secondary p-sp-1 dark:bg-secondary-dark">
                <GitActionButton
                  label="Sync Changes"
                  icon={
                    <RefreshCw
                      color={theme.textSecondary}
                      size={16}
                      strokeWidth={2}
                    />
                  }
                  flex={1.5}
                  loading={busy === "sync"}
                  disabled={!canSync}
                  onPress={() => {
                    void doSync();
                  }}
                />
                <GitActionButton
                  label="Pull"
                  icon={
                    <Download
                      color={theme.textSecondary}
                      size={16}
                      strokeWidth={2}
                    />
                  }
                  loading={busy === "pull"}
                  disabled={!canPull}
                  onPress={() => {
                    void doPull();
                  }}
                />
                <GitActionButton
                  label="Push"
                  icon={
                    <Upload
                      color={theme.textSecondary}
                      size={16}
                      strokeWidth={2}
                    />
                  }
                  loading={busy === "push"}
                  disabled={!canPush}
                  onPress={() => {
                    void doPush();
                  }}
                />
              </View>
            </View>
          </View>

          <View className="gap-sp-2">
            <Text className="font-sans text-lg font-semibold text-foreground dark:text-foreground-dark">
              Commit
            </Text>
            <View className="gap-sp-2 rounded-card border border-border bg-card p-sp-3 dark:border-border-dark dark:bg-card-dark">
              <Pressable
                accessibilityLabel={
                  messageCollapsed ? "Expand message" : "Collapse message"
                }
                accessibilityRole="button"
                accessibilityState={{ expanded: !messageCollapsed }}
                onPress={() => {
                  setMessageCollapsed((value) => !value);
                }}
                className="flex-row items-center"
              >
                <Text className="flex-1 font-sans text-base text-foreground dark:text-foreground-dark">
                  Message
                </Text>
                {messageCollapsed ? (
                  <ChevronRight
                    color={theme.textSecondary}
                    size={18}
                    strokeWidth={2}
                  />
                ) : (
                  <ChevronUp
                    color={theme.textSecondary}
                    size={18}
                    strokeWidth={2}
                  />
                )}
              </Pressable>
              {messageCollapsed ? null : (
                <>
                  <TextInput
                    value={commitMessage}
                    onChangeText={setCommitMessage}
                    placeholder="Summary"
                    placeholderTextColor={theme.textSecondary}
                    autoCapitalize="sentences"
                    className="min-h-11 rounded-ui border border-border bg-input px-sp-3 font-sans text-base text-foreground dark:border-border-dark dark:bg-input-dark dark:text-foreground-dark"
                  />
                  <TextInput
                    value={commitDescription}
                    onChangeText={setCommitDescription}
                    placeholder="Description (optional)"
                    placeholderTextColor={theme.textSecondary}
                    autoCapitalize="sentences"
                    multiline
                    textAlignVertical="top"
                    className="min-h-20 rounded-ui border border-border bg-input px-sp-3 py-sp-2 font-sans text-base text-foreground dark:border-border-dark dark:bg-input-dark dark:text-foreground-dark"
                  />
                </>
              )}
            </View>

            <View className="gap-sp-2 rounded-card border border-border bg-card p-sp-3 dark:border-border-dark dark:bg-card-dark">
              <Pressable
                accessibilityLabel={
                  reviewExpanded
                    ? "Collapse change list"
                    : "Expand change list"
                }
                accessibilityRole="button"
                accessibilityState={{ expanded: reviewExpanded }}
                onPress={() => {
                  setReviewExpanded((value) => !value);
                }}
                className="flex-row items-center gap-sp-2"
              >
                <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
                  Review Changes
                </Text>
                <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                  {changeCount} changes
                </Text>
                <View className="flex-1" />
                {reviewExpanded ? (
                  <ChevronUp
                    color={theme.textSecondary}
                    size={18}
                    strokeWidth={2}
                  />
                ) : (
                  <ChevronRight
                    color={theme.textSecondary}
                    size={18}
                    strokeWidth={2}
                  />
                )}
              </Pressable>
              {reviewExpanded ? (
                <>
                  <View className="flex-row items-center gap-sp-2">
                    <Pressable
                      accessibilityLabel="Collapse change list"
                      accessibilityRole="button"
                      hitSlop={8}
                      onPress={() => {
                        setReviewExpanded(false);
                      }}
                      className="p-sp-1"
                    >
                      <ChevronUp
                        color={theme.textSecondary}
                        size={18}
                        strokeWidth={2}
                      />
                    </Pressable>
                    <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
                      {unstaged.length} changed files
                    </Text>
                    <View className="flex-1" />
                    <View className="flex-row items-center rounded-ui bg-secondary px-sp-2 py-sp-1 dark:bg-secondary-dark">
                      <Pressable
                        accessibilityLabel="Discard all changes"
                        accessibilityRole="button"
                        onPress={() => {
                          Alert.alert(
                            "Discard all changes?",
                            "Unstaged edits revert and untracked files are deleted.",
                            [
                              { text: "Cancel", style: "cancel" },
                              {
                                text: "Discard",
                                style: "destructive",
                                onPress: () => {
                                  void withBusy("discard", async () => {
                                    const { discardPaths } = await import(
                                      "@/modules/ide/git-ops"
                                    );
                                    await discardPaths(
                                      session,
                                      unstaged.map((file) => file.path),
                                    );
                                    ide.emit({
                                      type: "GIT_STATUS_CHANGED",
                                      projectId: project.id,
                                    });
                                  });
                                },
                              },
                            ],
                          );
                        }}
                        className="flex-row items-center gap-sp-1"
                      >
                        <RotateCcw
                          color={theme.textSecondary}
                          size={14}
                          strokeWidth={2}
                        />
                        <Text className="font-sans text-sm text-foreground dark:text-foreground-dark">
                          Discard All
                        </Text>
                      </Pressable>
                      <View
                        style={{
                          width: 1,
                          height: 20,
                          marginHorizontal: 8,
                          backgroundColor: theme.border,
                        }}
                      />
                      <Pressable
                        accessibilityLabel="Stage all changes"
                        accessibilityRole="button"
                        onPress={stageAll}
                        className="flex-row items-center gap-sp-1"
                      >
                        <Plus
                          color={theme.textSecondary}
                          size={14}
                          strokeWidth={2}
                        />
                        <Text className="font-sans text-sm text-foreground dark:text-foreground-dark">
                          Stage All
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                  {unstaged.length === 0 ? (
                    <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                      {status?.clean
                        ? "Working tree clean."
                        : "No unstaged changes."}
                    </Text>
                  ) : (
                    unstaged.map((file) => (
                      <ChangeFileRow
                        key={file.path}
                        path={file.path}
                        badge={
                          file.unstaged === "untracked"
                            ? "?"
                            : file.unstaged === "deleted"
                              ? "D"
                              : "M"
                        }
                        action="stage"
                        onDiscard={() => discardOne(file.path)}
                        onAction={() => stageOne(file.path)}
                        onDiff={() => openDiff(file.path, false)}
                      />
                    ))
                  )}
                  {staged.length > 0 ? (
                    <>
                      <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                        Staged ({staged.length})
                      </Text>
                      {staged.map((file) => (
                        <ChangeFileRow
                          key={file.path}
                          path={file.path}
                          badge="S"
                          action="unstage"
                          onAction={() => unstageOne(file.path)}
                          onDiff={() => openDiff(file.path, true)}
                        />
                      ))}
                    </>
                  ) : null}
                  <Text className="text-center font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                    Committing will automatically stage your changes.
                  </Text>
                </>
              ) : null}
            </View>
            <Button
              leftIcon={<Check color={theme.accentForeground} size={18} />}
              loading={busy === "commit"}
              disabled={!commitMessage.trim() || changeCount === 0}
              onPress={() => {
                void doCommitAll();
              }}
            >
              Stage and commit all changes
            </Button>
          </View>

          {/* Branches live in the branch drawer (branch-bar chevron). */}

          {history.length === 0 ? (
            <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
              No commits yet.
            </Text>
          ) : (
            <View>
              {history.map((commit, index) => (
                <View key={commit.oid} className="flex-row gap-sp-3">
                  <View
                    className="items-center"
                    style={{ width: 12 }}
                  >
                    <View
                      className="rounded-full"
                      style={{
                        width: 8,
                        height: 8,
                        marginTop: 6,
                        backgroundColor: theme.textSecondary,
                      }}
                    />
                    {index === history.length - 1 ? null : (
                      <View
                        className="flex-1"
                        style={{ width: 1, backgroundColor: theme.border }}
                      />
                    )}
                  </View>
                  <View className="min-w-0 flex-1" style={{ paddingBottom: 20 }}>
                    <Text
                      numberOfLines={2}
                      className="font-sans text-base text-foreground dark:text-foreground-dark"
                    >
                      {commit.message}
                    </Text>
                    <View className="flex-row items-center gap-sp-2 pt-sp-1">
                      <User
                        color={theme.textSecondary}
                        size={13}
                        strokeWidth={2}
                      />
                      <Text
                        numberOfLines={1}
                        className="min-w-0 flex-1 font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark"
                      >
                        {commit.author}
                      </Text>
                      <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                        {formatRelativeTime(commit.timestamp)}
                      </Text>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
        </View>

        {diff ? (
          <View className="absolute inset-x-0 bottom-0 top-16 rounded-card border border-border bg-card dark:border-border-dark dark:bg-card-dark">
            <View className="flex-row items-center gap-sp-2 border-b border-border p-sp-2 dark:border-border-dark">
              <Text
                numberOfLines={1}
                className="min-w-0 flex-1 font-mono text-xs text-foreground dark:text-foreground-dark"
              >
                {diff.staged ? "[staged] " : ""}
                {diff.path}
              </Text>
              <Pressable
                accessibilityLabel="Close diff"
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => {
                  setDiff(null);
                }}
                className="px-sp-2 py-sp-1"
              >
                <Text className="font-sans text-sm text-foreground dark:text-foreground-dark">
                  Close
                </Text>
              </Pressable>
            </View>
            <ScrollView className="min-h-0 flex-1 p-sp-2">
              <ScrollView horizontal showsHorizontalScrollIndicator>
                {diffLoading ? (
                  <ActivityIndicator size="small" color={theme.textSecondary} />
                ) : (
                  <Text selectable className="font-mono text-xs text-foreground dark:text-foreground-dark">
                    {diff.text}
                  </Text>
                )}
              </ScrollView>
            </ScrollView>
          </View>
        ) : null}

        <Drawer open={branchDrawer} onOpenChange={(open) => !open && setBranchDrawer(false)}>
          <DrawerContent showCloseButton showHandle>
            <DrawerHeader>
              <DrawerTitle>Branches</DrawerTitle>
              <DrawerDescription>
                {currentBranch ? `Current: ${currentBranch}` : "No branch checked out."}
              </DrawerDescription>
            </DrawerHeader>
            <DrawerBody contentContainerClassName="gap-sp-1 pb-sp-4">
              {(branches?.local ?? []).map((name) => (
                <Pressable
                  key={name}
                  accessibilityRole="button"
                  onPress={() => {
                    if (name !== branches?.current) {
                      setBranchDrawer(false);
                      void doCheckout(name);
                    }
                  }}
                  className="flex-row items-center gap-sp-2 rounded-ui px-sp-2 py-sp-2"
                  style={({ pressed }) => ({
                    backgroundColor:
                      name === branches?.current
                        ? withAlpha(theme.accent, 0.18)
                        : pressed
                          ? withAlpha(theme.text, 0.08)
                          : "transparent",
                  })}
                >
                  <Text
                    className="flex-1 font-mono text-sm text-foreground dark:text-foreground-dark"
                    style={{
                      fontWeight: name === branches?.current ? "700" : "400",
                    }}
                  >
                    {name === branches?.current ? `● ${name}` : name}
                  </Text>
                  {name !== branches?.current ? (
                    <Pressable
                      accessibilityLabel={`Delete branch ${name}`}
                      accessibilityRole="button"
                      hitSlop={8}
                      onPress={() => {
                        Alert.alert("Delete branch?", `"${name}"`, [
                          { text: "Cancel", style: "cancel" },
                          {
                            text: "Delete",
                            style: "destructive",
                            onPress: () => {
                              void withBusy("branch", async () => {
                                const { deleteBranch } = await import(
                                  "@/modules/ide/git-ops"
                                );
                                await deleteBranch(session, name);
                              });
                            },
                          },
                        ]);
                      }}
                    >
                      <Text className="font-sans text-xs text-destructive dark:text-destructive-dark">
                        Delete
                      </Text>
                    </Pressable>
                  ) : null}
                </Pressable>
              ))}
              <Button
                variant="outline"
                onPress={() => {
                  setBranchDrawer(false);
                  setNewBranch("");
                  setBranchModal(true);
                }}
              >
                + New branch
              </Button>
            </DrawerBody>
          </DrawerContent>
        </Drawer>

        <Drawer open={branchModal} onOpenChange={(open) => !open && setBranchModal(false)}>
          <DrawerContent showCloseButton showHandle>
            <DrawerHeader>
              <DrawerTitle>New branch</DrawerTitle>
              <DrawerDescription>Created from HEAD.</DrawerDescription>
            </DrawerHeader>
            <DrawerBody contentContainerClassName="gap-sp-2 pb-sp-4">
              <TextInput
                autoFocus
                value={newBranch}
                onChangeText={setNewBranch}
                placeholder="feature/name"
                placeholderTextColor={theme.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
                onSubmitEditing={() => {
                  void doCreateBranch();
                }}
                className="h-11 rounded-ui border border-border bg-input px-sp-3 font-mono text-base text-foreground dark:border-border-dark dark:bg-input-dark dark:text-foreground-dark"
              />
              <Button loading={busy === "branch"} onPress={() => void doCreateBranch()}>
                Create
              </Button>
            </DrawerBody>
          </DrawerContent>
        </Drawer>

      </View>
    </SafeAreaView>
  );
}

function GitActionButton({
  label,
  icon,
  onPress,
  disabled,
  loading,
  flex = 1,
}: {
  label: string;
  icon: React.ReactNode;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  flex?: number;
}) {
  const theme = useTheme();
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive }}
      onPress={onPress}
      disabled={inactive}
      className="flex-row items-center justify-center gap-sp-1 rounded-ui px-sp-2 py-sp-2"
      style={({ pressed }) => ({
        flex,
        opacity: inactive ? 0.4 : pressed ? 0.7 : 1,
      })}
    >
      {loading ? (
        <ActivityIndicator size="small" color={theme.textSecondary} />
      ) : (
        icon
      )}
      <Text className="font-sans text-sm text-foreground dark:text-foreground-dark">
        {label}
      </Text>
    </Pressable>
  );
}

function SmallButton({
  label,
  onPress,
  danger,
}: {
  label: string;
  onPress: () => void;
  danger?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className="rounded-ui border border-border px-sp-3 py-sp-1 dark:border-border-dark"
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      <Text
        className={
          danger
            ? "font-sans text-xs text-destructive dark:text-destructive-dark"
            : "font-sans text-xs text-foreground dark:text-foreground-dark"
        }
      >
        {label}
      </Text>
    </Pressable>
  );
}

function ChangeFileRow({
  path,
  badge,
  action,
  onAction,
  onDiscard,
  onDiff,
}: {
  path: string;
  badge: string;
  action: "stage" | "unstage";
  onAction: () => void;
  onDiscard?: () => void;
  onDiff: () => void;
}) {
  const theme = useTheme();
  const badgeColor =
    badge === "?"
      ? theme.info
      : badge === "D"
        ? theme.destructive
        : badge === "S"
          ? theme.success
          : theme.warning;
  return (
    <Pressable
      accessibilityLabel={path}
      accessibilityRole="button"
      onPress={onDiff}
      className="flex-row items-center gap-sp-2 py-sp-1"
      style={({ pressed }) => (pressed ? { opacity: 0.7 } : null)}
    >
      <FileTypeIcon fileName={path.split("/").pop() ?? path} size={20} />
      <Text
        numberOfLines={1}
        ellipsizeMode="middle"
        className="min-w-0 flex-1 font-mono text-sm text-foreground dark:text-foreground-dark"
      >
        {path}
      </Text>
      {onDiscard ? (
        <>
          <Pressable
            accessibilityLabel={`Discard changes to ${path}`}
            accessibilityRole="button"
            hitSlop={8}
            onPress={onDiscard}
            className="p-sp-1"
          >
            <RotateCcw
              color={theme.textSecondary}
              size={16}
              strokeWidth={2}
            />
          </Pressable>
          <View
            style={{ width: 1, height: 20, backgroundColor: theme.border }}
          />
        </>
      ) : null}
      <Pressable
        accessibilityLabel={
          action === "stage" ? `Stage ${path}` : `Unstage ${path}`
        }
        accessibilityRole="button"
        hitSlop={8}
        onPress={onAction}
        className="p-sp-1"
      >
        {action === "stage" ? (
          <Plus color={theme.textSecondary} size={16} strokeWidth={2} />
        ) : (
          <Minus color={theme.textSecondary} size={16} strokeWidth={2} />
        )}
      </Pressable>
      <View
        className="items-center justify-center rounded-ui"
        style={{
          width: 24,
          height: 24,
          backgroundColor: `${badgeColor}26`,
        }}
      >
        <Text
          className="font-mono text-xs font-semibold"
          style={{ color: badgeColor }}
        >
          {badge}
        </Text>
      </View>
    </Pressable>
  );
}
function ConflictCard({
  file,
  session,
  projectId,
  onResolved,
  onError,
}: {
  file: ConflictFile;
  session: import("@/core/types/app-state").ExternalFolderSession;
  projectId: string;
  onResolved: () => void;
  onError: (error: unknown) => void;
}) {
  const [busyHunk, setBusyHunk] = useState<number | null>(null);
  const resolve = async (
    hunkIndex: number,
    choice:
      | { kind: "current" }
      | { kind: "incoming" }
      | { kind: "both" }
      | { kind: "manual"; content: string },
  ) => {
    setBusyHunk(hunkIndex);
    try {
      const { resolveConflict } = await import("@/modules/ide/git-ops");
      await resolveConflict(session, file.path, hunkIndex, choice);
      onResolved();
    } catch (error) {
      onError(error);
    } finally {
      setBusyHunk(null);
    }
  };
  return (
    <View className="gap-sp-1 rounded-ui border border-border p-sp-2 dark:border-border-dark">
      <Text className="font-mono text-xs font-semibold text-foreground dark:text-foreground-dark">
        {file.path}
      </Text>
      {file.hunks.map((hunk) => (
        <View key={hunk.index} className="gap-sp-1">
          <Text className="font-mono text-xs text-muted-foreground dark:text-muted-foreground-dark">
            Hunk {hunk.index + 1} · lines {hunk.startLine}–{hunk.endLine}
          </Text>
          <View className="flex-row flex-wrap gap-sp-1">
            <SmallButton
              label={busyHunk === hunk.index ? "…" : "Keep Current"}
              onPress={() => void resolve(hunk.index, { kind: "current" })}
            />
            <SmallButton
              label="Keep Incoming"
              onPress={() => void resolve(hunk.index, { kind: "incoming" })}
            />
            <SmallButton
              label="Keep Both"
              onPress={() => void resolve(hunk.index, { kind: "both" })}
            />
          </View>
        </View>
      ))}
      <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
        Manual edits: open the file in the editor, resolve the markers, then
        stage it to mark resolved.
      </Text>
    </View>
  );
}
