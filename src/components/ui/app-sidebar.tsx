/**
 * Ajiro Agent sidebar: shared-chrome header, theme-aware nav rows, and a
 * merged new-chat + settings capsule pinned to the bottom.
 *
 * Author: AjiroDesu
 */
import { usePathname, useRouter } from "expo-router";
import {
  Bot,
  Clock,
  FolderGit,
  FolderOpen,
  GitBranch,
  Images,
  Library,
  MessageCircle,
  Pencil,
  Pin,
  PinOff,
  Play,
  Puzzle,
  Search,
  Settings,
  SquarePen,
  Terminal,
  Trash2,
  X,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  AppHeader,
  CapsuleContainer,
  CircleIconButton,
  FOOTER_ICON_SIZE,
} from "@/components/ui/chrome";
import { withAlpha } from "@/components/ui/chrome-spec";
import {
  MessageMenu,
  type MenuAnchor,
} from "@/components/chat/message-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { formatMessageDate } from "@/modules/chat/message-dates";
import type { Conversation } from "@/core/types/app-state";
import { useAppState } from "@/hooks/use-app-state";
import { useChat } from "@/hooks/use-chat";
import { useTheme } from "@/hooks/use-theme";
import { useIdeWorkspace } from "@/providers/ide-workspace";
import {
  markSidebarReturnPending,
} from "@/modules/navigation/sidebar-return";
import {
  getCatalogSnapshot,
  getExtensionStore,
  subscribeCatalog,
} from "@/modules/extensions";
import {
  splitPinnedRecents,
  visibleConversations,
} from "@/modules/chat/conversation-list";
import { ACTIVE_AGENT_RUN_STATUSES } from "@/modules/runtime/run-manager";

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
 * the active project. "Plugins" is the Acode-compatible Extension Store
 * (extension discovery, install, and lifecycle live there); MCP servers keep
 * their own home under Settings -> MCP.
 */
