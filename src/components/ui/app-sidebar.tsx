/**
 * Ajiro Agent sidebar — slide-out navigation drawer styled after the ChatGPT
 * mobile app: solid black panel, fixed header (wordmark left, bordered
 * circular search + new-chat buttons right), scrollable nav rows and
 * conversation lists (Pinned / Recents, no divider lines), and a fixed bottom
 * bar with a blue "New Chat" pill and a circular settings button.
 *
 * Author: AjiroDesu
 */
import { usePathname, useRouter } from "expo-router";
import {
  AtSign,
  Archive,
  Clock,
  EllipsisVertical,
  FolderOpen,
  GitFork,
  Images,
  Library,
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
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal as ReactNativeModal,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
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
import {
  markSidebarReturnPending,
} from "@/modules/navigation/sidebar-return";
import { ACTIVE_AGENT_RUN_STATUSES } from "@/modules/runtime/run-manager";

/** Accent used by the New Chat pill, matching the reference app. */
const ACCENT_BLUE = "#0A84FF";

/**
 * Shared icon size for primary chrome icons (search, settings, sidebar
 * toggle, usage/context) so they render identically across the app.
 */
export const PRIMARY_ICON_SIZE = 20;

/**
 * Primary nav rows. "Images" and "Projects" map to real app destinations:
 * Images -> Library filtered to image files, Projects -> coding settings
 * (project folder/sandbox management).
 */
const NAV_ITEMS: { label: string; route: string; icon: typeof Library }[] = [
  { label: "Images", route: "/library?category=images", icon: Images },
  { label: "Library", route: "/library", icon: Library },
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
  const [renameTarget, setRenameTarget] = useState<Conversation | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);

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
        {/* Fixed header — matches the main page header height (h-14). */}
        <SidebarHeader className="h-14 shrink-0 flex-row items-center justify-between pb-0">
          <Text className="font-sans text-[28px] font-bold text-foreground dark:text-foreground-dark">
            Ajiro Agent
          </Text>
          <View className="flex-row items-center gap-sp-2">
            <CircularIconButton
              accessibilityLabel="Search chats"
              onPress={() => setSearchOpen(true)}
            >
              <Search
                color={theme.text}
                size={PRIMARY_ICON_SIZE}
                strokeWidth={1.8}
              />
            </CircularIconButton>
          </View>
        </SidebarHeader>

        <SidebarContent
          contentContainerClassName="gap-sp-4 pb-sp-3"
          style={{ marginTop: 8 }}
        >
          {/* Nav rows — icon + label pairs, left-aligned, no separators. */}
          <View className="gap-sp-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive =
                pathname === item.route.split("?")[0] ||
                (item.route.startsWith("/settings/coding") &&
                  pathname.startsWith("/settings/coding"));
              return (
                <Pressable
                  key={item.label}
                  accessibilityRole="button"
                  className={cn(
                    "h-11 flex-row items-center gap-sp-3 rounded-ui px-sp-2",
                    isActive && "bg-secondary dark:bg-secondary-dark",
                  )}
                  onPress={() => {
                    openRoute(item.route);
                  }}
                  style={({ pressed }) => (pressed ? { opacity: 0.85 } : null)}
                >
                  <Icon
                    color={theme.text}
                    size={PRIMARY_ICON_SIZE}
                    strokeWidth={1.8}
                  />
                  <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
                    {item.label}
                  </Text>
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

        {/* Fixed bottom bar — blue Chat pill + settings, never scroll away. */}
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
            className="h-[52px] flex-row items-center gap-sp-2 rounded-full px-6"
            onPress={startNewChat}
            style={({ pressed }) => ({
              backgroundColor: ACCENT_BLUE,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <SquarePen color="#FFFFFF" size={18} strokeWidth={2} />
            <Text className="font-sans text-base font-semibold text-white">
              Chat
            </Text>
          </Pressable>
          <CircularIconButton
            accessibilityLabel="Settings"
            onPress={() => {
              setSearchOpen(false);
              openRoute("/settings");
            }}
          >
            <Settings
              color={theme.text}
              size={PRIMARY_ICON_SIZE}
              strokeWidth={1.8}
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
        </View>
      </ReactNativeModal>
    </>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <Text className="px-sp-2 pb-sp-1 font-sans text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground dark:text-muted-foreground-dark">
      {children}
    </Text>
  );
}

function CircularIconButton({
  accessibilityLabel,
  children,
  onPress,
}: {
  accessibilityLabel: string;
  children: React.ReactNode;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      className="h-10 w-10 items-center justify-center rounded-full border border-border dark:border-border-dark"
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      {children}
    </Pressable>
  );
}

function ConversationRow({
  active,
  conversation,
  onRename,
  onSelect,
  run,
}: {
  active: boolean;
  conversation: Conversation;
  onRename: () => void;
  onSelect: () => void;
  run?: { startedAt: string };
}) {
  const elapsed = useElapsedSeconds(
    run?.startedAt ?? conversation.createdAt,
    Boolean(run),
  );

  return (
    <View className="flex-row items-center">
      <Pressable
        accessibilityRole="button"
        className={cn(
          "h-11 min-w-0 flex-1 flex-row items-center rounded-ui px-sp-2",
          active && "bg-secondary dark:bg-secondary-dark",
        )}
        onPress={onSelect}
        style={({ pressed }) => (pressed ? { opacity: 0.85 } : null)}
      >
        <Text
          numberOfLines={1}
          className="flex-1 font-sans text-base text-foreground dark:text-foreground-dark"
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







