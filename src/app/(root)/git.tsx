import { useFocusEffect, useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { useTheme } from "@/hooks/use-theme";
import { secureSecretStore } from "@/core/services/secrets";
import { useIdeWorkspace } from "@/providers/ide-workspace";
import type { ConflictFile } from "@/modules/ide/git-conflicts";

type DiffView = { path: string; staged: boolean; text: string } | null;

export default function GitScreen() {
  const router = useRouter();
  const theme = useTheme();
  const ide = useIdeWorkspace();

  const project = ide.activeProject;
  const session = ide.activeSession;
  const [statusText, setStatusText] = useState<string | null>(null);
  const [status, setStatus] = useState<import("@/modules/ide/git-ops").GitStatusSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diff, setDiff] = useState<DiffView>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
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
  const [newBranch, setNewBranch] = useState("");
  const [tokenModal, setTokenModal] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
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

  const unstageAll = () =>
    withBusy("stage", async () => {
      if (!session || !project) return;
      const { unstageAll } = await import("@/modules/ide/git-ops");
      await unstageAll(session);
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

  const doCommit = async (push: boolean) => {
    if (!session || !project || !commitMessage.trim()) {
      setError("Enter a commit message.");
      return;
    }
    await withBusy("commit", async () => {
      const { commitChanges, pushChanges } = await import(
        "@/modules/ide/git-ops"
      );
      await commitChanges(session, commitMessage.trim());
      setCommitMessage("");
      if (push) {
        const auth = await authed();
        const result = await pushChanges(session, auth, (progress) => {
          setProgress(`${progress.phase} ${progress.loaded}/${progress.total}`);
        });
        if (!result.ok) throw new Error(result.message);
      }
      ide.emit({ type: "GIT_STATUS_CHANGED", projectId: project.id });
    });
  };

  const doPush = () =>
    withBusy("push", async () => {
      if (!session || !project) return;
      const { pushChanges } = await import("@/modules/ide/git-ops");
      const auth = await authed();
      const result = await pushChanges(session, auth, (progress) => {
        setProgress(`${progress.phase} ${progress.loaded}/${progress.total}`);
      });
      if (!result.ok) throw new Error(result.message);
      ide.emit({ type: "GIT_STATUS_CHANGED", projectId: project.id });
    });

  const doPull = () =>
    withBusy("pull", async () => {
      if (!session || !project) return;
      const { pullChanges } = await import("@/modules/ide/git-ops");
      const auth = await authed();
      const result = await pullChanges(session, auth, (progress) => {
        setProgress(`${progress.phase} ${progress.loaded}/${progress.total}`);
      });
      if (!result.ok) throw new Error(result.message);
      ide.emit({ type: "GIT_STATUS_CHANGED", projectId: project.id });
    });

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

  const saveToken = async () => {
    if (!remoteUrl || !tokenInput.trim()) return;
    try {
      const host = new URL(remoteUrl).hostname.toLowerCase();
      await secureSecretStore.setProviderApiKey(
        `git:${host}`,
        tokenInput.trim(),
      );
      setTokenInput("");
      setTokenModal(false);
      setStatusText("Credential saved for this host.");
    } catch (error) {
      fail(error);
    }
  };

  const forgetToken = async () => {
    if (!remoteUrl) return;
    try {
      const host = new URL(remoteUrl).hostname.toLowerCase();
      await secureSecretStore.deleteProviderApiKey(`git:${host}`);
      setStatusText("Credential removed.");
    } catch (error) {
      fail(error);
    }
  };

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

  return (
    <SafeAreaView
      className="flex-1 bg-background dark:bg-background-dark"
      edges={["top", "left", "right", "bottom"]}
    >
      <View className="flex-1 gap-sp-2 px-sp-4" style={{ paddingTop: 12 }}>
        <View className="flex-row items-center gap-sp-2">
          <Pressable
            accessibilityLabel="Back"
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => {
              router.back();
            }}
            className="h-10 w-10 items-center justify-center rounded-full"
          >
            <ChevronLeft color={theme.text} size={20} />
          </Pressable>
          <View className="min-w-0 flex-1">
            <Text className="font-sans text-xl font-semibold text-foreground dark:text-foreground-dark">
              Git
            </Text>
            <Text
              numberOfLines={1}
              className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark"
            >
              {project.displayName}
              {status?.branch ? ` · ${status.branch}` : ""}
              {status && (status.ahead || status.behind)
                ? ` · ↑${status.ahead ?? 0} ↓${status.behind ?? 0}`
                : ""}
            </Text>
          </View>
          {loading ? (
            <ActivityIndicator size="small" color={theme.textSecondary} />
          ) : null}
        </View>

        {error ? (
          <Text className="font-sans text-sm text-destructive dark:text-destructive-dark">
            {error}
          </Text>
        ) : null}
        {statusText ? (
          <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
            {statusText}
          </Text>
        ) : null}
        {progress ? (
          <Text className="font-mono text-xs text-muted-foreground dark:text-muted-foreground-dark">
            {progress}
          </Text>
        ) : null}

        <ScrollView
          className="min-h-0 flex-1"
          showsVerticalScrollIndicator={false}
          contentContainerClassName="gap-sp-3 pb-sp-6"
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

          <View className="gap-sp-1 rounded-card border border-border bg-card p-sp-3 dark:border-border-dark dark:bg-card-dark">
            <View className="flex-row items-center justify-between">
              <Text className="font-sans text-base font-semibold text-foreground dark:text-foreground-dark">
                Changes ({unstaged.length})
              </Text>
              {unstaged.length > 0 ? (
                <View className="flex-row gap-sp-2">
                  <SmallButton label="Stage all" onPress={stageAll} />
                  <SmallButton
                    label="Discard all"
                    danger
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
                  />
                </View>
              ) : null}
            </View>
            {unstaged.length === 0 ? (
              <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                {status?.clean ? "Working tree clean." : "No unstaged changes."}
              </Text>
            ) : (
              unstaged.map((file) => (
                <ChangeRow
                  key={file.path}
                  path={file.path}
                  mark={file.unstaged === "untracked" ? "?" : "M"}
                  conflicted={file.conflicted}
                  primaryLabel="Stage"
                  onPrimary={() => stageOne(file.path)}
                  onDiff={() => openDiff(file.path, false)}
                  onDiscard={() => discardOne(file.path)}
                />
              ))
            )}
          </View>

          <View className="gap-sp-1 rounded-card border border-border bg-card p-sp-3 dark:border-border-dark dark:bg-card-dark">
            <View className="flex-row items-center justify-between">
              <Text className="font-sans text-base font-semibold text-foreground dark:text-foreground-dark">
                Staged Changes ({staged.length})
              </Text>
              {staged.length > 0 ? (
                <SmallButton label="Unstage all" onPress={unstageAll} />
              ) : null}
            </View>
            {staged.length === 0 ? (
              <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                Nothing staged.
              </Text>
            ) : (
              staged.map((file) => (
                <ChangeRow
                  key={file.path}
                  path={file.path}
                  mark="S"
                  conflicted={file.conflicted}
                  primaryLabel="Unstage"
                  onPrimary={() => unstageOne(file.path)}
                  onDiff={() => openDiff(file.path, true)}
                />
              ))
            )}
          </View>

          <View className="gap-sp-2 rounded-card border border-border bg-card p-sp-3 dark:border-border-dark dark:bg-card-dark">
            <TextInput
              value={commitMessage}
              onChangeText={setCommitMessage}
              placeholder="Commit Message"
              placeholderTextColor={theme.textSecondary}
              autoCapitalize="sentences"
              className="min-h-11 rounded-ui border border-border bg-input px-sp-3 font-sans text-base text-foreground dark:border-border-dark dark:bg-input-dark dark:text-foreground-dark"
            />
            <View className="flex-row gap-sp-2">
              <Button
                className="flex-1"
                loading={busy === "commit"}
                disabled={!commitMessage.trim() || staged.length === 0}
                onPress={() => {
                  void doCommit(false);
                }}
              >
                Commit
              </Button>
              <Button
                className="flex-1"
                loading={busy === "commit"}
                disabled={!commitMessage.trim() || staged.length === 0}
                onPress={() => {
                  void doCommit(true);
                }}
                variant="outline"
              >
                Commit & Push
              </Button>
            </View>
          </View>

          <View className="flex-row gap-sp-2">
            <Button
              className="flex-1"
              loading={busy === "push"}
              onPress={() => {
                void doPush();
              }}
              variant="outline"
            >
              Push
            </Button>
            <Button
              className="flex-1"
              loading={busy === "pull"}
              onPress={() => {
                void doPull();
              }}
              variant="outline"
            >
              Pull
            </Button>
          </View>

          <View className="gap-sp-1 rounded-card border border-border bg-card p-sp-3 dark:border-border-dark dark:bg-card-dark">
            <View className="flex-row items-center justify-between">
              <Text className="font-sans text-base font-semibold text-foreground dark:text-foreground-dark">
                Branches
              </Text>
              <SmallButton
                label="+ New"
                onPress={() => {
                  setNewBranch("");
                  setBranchModal(true);
                }}
              />
            </View>
            {(branches?.local ?? []).map((name) => (
              <Pressable
                key={name}
                accessibilityRole="button"
                onPress={() => {
                  if (name !== branches?.current) void doCheckout(name);
                }}
                className="flex-row items-center gap-sp-2 rounded-ui px-sp-2 py-sp-2"
                style={({ pressed }) => ({
                  backgroundColor:
                    name === branches?.current
                      ? "rgba(59,130,246,0.18)"
                      : pressed
                        ? "rgba(255,255,255,0.06)"
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
            {remoteUrl ? (
              <Text
                numberOfLines={1}
                className="font-mono text-xs text-muted-foreground dark:text-muted-foreground-dark"
              >
                {remoteUrl}
              </Text>
            ) : null}
            <View className="flex-row gap-sp-2">
              <SmallButton
                label="Credential"
                onPress={() => {
                  setTokenInput("");
                  setTokenModal(true);
                }}
              />
              <SmallButton label="Forget credential" onPress={forgetToken} danger />
            </View>
          </View>

          <View className="gap-sp-1 rounded-card border border-border bg-card p-sp-3 dark:border-border-dark dark:bg-card-dark">
            <Text className="font-sans text-base font-semibold text-foreground dark:text-foreground-dark">
              History
            </Text>
            {history.length === 0 ? (
              <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                No commits yet.
              </Text>
            ) : (
              history.map((commit) => (
                <View key={commit.oid} className="gap-sp-0 py-sp-1">
                  <Text
                    numberOfLines={1}
                    className="font-sans text-sm text-foreground dark:text-foreground-dark"
                  >
                    {commit.message}
                  </Text>
                  <Text className="font-mono text-xs text-muted-foreground dark:text-muted-foreground-dark">
                    {commit.oid.slice(0, 10)} · {commit.author} ·{" "}
                    {new Date(commit.timestamp * 1000).toLocaleDateString()}
                  </Text>
                </View>
              ))
            )}
          </View>
        </ScrollView>

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

        <Drawer open={tokenModal} onOpenChange={(open) => !open && setTokenModal(false)}>
          <DrawerContent showCloseButton showHandle>
            <DrawerHeader>
              <DrawerTitle>Git credential</DrawerTitle>
              <DrawerDescription>
                Stored securely on this device, never sent to the model.
              </DrawerDescription>
            </DrawerHeader>
            <DrawerBody contentContainerClassName="gap-sp-2 pb-sp-4">
              <TextInput
                value={tokenInput}
                onChangeText={setTokenInput}
                placeholder="Personal access token"
                placeholderTextColor={theme.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                className="h-11 rounded-ui border border-border bg-input px-sp-3 font-mono text-base text-foreground dark:border-border-dark dark:bg-input-dark dark:text-foreground-dark"
              />
              <Button onPress={() => void saveToken()}>Save</Button>
            </DrawerBody>
          </DrawerContent>
        </Drawer>
      </View>
    </SafeAreaView>
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

function ChangeRow({
  path,
  mark,
  conflicted,
  primaryLabel,
  onPrimary,
  onDiff,
  onDiscard,
}: {
  path: string;
  mark: string;
  conflicted: boolean;
  primaryLabel: string;
  onPrimary: () => void;
  onDiff: () => void;
  onDiscard?: () => void;
}) {
  return (
    <View className="flex-row items-center gap-sp-2 rounded-ui px-sp-1 py-sp-1">
      <Text
        className="w-6 text-center font-mono text-xs"
        style={{
          color:
            mark === "?"
              ? "#3B82F6"
              : mark === "D"
                ? "#EF4444"
                : mark === "S"
                  ? "#76D39B"
                  : "#E0A23C",
        }}
      >
        {conflicted ? "!" : mark}
      </Text>
      <Text
        numberOfLines={1}
        className="min-w-0 flex-1 font-mono text-xs text-foreground dark:text-foreground-dark"
      >
        {path}
      </Text>
      <SmallButton label="Diff" onPress={onDiff} />
      <SmallButton label={primaryLabel} onPress={onPrimary} />
      {onDiscard ? (
        <SmallButton label="Discard" danger onPress={onDiscard} />
      ) : null}
    </View>
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