const NAV_ITEMS: { label: string; route: string; icon: typeof Library }[] = [
  { label: "Images", route: "/library?category=images", icon: Images },
  { label: "Library", route: "/library", icon: Library },
  { label: "Files", route: "/files", icon: FolderGit },
  { label: "Git", route: "/git", icon: GitBranch },
  { label: "Projects", route: "/settings/coding", icon: FolderOpen },
  { label: "Terminal", route: "/terminal", icon: Terminal },
  { label: "Run", route: "/run", icon: Play },
  { label: "Scheduled", route: "/settings/jobs", icon: Clock },
  { label: "Plugins", route: "/extensions", icon: Puzzle },
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
  // Extensions discovered by background catalog sync (§19) that the user has
  // not seen yet, surfaced as a quiet count on the Plugins row (§63).
  const [extensionDiscoveries, setExtensionDiscoveries] = useState(
    () => getCatalogSnapshot().newCount,
  );
  // Assumed on until the stored preference loads, so the very first paint
  // matches the default rather than flashing a zero.
  const notifyOnDiscoveryRef = useRef(true);
  const ide = useIdeWorkspace();

  useEffect(() => {
    let cancelled = false;
    // The indicator is user-controllable (§63): with discovery notices off,
    // new extensions still appear in the Store — they just don't interrupt.
    void getExtensionStore()
      .preferences.load()
      .then((loaded) => {
        if (!cancelled) notifyOnDiscoveryRef.current = loaded.notifyOnDiscovery;
      })
      .catch(() => {});
    const apply = (count: number) => {
      setExtensionDiscoveries(
        notifyOnDiscoveryRef.current ? count : 0,
      );
    };
    apply(getCatalogSnapshot().newCount);
    const unsubscribe = subscribeCatalog((snapshot) => apply(snapshot.newCount));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

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
    () => visibleConversations(conversations),
    [conversations],
  );

  const { pinned: pinnedChats, recents: recentChats } = useMemo(
    () => splitPinnedRecents(conversations),
    [conversations],
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
        {/* Fixed header — shared chrome: centered wordmark + search circle. */}
        <AppHeader
          title="Ajiro Agent"
          right={
            <CircleIconButton
              accessibilityLabel="Search chats"
              onPress={() => setSearchOpen(true)}
            >
              <Search
                color={theme.text}
                size={18}
                strokeWidth={2}
              />
            </CircleIconButton>
          }
        />

        <SidebarContent
          contentContainerClassName="gap-sp-4 pb-sp-3"
          style={{ marginTop: 8 }}
        >
          {/* Bot shortcut — bespoke tile (fresh design): accent-ringed
              rounded tile with its own icon well, not the nav-row style.
              Active-route highlighting matches nav behavior. */}
          <BotSidebarTile
            active={pathname === "/bot" || pathname.startsWith("/bot/")}
            onPress={() => {
              openRoute("/bot");
            }}
          />

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
                      ? withAlpha(theme.text, 0.08)
                      : isActive
                        ? withAlpha(theme.text, 0.08)
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
                  {item.label === "Plugins" && extensionDiscoveries > 0 ? (
                    <View
                      accessibilityLabel={`${extensionDiscoveries} new extensions`}
                      className="items-center justify-center rounded-full px-2 py-0.5"
                      style={{ backgroundColor: withAlpha(theme.accent, 0.22) }}
                    >
                      <Text
                        className="font-mono text-xs"
                        style={{ color: theme.text }}
                      >
                        {extensionDiscoveries}
                      </Text>
                    </View>
                  ) : null}
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
                  pinned
                  pinnedCount={pinnedChats.length}
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
                pinned={false}
                pinnedCount={pinnedChats.length}
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

        {/* Fixed bottom bar — merged new-chat + settings capsule. */}
        <SidebarFooter
          className="flex-row items-center justify-between gap-sp-3"
          style={{
            backgroundColor: theme.background,
            paddingBottom: insets.bottom + 8,
          }}
        >
          <CapsuleContainer accessibilityLabel="Chat actions">
            <Pressable
              accessibilityLabel="New chat"
              accessibilityRole="button"
              className="items-center justify-center rounded-full"
              onPress={startNewChat}
              style={({ pressed }) => ({
                width: FOOTER_ICON_SIZE,
                height: FOOTER_ICON_SIZE,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <SquarePen color={theme.text} size={19} strokeWidth={2} />
            </Pressable>
            <Pressable
              accessibilityLabel="Settings"
              accessibilityRole="button"
              className="items-center justify-center rounded-full"
              onPress={() => {
                setSearchOpen(false);
                openRoute("/settings");
              }}
              style={({ pressed }) => ({
                width: FOOTER_ICON_SIZE,
                height: FOOTER_ICON_SIZE,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Settings color={theme.text} size={20} strokeWidth={2} />
            </Pressable>
          </CapsuleContainer>
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

/**
 * "Bot" sidebar shortcut — direct link to the bot console (`/bot`), where
 * Bot Mode / Agent Mode switching and the command builder live. Bespoke
 * tile design (icon well + accent ring), with active-route highlighting
 * consistent with the rest of the navigation.
 */
function BotSidebarTile({ active, onPress }: { active: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      className="flex-row items-center gap-sp-3 rounded-3xl border-2 p-sp-3"
      style={{
        borderColor: active ? theme.accent : withAlpha(theme.accent, 0.35),
        backgroundColor: active ? withAlpha(theme.accent, 0.16) : withAlpha(theme.accent, 0.07),
      }}
    >
      <View
        className="h-10 w-10 items-center justify-center rounded-2xl"
        style={{ backgroundColor: withAlpha(theme.accent, active ? 0.35 : 0.22) }}
      >
        <Bot color={theme.accent} size={22} strokeWidth={2.2} />
      </View>
      <View className="min-w-0 flex-1">
        <Text
          className="font-sans text-foreground dark:text-foreground-dark"
          style={{ fontSize: 16, fontWeight: "600" }}
        >
          Bot
        </Text>
        <Text
          className="font-sans text-muted-foreground dark:text-muted-foreground-dark"
          style={{ fontSize: 13 }}
        >
          Console · modes · commands
        </Text>
      </View>
      {active ? (
        <View className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: theme.accent }} />
      ) : null}
    </Pressable>
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

function ConversationRow({
  active,
  conversation,
  leadingIcon,
  onRename,
  onSelect,
  pinned,
  pinnedCount,
  run,
}: {
  active: boolean;
  conversation: Conversation;
  leadingIcon?: boolean;
  onRename: () => void;
  onSelect: () => void;
  pinned: boolean;
  pinnedCount: number;
  run?: { startedAt: string };
}) {
  const theme = useTheme();
  const { deleteConversation, setConversationPinned } = useChat();
  const elapsed = useElapsedSeconds(
    run?.startedAt ?? conversation.createdAt,
    Boolean(run),
  );
  const [highlighted, setHighlighted] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<MenuAnchor | null>(null);
  const rowRef = useRef<View>(null);
  const longPressFired = useRef(false);
  const pinDisabled = !pinned && pinnedCount >= 3;

  return (
    <View>
      <Pressable
        ref={rowRef}
        accessibilityRole="button"
        delayLongPress={350}
        onPress={onSelect}
        onLongPress={() => {
          longPressFired.current = true;
          setHighlighted(true);
        }}
        onPressOut={() => {
          if (!longPressFired.current) return;
          longPressFired.current = false;
          setHighlighted(false);
          rowRef.current?.measureInWindow((x, y, width, height) => {
            setMenuAnchor({ x, y, width, height });
            setMenuOpen(true);
          });
        }}
        className="min-w-0 w-full flex-row items-center"
        style={{
          gap: 14,
          paddingVertical: 9,
          paddingHorizontal: 8,
          backgroundColor: highlighted
            ? withAlpha(theme.accent, 0.22)
            : active
              ? theme.backgroundSelected
              : "transparent",
        }}
      >
        {leadingIcon ? (
          <MessageCircle color={theme.text} size={22} strokeWidth={2} />
        ) : null}
        <Text
          numberOfLines={1}
          className="flex-1 font-sans text-foreground dark:text-foreground-dark"
          style={{ fontSize: 16, fontWeight: "400" }}
        >
          {conversation.title}
        </Text>
        {run ? (
          <Text className="px-sp-1 font-mono text-xs text-muted-foreground dark:text-muted-foreground-dark">
            {elapsed}s
          </Text>
        ) : null}
      </Pressable>
      <MessageMenu
        actions={[
          {
            key: "pin",
            label: pinned ? "Unpin" : "Pin",
            icon: pinned ? (
              <PinOff color={theme.text} size={18} />
            ) : (
              <Pin color={theme.text} size={18} />
            ),
            disabled: pinDisabled,
            onPress: () => {
              setConversationPinned(conversation.id, !pinned).catch(
                console.error,
              );
            },
          },
          {
            key: "rename",
            label: "Rename",
            icon: <Pencil color={theme.text} size={18} />,
            onPress: onRename,
          },
          {
            key: "delete",
            label: "Delete",
            icon: <Trash2 color={theme.destructive} size={18} />,
            destructive: true,
            onPress: () => {
              deleteConversation(conversation.id).catch(console.error);
            },
          },
        ]}
        align="end"
        anchor={menuAnchor}
        dateLabel={formatMessageDate(conversation.updatedAt)}
        onClose={() => {
          setMenuOpen(false);
        }}
        visible={menuOpen}
      />
    </View>
  );
}


