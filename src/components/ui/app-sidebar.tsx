/**
 * Ajiro Agent sidebar — port of sidebar.html: solid black panel, 26px
 * semibold wordmark, 38px bordered search circle, 22px nav icons with
 * 16px medium labels, pinned rows with chat icons, plain recent rows, and a
 * #3b82f6 Chat pill + 44px settings circle pinned to the bottom.
 *
 * Author: AjiroDesu
 */
import { usePathname, useRouter } from "expo-router";
import {
  AtSign,
  Archive,
  Clock,
  EllipsisVertical,
  FolderGit,
  FolderOpen,
  GitBranch,
  GitFork,
  Images,
  Library,
  MessageCircle,
  Pencil,
  Pin,
  PinOff,
  Search,
  Settings,
  SquarePen,
  Terminal,
  Trash2,
  X,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal as ReactNativeModal,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useElapsedSeconds } from "@/components/ui/processing-status";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  useSidebar,
} from "@/components/ui/sidebar";
import type { Conversation } from "@/core/types/app-state";
import { cn } from "@/core/utils";
import { useAppState } from "@/hooks/use-app-state";
import { useChat } from "@/hooks/use-chat";
import { useTheme } from "@/hooks/use-theme";
import { useIdeWorkspace } from "@/providers/ide-workspace";
import {
  markSidebarReturnPending,
} from "@/modules/navigation/sidebar-return";
import { ACTIVE_AGENT_RUN_STATUSES } from "@/modules/runtime/run-manager";

/** Accent used by the Chat pill, matching sidebar.html. */
const ACCENT_BLUE = "#3B82F6";

/**
 * Downward header fling dismisses a fullscreen modal. Native-rate velocity
 * from the gesture handler; no JS-thread tracking involved.
 */
function useDismissFling(onDismiss: () => void) {
  return useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY([28, 400])
        .failOffsetX([-24, 24])
        .onEnd((event) => {
          if (event.translationY > 64 || event.velocityY > 650) {
            runOnJS(onDismiss)();
          }
        }),
    [onDismiss],
  );
}

/**
 * Shared icon size for primary chrome icons (search, settings, sidebar
 * toggle, usage/context) so they render identically across the app.
 */
export const PRIMARY_ICON_SIZE = 20;

/**
 * Primary nav rows. "Images" and "Projects" map to real app destinations:
 * Images -> Library filtered to image files, Projects -> coding settings
 * (project folder/sandbox management). Files + Git are the IDE workspace
 * (§§27-30): Files is the unified File Manager + Code Editor, Git binds to
 * the active project.
 */
const NAV_ITEMS: { label: string; route: string; icon: typeof Library }[] = [
  { label: "Images", route: "/library?category=images", icon: Images },
  { label: "Library", route: "/library", icon: Library },
  { label: "Files", route: "/files", icon: FolderGit },
  { label: "Git", route: "/git", icon: GitBranch },
  { label: "Projects", route: "/settings/coding", icon: FolderOpen },
  { label: "Terminal", route: "/terminal", icon: Terminal },
  { label: "Scheduled", route: "/settings/jobs", icon: Clock },
  { label: "Plugins", route: "/settings/mcp", icon: AtSign },
];

