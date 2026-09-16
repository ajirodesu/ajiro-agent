/**
 * Git Settings screen (`/git/settings`): remote URL, provider connections,
 * and commit author identity.
 *
 * - Remote: view/edit the `origin` URL; Create Remote validates and writes
 *   it via git-ops (real local config change, confirm before replacing).
 * - Connections: GitHub / Bitbucket / GitLab rows backed by the same
 *   secure `git:<host>` credentials push/pull/fetch read. Sign in stores a
 *   personal access token; Delete removes it. Brand marks are the official
 *   self-hosted simple-icons assets.
 * - Commit author: the repo-local `user.name`/`user.email` (Default
 *   Profile) plus the linked GitHub identity (resolved live from the
 *   stored token). Tapping a profile writes it to the repo config.
 *
 * All colors, borders, and typography come from the app theme; only brand
 * marks keep their official colors (GitHub renders theme-aware mono).
 */
import { useFocusEffect, useRouter } from "expo-router";
import { Image } from "expo-image";
import {
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  ExternalLink,
  Globe,
  Landmark,
  Lock,
  LogIn,
  User,
} from "lucide-react-native";
import { useCallback, useRef, useState } from "react";
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
import { SvgXml } from "react-native-svg";

import { Button } from "@/components/ui/button";
import { AppHeader, CircleIconButton } from "@/components/ui/chrome";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  PROVIDER_BRANDS,
  type GitProviderSlug,
} from "@/git-providers/providerIcons";
import {
  createRemoteRepo,
  validateRepoName,
  type RepoLocation,
  type RepoVisibility,
} from "@/git-providers/createRemoteRepo";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useTheme } from "@/hooks/use-theme";
import { secureSecretStore } from "@/core/services/secrets";
import { useIdeWorkspace } from "@/providers/ide-workspace";
import type { CommitAuthor } from "@/modules/ide/git-ops";

type Provider = {
  slug: GitProviderSlug;
  name: string;
  host: string;
};

const PROVIDERS: Provider[] = [
  { slug: "github", name: "GitHub", host: "github.com" },
  { slug: "bitbucket", name: "Bitbucket", host: "bitbucket.org" },
  { slug: "gitlab", name: "GitLab", host: "gitlab.com" },
];

type GitHubUser = {
  login: string;
  id: number;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
};

function ProviderMark({
  slug,
  size = 26,
}: {
  slug: GitProviderSlug;
  size?: number;
}): React.JSX.Element {
  const { theme } = useAppTheme();
  const brand = PROVIDER_BRANDS[slug];
  const fill =
    slug === "github" ? (theme.dark ? "#FFFFFF" : "#181717") : `#${brand.hex}`;
  const xml =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">` +
    `<path d="${brand.path}" fill="${fill}"/></svg>`;
  return <SvgXml xml={xml} width={size} height={size} />;
}