export function AppSidebar() {
  const theme = useTheme();
  const pathname = usePathname();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { setOpen: setSidebarOpen } = useSidebar();
  const { agentRuns, hydrating } = useAppState();
  const {
    conversations,
    createConversation,
    currentConversation,
    renameConversation,
    selectConversation,
  } = useChat();

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [gitHeadline, setGitHeadline] = useState<string | null>(null);
  const ide = useIdeWorkspace();

  // Git subtitle for the nav (§30): branch + change count of the active
  // project, refreshed on open and on every git event. No project → none.
  useEffect(() => {
    let cancelled = false;
    const session = ide.activeSession;
    if (!session) {
      setGitHeadline(null);
      return;
    }
    const load = async () => {
      try {
        const { getStatus } = await import("@/modules/ide/git-ops");
        const status = await getStatus(session);
        if (cancelled) return;
        if (!status.isRepo || !status.branch) {
          setGitHeadline("Not a repository");
          return;
        }
        const changes = status.stagedCount + status.unstagedCount;
        setGitHeadline(
          changes === 0 ? status.branch : `${status.branch} · ${changes} change${changes === 1 ? "" : "s"}`,
        );
      } catch {
        if (!cancelled) setGitHeadline(null);
      }
    };
    void load();
    return ide.subscribe((event) => {
      if (event.type.startsWith("GIT_") || event.type.startsWith("PROJECT_")) {
        void load();
      }
    });
  }, [ide]);
  const [renameTarget, setRenameTarget] = useState<Conversation | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const dismissSearch = useCallback(() => setSearchOpen(false), []);
  const dismissRename = useCallback(() => {
    setRenameTarget(null);
    setRenameError(null);
  }, []);
  const searchFling = useDismissFling(dismissSearch);
  const renameFling = useDismissFling(dismissRename);

  const activeRuns = useMemo(
    () => agentRuns.filter((run) => ACTIVE_AGENT_RUN_STATUSES.includes(run.status)),
    [agentRuns],
  );

  const runByConversation = useMemo(() => {
    const map = new Map<string, (typeof activeRuns)[number]>();
    for (const run of activeRuns) {
      if (!map.has(run.conversationId)) {
        map.set(run.conversationId, run);
      }
    }
    return map;
  }, [activeRuns]);

  const visibleChats = useMemo(
    () =>
      [...conversations]
        .filter((conversation) => !conversation.archivedAt)
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)),
    [conversations],
  );

  const pinnedChats = useMemo(
    () => visibleChats.filter((conversation) => conversation.pinnedAt),
    [visibleChats],
  );

  const recentChats = useMemo(
    () => visibleChats.filter((conversation) => !conversation.pinnedAt),
    [visibleChats],
  );

  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return visibleChats;
    return visibleChats.filter((conversation) =>
      conversation.title.toLowerCase().includes(query),
    );
  }, [searchQuery, visibleChats]);

  /**
   * Navigate to a screen opened from the sidebar: close the drawer underneath
   * the pushed screen and record a pending return so back navigation lands on
   * the open sidebar instead of the collapsed main page.
   */
  const openRoute = (route: string) => {
    setSidebarOpen(false);
    markSidebarReturnPending();
    router.push(route as never);
  };

  const startNewChat = () => {
    // Fullscreen page: creating a chat returns to the main page.
    setSidebarOpen(false);
    createConversation().catch(console.error);
  };

  const openChat = (conversationId: string) => {
    selectConversation(conversationId)
      .then(() => openRoute("/"))
      .catch(console.error);
  };

  const submitRename = () => {
    const nextTitle = renameTitle.trim();
    if (!renameTarget || !nextTitle) {
      setRenameError("Enter a name for this chat.");
      return;
    }

    setRenaming(true);
    renameConversation(renameTarget.id, nextTitle)
      .then(() => {
        setRenameTarget(null);
        setRenameTitle("");
        setRenameError(null);
      })
      .catch((error) => {
        setRenameError(
          error instanceof Error ? error.message : "Rename failed.",
        );
      })
      .finally(() => {
        setRenaming(false);
      });
  };

  return (
    <>
      <Sidebar>
        {/* Fixed header — 26px semibold wordmark + 38px search circle. */}
        <SidebarHeader className="h-14 shrink-0 flex-row items-center justify-between pb-0">
          <Text
            className="font-sans font-semibold text-foreground dark:text-foreground-dark"
            style={{ fontSize: 26, letterSpacing: -0.3 }}
          >
            Ajiro Agent
          </Text>
          <View className="flex-row items-center gap-sp-2">
            <CircularIconButton
              accessibilityLabel="Search chats"
              onPress={() => setSearchOpen(true)}
              size={38}
            >
              <Search
                color={theme.text}
                size={18}
                strokeWidth={2}
              />
            </CircularIconButton>
          </View>
        </SidebarHeader>

        <SidebarContent
          contentContainerClassName="gap-sp-4 pb-sp-3"
          style={{ marginTop: 8 }}
        >
          {/* Nav rows — 22px icon + 16px medium label, radius 12. */}
          <View className="gap-sp-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive =
                pathname === item.route.split("?")[0] ||
                (item.route.startsWith("/settings/coding") &&
                  pathname.startsWith("/settings/coding"));
              const subtitle =
                item.label === "Files"
                  ? (ide.activeProject?.name ?? null)
                  : item.label === "Git"
                    ? gitHeadline
                    : null;
              return (
                <Pressable
                  key={item.label}
                  accessibilityRole="button"
                  className="flex-row items-center gap-4 rounded-xl px-3"
                  style={({ pressed }) => ({
                    paddingVertical: 11,
                    backgroundColor: pressed
                      ? "rgba(255,255,255,0.06)"
                      : isActive
                        ? "rgba(255,255,255,0.06)"
                        : "transparent",
                  })}
                  onPress={() => {
                    openRoute(item.route);
                  }}
                >
                  <Icon
                    color={theme.text}
                    size={22}
                    strokeWidth={2}
                  />
                  <View className="min-w-0 flex-1">
                    <Text
                      className="font-sans text-foreground dark:text-foreground-dark"
                      style={{ fontSize: 16, fontWeight: "500" }}
                    >
                      {item.label}
                    </Text>
                    {subtitle ? (
                      <Text
                        numberOfLines={1}
                        className="font-sans text-muted-foreground dark:text-muted-foreground-dark"
                        style={{ fontSize: 13 }}
                      >
                        {subtitle}
                      </Text>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </View>

          {/* Pinned — hidden entirely when there are no pinned chats. */}
          {pinnedChats.length > 0 ? (
            <View className="gap-sp-1">
              <SectionLabel>Pinned</SectionLabel>
              {pinnedChats.map((conversation) => (
                <ConversationRow
                  key={conversation.id}
                  active={
                    currentConversation?.id === conversation.id &&
                    pathname === "/"
                  }
                  conversation={conversation}
                  leadingIcon
                  run={runByConversation.get(conversation.id)}
                  onSelect={() => {
                    openChat(conversation.id);
                  }}
                  onRename={() => {
                    setRenameTarget(conversation);
                    setRenameTitle(conversation.title);
                    setRenameError(null);
                  }}
                />
              ))}
            </View>
          ) : null}

          {/* Recents */}
          <View className="gap-sp-1">
            <SectionLabel>Recents</SectionLabel>
            {recentChats.map((conversation) => (
              <ConversationRow
                key={conversation.id}
                active={
                  currentConversation?.id === conversation.id && pathname === "/"
                }
                conversation={conversation}
                run={runByConversation.get(conversation.id)}
                onSelect={() => {
                  openChat(conversation.id);
                }}
                onRename={() => {
                  setRenameTarget(conversation);
                  setRenameTitle(conversation.title);
                  setRenameError(null);
                }}
              />
            ))}
            {!hydrating && visibleChats.length === 0 ? (
              <Text className="px-sp-2 py-sp-2 font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                Your conversations will appear here.
              </Text>
            ) : null}
            {hydrating ? (
              <View className="flex-row items-center gap-sp-2 px-sp-2 py-sp-2">
                <ActivityIndicator size="small" color={theme.textSecondary} />
                <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                  Loading chats
                </Text>
              </View>
            ) : null}
          </View>
        </SidebarContent>

        {/* Fixed bottom bar — Chat pill + settings circle, never scroll away. */}
        <SidebarFooter
          className="flex-row items-center justify-between gap-sp-3"
          style={{
            backgroundColor: theme.background,
            paddingBottom: insets.bottom + 8,
          }}
        >
          <Pressable
            accessibilityLabel="Chat"
            accessibilityRole="button"
            className="flex-row items-center rounded-3xl"
            onPress={startNewChat}
            style={({ pressed }) => ({
              backgroundColor: ACCENT_BLUE,
              gap: 10,
              opacity: pressed ? 0.85 : 1,
              paddingHorizontal: 22,
              paddingVertical: 12,
            })}
          >
            <SquarePen color="#FFFFFF" size={19} strokeWidth={2} />
            <Text
              className="font-sans text-white"
              style={{ fontSize: 16, fontWeight: "500" }}
            >
              Chat
            </Text>
          </Pressable>
          <CircularIconButton
            accessibilityLabel="Settings"
            size={44}
            onPress={() => {
              setSearchOpen(false);
              openRoute("/settings");
            }}
          >
            <Settings
              color={theme.text}
              size={20}
              strokeWidth={2}
            />
          </CircularIconButton>
        </SidebarFooter>
      </Sidebar>

      {/* Search */}
      <ReactNativeModal
        animationType="slide"
        onRequestClose={() => setSearchOpen(false)}
        statusBarTranslucent
        visible={searchOpen}
      >
        <View
          className="flex-1 bg-background dark:bg-background-dark"
          style={{ paddingTop: insets.top + 12 }}
        >
          <GestureDetector gesture={searchFling}>
            <View className="flex-row items-center gap-sp-3 px-sp-4">
            <Pressable
              accessibilityLabel="Close search"
              accessibilityRole="button"
              className="h-10 w-10 items-center justify-center"
              hitSlop={8}
              onPress={() => setSearchOpen(false)}
            >
              <X color={theme.text} size={PRIMARY_ICON_SIZE} strokeWidth={1.8} />
            </Pressable>
            <TextInput
              autoFocus
              className="h-11 flex-1 rounded-full border border-border bg-input px-sp-4 font-sans text-base text-foreground dark:border-border-dark dark:bg-input-dark dark:text-foreground-dark"
              onChangeText={setSearchQuery}
              placeholder="Search chats"
              placeholderTextColor={theme.textSecondary}
              value={searchQuery}
            />
            </View>
          </GestureDetector>

          <View className="mt-sp-4 flex-1 px-sp-4">
            {searchResults.map((conversation) => (
              <Pressable
                key={conversation.id}
                accessibilityRole="button"
                className="h-11 flex-row items-center rounded-ui px-sp-2"
                onPress={() => {
                  setSearchOpen(false);
                  setSearchQuery("");
                  openChat(conversation.id);
                }}
                style={({ pressed }) => (pressed ? { opacity: 0.85 } : null)}
              >
                <Text
                  numberOfLines={1}
                  className="flex-1 font-sans text-base text-foreground dark:text-foreground-dark"
                >
                  {conversation.title}
                </Text>
              </Pressable>
            ))}
            {searchResults.length === 0 && !hydrating ? (
              <Text className="px-sp-2 py-sp-2 font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                No chats match your search.
              </Text>
            ) : null}
          </View>
        </View>
      </ReactNativeModal>

      {/* Rename chat */}
      <ReactNativeModal
        animationType="fade"
        onRequestClose={() => setRenameTarget(null)}
        statusBarTranslucent
        transparent
        visible={renameTarget !== null}
      >
        <View className="flex-1 items-center justify-center bg-black/60 px-sp-6">
          <GestureDetector gesture={renameFling}>
            <View className="w-full max-w-sm rounded-card bg-card p-sp-4 dark:bg-card-dark">
            <Text className="mb-sp-3 font-sans text-lg font-semibold text-foreground dark:text-foreground-dark">
              Rename chat
            </Text>
            <TextInput
              autoFocus
              className="h-11 rounded-ui border border-border bg-input px-sp-3 font-sans text-base text-foreground dark:border-border-dark dark:bg-input-dark dark:text-foreground-dark"
              onChangeText={(value) => {
                setRenameTitle(value);
                setRenameError(null);
              }}
              placeholder="Chat name"
              placeholderTextColor={theme.textSecondary}
              value={renameTitle}
            />
            {renameError ? (
              <Text className="mt-sp-2 font-sans text-sm text-destructive dark:text-destructive-dark">
                {renameError}
              </Text>
            ) : null}
            <View className="mt-sp-4 flex-row justify-end gap-sp-2">
              <Pressable
                accessibilityRole="button"
                className="h-10 items-center justify-center rounded-full px-sp-4"
                disabled={renaming}
                onPress={() => {
                  setRenameTarget(null);
                  setRenameError(null);
                }}
              >
                <Text className="font-sans text-base font-medium text-muted-foreground dark:text-muted-foreground-dark">
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                className="h-10 items-center justify-center rounded-full bg-secondary px-sp-4 dark:bg-secondary-dark"
                disabled={renaming}
                onPress={submitRename}
              >
                {renaming ? (
                  <ActivityIndicator size="small" color={theme.text} />
                ) : (
                  <Text className="font-sans text-base font-semibold text-foreground dark:text-foreground-dark">
                    Save
                  </Text>
                )}
                </Pressable>
              </View>
            </View>
          </GestureDetector>
        </View>
      </ReactNativeModal>
    </>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <Text
      className="font-sans text-foreground dark:text-foreground-dark"
      style={{ fontSize: 16, fontWeight: "500", marginBottom: 6 }}
    >
      {children}
    </Text>
  );
}

function CircularIconButton({
  accessibilityLabel,
  children,
  onPress,
  size = 38,
}: {
  accessibilityLabel: string;
  children: React.ReactNode;
  onPress: () => void;
  size?: number;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      className="items-center justify-center rounded-full"
      style={({ pressed }) => ({
        width: size,
        height: size,
        backgroundColor: "#1A1A1A",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.12)",
        opacity: pressed ? 0.7 : 1,
      })}
      onPress={onPress}
    >
      {children}
    </Pressable>
  );
}

function ConversationRow({
  active,
  conversation,
  leadingIcon,
  onRename,
  onSelect,
  run,
}: {
  active: boolean;
  conversation: Conversation;
  leadingIcon?: boolean;
  onRename: () => void;
  onSelect: () => void;
  run?: { startedAt: string };
}) {
  const theme = useTheme();
  const elapsed = useElapsedSeconds(
    run?.startedAt ?? conversation.createdAt,
    Boolean(run),
  );

  return (
    <View className="flex-row items-center" style={{ gap: 14 }}>
      <Pressable
        accessibilityRole="button"
        className={cn(
          "min-w-0 flex-1 flex-row items-center rounded-xl",
          active && "bg-secondary dark:bg-secondary-dark",
        )}
        style={({ pressed }) => ({
          paddingVertical: 9,
          opacity: pressed ? 0.85 : 1,
        })}
        onPress={onSelect}
      >
        {leadingIcon ? (
          <MessageCircle
            color={theme.text}
            size={22}
            strokeWidth={2}
            style={{ marginRight: 14 }}
          />
        ) : null}
        <Text
          numberOfLines={1}
          className="flex-1 font-sans text-foreground dark:text-foreground-dark"
          style={{ fontSize: 16, fontWeight: "400" }}
        >
          {conversation.title}
        </Text>
      </Pressable>
      {run ? (
        <Text className="px-sp-1 font-mono text-xs text-muted-foreground dark:text-muted-foreground-dark">
          {elapsed}s
        </Text>
      ) : null}
      <ChatOptions
        conversationId={conversation.id}
        onRename={onRename}
        pinned={Boolean(conversation.pinnedAt)}
        pinnedCount={2}
      />
    </View>
  );
}

function ChatOptions({
  conversationId,
  onRename,
  pinned,
  pinnedCount,
}: {
  conversationId: string;
  onRename: () => void;
  pinned: boolean;
  pinnedCount: number;
}) {
  const {
    archiveConversation,
    deleteConversation,
    forkConversation,
    setConversationPinned,
  } = useChat();
  const theme = useTheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger>
        <Pressable hitSlop={8} className="px-sp-1 py-sp-2">
          <EllipsisVertical size={18} color={theme.textSecondary} />
        </Pressable>
      </DropdownMenuTrigger>

      <DropdownMenuContent width={190}>
        <DropdownMenuItem onPress={onRename}>
          <View className="flex-row items-center gap-sp-2">
            <Pencil color={theme.text} size={16} />
            <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
              Rename
            </Text>
          </View>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!pinned && pinnedCount >= 3}
          onPress={() => {
            setConversationPinned(conversationId, !pinned).catch(console.error);
          }}
        >
          <View className="flex-row items-center gap-sp-2">
            {pinned ? (
              <PinOff color={theme.text} size={16} />
            ) : (
              <Pin color={theme.text} size={16} />
            )}
            <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
              {pinned
                ? "Unpin"
                : pinnedCount >= 3
                  ? "Pin limit reached"
                  : "Pin"}
            </Text>
          </View>
        </DropdownMenuItem>
        <DropdownMenuItem
          onPress={() => {
            forkConversation(conversationId).catch(console.error);
          }}
        >
          <View className="flex-row items-center gap-sp-2">
            <GitFork color={theme.text} size={16} />
            <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
              Fork
            </Text>
          </View>
        </DropdownMenuItem>
        <DropdownMenuItem
          onPress={() => {
            archiveConversation(conversationId, true).catch(console.error);
          }}
        >
          <View className="flex-row items-center gap-sp-2">
            <Archive color={theme.text} size={16} />
            <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
              Archive
            </Text>
          </View>
        </DropdownMenuItem>
        <DropdownMenuItem
          onPress={() => {
            deleteConversation(conversationId).catch(console.error);
          }}
        >
          <View className="flex-row items-center gap-sp-2">
            <Trash2 color={theme.destructive} size={16} />
            <Text className="font-sans text-base text-destructive dark:text-destructive-dark">
              Delete
            </Text>
          </View>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}