async function fetchGitHubUser(token: string): Promise<GitHubUser> {
  const response = await fetch("https://api.github.com/user", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub responded with ${response.status}.`);
  }
  const data = (await response.json()) as {
    login?: string;
    id?: number;
    name?: string | null;
    email?: string | null;
    avatar_url?: string | null;
  };
  if (typeof data.login !== "string" || typeof data.id !== "number") {
    throw new Error("GitHub returned an unexpected profile.");
  }
  return {
    login: data.login,
    id: data.id,
    name: typeof data.name === "string" ? data.name : null,
    email: typeof data.email === "string" ? data.email : null,
    avatarUrl:
      typeof data.avatar_url === "string" ? data.avatar_url : null,
  };
}

function githubEmailFor(user: GitHubUser): string {
  return (
    user.email ?? `${user.id}+${user.login}@users.noreply.github.com`
  );
}

export default function GitSettingsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const ide = useIdeWorkspace();

  const project = ide.activeProject;
  const session = ide.activeSession;

  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [remoteUrl, setRemoteUrl] = useState<string | null>(null);
  const [remoteDraft, setRemoteDraft] = useState("");
  const [connected, setConnected] = useState<Record<GitProviderSlug, boolean>>({
    github: false,
    bitbucket: false,
    gitlab: false,
  });
  const [connectionsExpanded, setConnectionsExpanded] = useState(true);
  const [author, setAuthor] = useState<CommitAuthor | null>(null);
  const initialAuthorRef = useRef<CommitAuthor | null>(null);
  const [githubUser, setGithubUser] = useState<GitHubUser | null>(null);
  const [tokenSlug, setTokenSlug] = useState<GitProviderSlug | null>(null);
  const [tokenInput, setTokenInput] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createProvider, setCreateProvider] =
    useState<GitProviderSlug>("github");
  const [createLocation, setCreateLocation] =
    useState<RepoLocation>("personal");
  const [repoName, setRepoName] = useState("");
  const [repoDesc, setRepoDesc] = useState("");
  const [repoPrivacy, setRepoPrivacy] = useState<RepoVisibility>("private");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    if (!session || !project) return;
    setLoading(true);
    setError(null);
    try {
      const ops = await import("@/modules/ide/git-ops");
      const [remote, commitAuthor, presence] = await Promise.all([
        ops.getRemoteUrl(session).catch(() => null),
        ops
          .getCommitAuthor(session)
          .catch((): CommitAuthor => ({ name: null, email: null })),
        Promise.all(
          PROVIDERS.map((provider) =>
            secureSecretStore
              .getProviderApiKey(`git:${provider.host}`)
              .then((token) => !!token)
              .catch(() => false),
          ),
        ),
      ]);
      setRemoteUrl(remote);
      setRemoteDraft(remote ?? "");
      setAuthor(commitAuthor);
      if (!initialAuthorRef.current) {
        initialAuthorRef.current = commitAuthor;
      }
      const next: Record<GitProviderSlug, boolean> = {
        github: presence[0] ?? false,
        bitbucket: presence[1] ?? false,
        gitlab: presence[2] ?? false,
      };
      setConnected(next);
      if (next.github) {
        const token = await secureSecretStore
          .getProviderApiKey("git:github.com")
          .catch(() => null);
        setGithubUser(
          token ? await fetchGitHubUser(token).catch(() => null) : null,
        );
      } else {
        setGithubUser(null);
      }
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : String(loadError),
      );
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

  const fail = (loadError: unknown) => {
    setError(loadError instanceof Error ? loadError.message : String(loadError));
  };

  const doSetRemote = async (url: string): Promise<boolean> => {
    if (!session || !project) return false;
    setBusy("remote");
    setError(null);
    setNotice(null);
    try {
      const { setRemoteUrl: writeRemoteUrl } = await import(
        "@/modules/ide/git-ops"
      );
      await writeRemoteUrl(session, url);
      setRemoteUrl(url.trim());
      ide.emit({ type: "GIT_STATUS_CHANGED", projectId: project.id });
      setNotice("Remote updated.");
      return true;
    } catch (remoteError) {
      fail(remoteError);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const openCreate = () => {
    setCreateProvider("github");
    setCreateLocation("personal");
    setRepoName("");
    setRepoDesc("");
    setRepoPrivacy("private");
    setCreateError(null);
    setCreateOpen(true);
  };

  const runCreate = async () => {
    if (!session || !project || creating) return;
    const nameError = validateRepoName(repoName);
    if (nameError) {
      setCreateError(nameError);
      return;
    }
    const provider = PROVIDERS.find((entry) => entry.slug === createProvider);
    if (!provider) return;
    const token = await secureSecretStore
      .getProviderApiKey(`git:${provider.host}`)
      .catch(() => null);
    if (!token) {
      setCreateError(`Sign in to ${provider.name} first`);
      return;
    }
    setCreating(true);
    setCreateError(null);
    setError(null);
    try {
      const created = await createRemoteRepo(createProvider, token, {
        name: repoName.trim(),
        description: repoDesc,
        visibility: repoPrivacy,
        location: createLocation,
      });
      const applied = await doSetRemote(created.cloneUrl);
      if (!applied) return;
      setCreateOpen(false);
      setNotice(`Remote created: ${created.fullName}.`);
      await refresh();
    } catch (createError) {
      setCreateError(
        createError instanceof Error
          ? createError.message
          : String(createError),
      );
    } finally {
      setCreating(false);
    }
  };

  const applyRemoteDraft = () => {
    const draft = remoteDraft.trim();
    if (!draft) {
      setError("Enter a remote URL.");
      return;
    }
    if (remoteUrl && draft !== remoteUrl) {
      Alert.alert(
        "Replace remote?",
        `Change origin from\n${remoteUrl}\nto\n${draft}?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Replace",
            style: "destructive",
            onPress: () => {
              void doSetRemote(draft);
            },
          },
        ],
      );
      return;
    }
    void doSetRemote(draft);
  };

  const saveToken = async () => {
    if (!tokenSlug || !tokenInput.trim()) return;
    const provider = PROVIDERS.find((entry) => entry.slug === tokenSlug);
    if (!provider) return;
    setBusy("token");
    setError(null);
    try {
      await secureSecretStore.setProviderApiKey(
        `git:${provider.host}`,
        tokenInput.trim(),
      );
      setTokenInput("");
      setTokenSlug(null);
      setNotice(`${provider.name} connected.`);
      await refresh();
    } catch (tokenError) {
      fail(tokenError);
    } finally {
      setBusy(null);
    }
  };

  const deleteConnection = (provider: Provider) => {
    Alert.alert(
      `Disconnect ${provider.name}?`,
      "Push, pull, and fetch will ask for credentials again.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void (async () => {
              setBusy("token");
              try {
                await secureSecretStore.deleteProviderApiKey(
                  `git:${provider.host}`,
                );
                setNotice(`${provider.name} disconnected.`);
                await refresh();
              } catch (tokenError) {
                fail(tokenError);
              } finally {
                setBusy(null);
              }
            })();
          },
        },
      ],
    );
  };

  const applyAuthor = async (name: string | null, email: string | null) => {
    if (!session || !project) return;
    if (!name || !email) {
      setError("That profile has no usable name or email.");
      return;
    }
    if (author?.name === name && author?.email === email) return;
    setBusy("author");
    setError(null);
    try {
      const { setCommitAuthor } = await import("@/modules/ide/git-ops");
      await setCommitAuthor(session, name, email);
      setAuthor({ name, email });
      ide.emit({ type: "GIT_STATUS_CHANGED", projectId: project.id });
    } catch (authorError) {
      fail(authorError);
    } finally {
      setBusy(null);
    }
  };

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
              Open or select a project to manage Git settings.
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

  const githubEmail = githubUser ? githubEmailFor(githubUser) : null;
  const githubName = githubUser
    ? (githubUser.name ?? githubUser.login)
    : null;
  const selected: "github" | "default" =
    githubUser &&
    githubEmail &&
    author?.email?.toLowerCase() === githubEmail.toLowerCase()
      ? "github"
      : "default";
  const tokenProvider = PROVIDERS.find((entry) => entry.slug === tokenSlug);

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
          title="Settings"
          right={
            loading ? (
              <ActivityIndicator size="small" color={theme.textSecondary} />
            ) : undefined
          }
        />

        {error ? (
          <Text className="font-sans text-sm text-destructive dark:text-destructive-dark">
            {error}
          </Text>
        ) : null}
        {notice ? (
          <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
            {notice}
          </Text>
        ) : null}

        <ScrollView
          className="min-h-0 flex-1"
          showsVerticalScrollIndicator={false}
          contentContainerClassName="gap-sp-4 pb-sp-6"
        >
          <View className="gap-sp-2">
            <Text className="font-sans text-lg font-semibold text-foreground dark:text-foreground-dark">
              Remote
            </Text>
            <View className="flex-row gap-sp-2">
              <TextInput
                value={remoteDraft}
                onChangeText={setRemoteDraft}
                placeholder="https://github.com/owner/repo.git"
                placeholderTextColor={theme.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
                onSubmitEditing={applyRemoteDraft}
                className="h-11 min-w-0 flex-1 rounded-ui border border-border bg-input px-sp-3 font-mono text-sm text-foreground dark:border-border-dark dark:bg-input-dark dark:text-foreground-dark"
              />
              <Button
                variant="outline"
                loading={busy === "remote"}
                onPress={openCreate}
              >
                Create Remote
              </Button>
            </View>
          </View>

          <View className="gap-sp-2 rounded-card border border-border bg-card p-sp-3 dark:border-border-dark dark:bg-card-dark">
            <Pressable
              accessibilityLabel={
                connectionsExpanded
                  ? "Collapse connections"
                  : "Expand connections"
              }
              accessibilityRole="button"
              accessibilityState={{ expanded: connectionsExpanded }}
              onPress={() => {
                setConnectionsExpanded((value) => !value);
              }}
              className="flex-row items-center"
            >
              <Text className="flex-1 font-sans text-lg font-semibold text-foreground dark:text-foreground-dark">
                Connections
              </Text>
              {connectionsExpanded ? (
                <ChevronUp
                  color={theme.textSecondary}
                  size={20}
                  strokeWidth={2}
                />
              ) : (
                <ChevronDown
                  color={theme.textSecondary}
                  size={20}
                  strokeWidth={2}
                />
              )}
            </Pressable>
            {connectionsExpanded ? (
              <View className="gap-sp-4 pt-sp-2">
                {PROVIDERS.map((provider) => {
                  const active = connected[provider.slug];
                  return (
                    <View
                      key={provider.slug}
                      className="flex-row items-center gap-sp-2"
                    >
                      <ProviderMark slug={provider.slug} size={26} />
                      <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
                        {provider.name}
                      </Text>
                      <View
                        className="rounded-full"
                        style={{
                          width: 8,
                          height: 8,
                          backgroundColor: active
                            ? "#34C759"
                            : theme.textSecondary,
                          opacity: active ? 1 : 0.5,
                        }}
                      />
                      <Text
                        className={
                          active
                            ? "font-sans text-sm text-foreground dark:text-foreground-dark"
                            : "font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark"
                        }
                      >
                        {active ? "Active" : "Disconnected"}
                      </Text>
                      <View className="flex-1" />
                      {active ? (
                        <ProviderButton
                          label="Delete"
                          onPress={() => deleteConnection(provider)}
                        />
                      ) : (
                        <ProviderButton
                          label="Sign in"
                          icon={
                            <LogIn
                              color={theme.text}
                              size={15}
                              strokeWidth={2}
                            />
                          }
                          onPress={() => {
                            setTokenInput("");
                            setTokenSlug(provider.slug);
                          }}
                        />
                      )}
                    </View>
                  );
                })}
              </View>
            ) : null}
          </View>

          <View className="gap-sp-2">
            <Text className="font-sans text-lg font-semibold text-foreground dark:text-foreground-dark">
              Commit author
            </Text>
            <AuthorCard
              username={author?.name ?? "Not configured"}
              label="Default Profile"
              detail={
                author?.name
                  ? `${author.name} <${author.email ?? "no email"}>`
                  : "No author configured yet."
              }
              avatarUrl={null}
              selected={selected === "default"}
              busy={busy === "author"}
              onPress={() => {
                const initial = initialAuthorRef.current;
                void applyAuthor(initial?.name ?? null, initial?.email ?? null);
              }}
            />
            {githubUser && githubEmail && githubName ? (
              <AuthorCard
                username={githubUser.login}
                label="GitHub Settings"
                labelUrl="https://github.com/settings/profile"
                detail={`${githubName} <${githubEmail}>`}
                avatarUrl={githubUser.avatarUrl}
                selected={selected === "github"}
                busy={busy === "author"}
                onPress={() => {
                  void applyAuthor(githubName, githubEmail);
                }}
              />
            ) : null}
          </View>
        </ScrollView>

        <Drawer
          open={tokenSlug !== null}
          onOpenChange={(open) => !open && setTokenSlug(null)}
        >
          <DrawerContent showCloseButton showHandle>
            <DrawerHeader>
              <DrawerTitle>
                {tokenProvider ? `${tokenProvider.name} token` : "Token"}
              </DrawerTitle>
              <DrawerDescription>
                Personal access token, stored securely on this device and
                never sent to the model.
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
              <Button loading={busy === "token"} onPress={() => void saveToken()}>
                Save
              </Button>
            </DrawerBody>
          </DrawerContent>
        </Drawer>

        <Drawer
          open={createOpen}
          onOpenChange={(open) => !open && setCreateOpen(false)}
        >
          <DrawerContent showCloseButton showHandle>
            <DrawerHeader>
              <DrawerTitle>Git Provider</DrawerTitle>
            </DrawerHeader>
            <DrawerBody contentContainerClassName="gap-sp-3 pb-sp-4">
              <View className="flex-row gap-sp-1 rounded-ui bg-secondary p-sp-1 dark:bg-secondary-dark">
                {PROVIDERS.map((provider) => {
                  const selected = createProvider === provider.slug;
                  return (
                    <Pressable
                      key={provider.slug}
                      accessibilityLabel={`Create on ${provider.name}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      onPress={() => {
                        setCreateProvider(provider.slug);
                        setCreateError(null);
                      }}
                      className="min-w-0 flex-1 flex-row items-center justify-center gap-sp-1 rounded-ui px-sp-1 py-sp-2"
                      style={{
                        borderWidth: 1,
                        borderColor: selected
                          ? theme.border
                          : "transparent",
                      }}
                    >
                      <ProviderMark slug={provider.slug} size={20} />
                      <Text
                        numberOfLines={1}
                        className="font-sans text-sm text-foreground dark:text-foreground-dark"
                      >
                        {provider.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <View className="gap-sp-1">
                <Text className="font-sans text-base text-muted-foreground dark:text-muted-foreground-dark">
                  Repository Location
                </Text>
                <View className="flex-row gap-sp-1 rounded-ui bg-secondary p-sp-1 dark:bg-secondary-dark">
                  {(
                    [
                      { value: "personal", label: "Personal", icon: "user" },
                      {
                        value: "organization",
                        label: "Organization",
                        icon: "org",
                      },
                    ] as const
                  ).map((option) => {
                    const selected = createLocation === option.value;
                    return (
                      <Pressable
                        key={option.value}
                        accessibilityLabel={option.label}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        onPress={() => {
                          setCreateLocation(option.value);
                          setCreateError(null);
                        }}
                        className="min-w-0 flex-1 flex-row items-center justify-center gap-sp-2 rounded-ui px-sp-1 py-sp-2"
                        style={{
                          borderWidth: 1,
                          borderColor: selected
                            ? theme.border
                            : "transparent",
                        }}
                      >
                        {option.icon === "user" ? (
                          <User
                            color={theme.textSecondary}
                            size={18}
                            strokeWidth={2}
                          />
                        ) : (
                          <Landmark
                            color={theme.textSecondary}
                            size={18}
                            strokeWidth={2}
                          />
                        )}
                        <Text
                          numberOfLines={1}
                          className="font-sans text-base text-foreground dark:text-foreground-dark"
                        >
                          {option.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <View className="gap-sp-1">
                <Text className="font-sans text-base text-muted-foreground dark:text-muted-foreground-dark">
                  Repository name
                </Text>
                <TextInput
                  value={repoName}
                  onChangeText={(text) => {
                    setRepoName(text);
                    if (createError) setCreateError(null);
                  }}
                  placeholder="Enter repository name"
                  placeholderTextColor={theme.textSecondary}
                  autoCapitalize="none"
                  autoCorrect={false}
                  className="h-11 rounded-ui border border-border bg-input px-sp-3 font-sans text-base text-foreground dark:border-border-dark dark:bg-input-dark dark:text-foreground-dark"
                />
              </View>

              <View className="gap-sp-1">
                <Text className="font-sans text-base text-muted-foreground dark:text-muted-foreground-dark">
                  Repository description
                </Text>
                <TextInput
                  value={repoDesc}
                  onChangeText={setRepoDesc}
                  placeholder="Enter repository description"
                  placeholderTextColor={theme.textSecondary}
                  autoCapitalize="sentences"
                  multiline
                  textAlignVertical="top"
                  className="min-h-20 rounded-ui border border-border bg-input px-sp-3 py-sp-2 font-sans text-base text-foreground dark:border-border-dark dark:bg-input-dark dark:text-foreground-dark"
                />
              </View>

              <View className="gap-sp-1">
                <Text className="font-sans text-base text-muted-foreground dark:text-muted-foreground-dark">
                  Privacy
                </Text>
                <View className="flex-row gap-sp-1 rounded-ui bg-secondary p-sp-1 dark:bg-secondary-dark">
                  {(
                    [
                      { value: "private", label: "Private", icon: "lock" },
                      { value: "public", label: "Public", icon: "globe" },
                    ] as const
                  ).map((option) => {
                    const selected = repoPrivacy === option.value;
                    return (
                      <Pressable
                        key={option.value}
                        accessibilityLabel={option.label}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        onPress={() => {
                          setRepoPrivacy(option.value);
                        }}
                        className="min-w-0 flex-1 flex-row items-center justify-center gap-sp-2 rounded-ui px-sp-1 py-sp-2"
                        style={{
                          borderWidth: 1,
                          borderColor: selected
                            ? theme.border
                            : "transparent",
                        }}
                      >
                        {option.icon === "lock" ? (
                          <Lock
                            color={theme.textSecondary}
                            size={18}
                            strokeWidth={2}
                          />
                        ) : (
                          <Globe
                            color={theme.textSecondary}
                            size={18}
                            strokeWidth={2}
                          />
                        )}
                        <Text
                          numberOfLines={1}
                          className="font-sans text-base text-foreground dark:text-foreground-dark"
                        >
                          {option.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              {createError ? (
                <View
                  className="rounded-ui border px-sp-3 py-sp-2"
                  style={{
                    backgroundColor: `${theme.destructive}22`,
                    borderColor: `${theme.destructive}55`,
                  }}
                >
                  <Text
                    className="text-center font-sans text-sm"
                    style={{ color: theme.destructive }}
                  >
                    {createError}
                  </Text>
                </View>
              ) : null}

              <Button
                leftIcon={
                  <ProviderMark slug={createProvider} size={20} />
                }
                loading={creating}
                onPress={() => {
                  void runCreate();
                }}
              >
                {`Create Repository on ${PROVIDERS.find((entry) => entry.slug === createProvider)?.name ?? "GitHub"}`}
              </Button>
            </DrawerBody>
          </DrawerContent>
        </Drawer>
      </View>
    </SafeAreaView>
  );
}

function ProviderButton({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon?: React.ReactNode;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      className="flex-row items-center gap-sp-1 rounded-ui border border-border px-sp-3 py-sp-2 dark:border-border-dark"
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      {icon}
      <Text className="font-sans text-sm text-foreground dark:text-foreground-dark">
        {label}
      </Text>
    </Pressable>
  );
}

function AuthorCard({
  username,
  label,
  labelUrl,
  detail,
  avatarUrl,
  selected,
  busy,
  onPress,
}: {
  username: string;
  label: string;
  labelUrl?: string;
  detail: string;
  avatarUrl: string | null;
  selected: boolean;
  busy: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityLabel={`${username}, ${label}`}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled: busy }}
      onPress={onPress}
      disabled={busy}
      className="gap-sp-2 rounded-card border border-border bg-card p-sp-3 dark:border-border-dark dark:bg-card-dark"
      style={({ pressed }) => (pressed && !busy ? { opacity: 0.7 } : null)}
    >
      <View className="flex-row items-center gap-sp-3">
        {avatarUrl ? (
          <Image
            source={{ uri: avatarUrl }}
            contentFit="cover"
            style={{ width: 44, height: 44, borderRadius: 22 }}
          />
        ) : (
          <View
            className="items-center justify-center bg-secondary dark:bg-secondary-dark"
            style={{ width: 44, height: 44, borderRadius: 22 }}
          >
            <User color={theme.textSecondary} size={22} strokeWidth={2} />
          </View>
        )}
        <Text
          numberOfLines={1}
          className="font-sans text-lg font-semibold text-foreground dark:text-foreground-dark"
        >
          {username}
        </Text>
        <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
          {label}
        </Text>
        {labelUrl ? (
          <Pressable
            accessibilityLabel={`Open ${label}`}
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => {
              void Linking.openURL(labelUrl).catch(() => {});
            }}
            className="p-sp-1"
          >
            <ExternalLink
              color={theme.textSecondary}
              size={15}
              strokeWidth={2}
            />
          </Pressable>
        ) : null}
        <View className="flex-1" />
        <View
          className="items-center justify-center rounded-full"
          style={{
            width: 22,
            height: 22,
            borderWidth: 1.5,
            borderColor: selected ? theme.accent : theme.border,
            backgroundColor: selected ? theme.accent : "transparent",
          }}
        >
          {selected ? (
            <View
              className="rounded-full"
              style={{ width: 8, height: 8, backgroundColor: "#FFFFFF" }}
            />
          ) : null}
        </View>
      </View>
      <Text
        numberOfLines={1}
        className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark"
      >
        {detail}
      </Text>
    </Pressable>
  );
}
