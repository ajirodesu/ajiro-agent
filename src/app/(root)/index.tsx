import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { Image } from "expo-image";
import * as IntentLauncher from "expo-intent-launcher";
import type { PasteEventPayload } from "expo-paste-input";
import { useRouter, useFocusEffect } from "expo-router";
import {
  ArrowDown,
  Bookmark,
  Box,
  Brain,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  FolderOpen,
  Paperclip,
  Server,
  Sparkle,
  Sun,
  Trash2,
  Upload,
  X,
} from "lucide-react-native";
import { Path, Svg } from "react-native-svg";
import Animated from "react-native-reanimated";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Platform,
  Pressable,
  Text,
  TextInput,
  ScrollView,
  View,
  useWindowDimensions,
} from "react-native";
import {
  KeyboardAvoidingView,
  KeyboardController,
} from "react-native-keyboard-controller";

import { Container } from "@/components/shared/container";
import { SkillImportDrawer } from "@/components/skills/skill-import-drawer";
import { ComposerSkillsModal } from "@/components/skills/composer-skills-modal";
import { ComposerModelModal } from "@/components/models/composer-model-modal";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment";
import { Button } from "@/components/ui/button";
import { ChatErrorBoundary } from "@/components/ui/chat-error-boundary";
import { ChatMessage } from "@/components/ui/chat-message";
import { ComposerCapsule } from "@/components/ui/composer-capsule";
import { ComposerContextSheet } from "@/components/ui/composer-context-sheet";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Questionnaire } from "@/components/ui/questionnaire";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerList,
  MessageScrollerProvider,
  useMessageScrollerActions,
  useMessageScrollerContext,
} from "@/components/ui/message-scroller";
import { Separator } from "@/components/ui/separator";
import { useSidebar } from "@/components/ui/sidebar";
import {
  AppHeader,
  CapsuleContainer,
  CONTAINER_BORDER,
  HeaderShadow,
  ICON_INNER,
} from "@/components/ui/chrome";
import {
  ContextUsageDrawer,
  UsageCapsule,
  useContextUsage,
} from "@/components/ui/context-usage";
import type { CompactConversationResult } from "@/providers/app-state";
import { consumeSidebarReturnPending } from "@/modules/navigation/sidebar-return";
import { isFolderPickerCancellation } from "@/core/services/external-folder/external-folder-service";
import { resolveWorkspaceFile } from "@/core/services/workspace-file-service";
import type {
  AgentConfig,
  Conversation,
  ExternalFolderSession,
  McpServerConfig,
  ModelRef,
  ReasoningEffort,
  SavedPrompt,
  SkillConfig,
  SkillMode,
  StoredMessage,
  ToolApprovalMode,
  WebSearchMode,
  WorkspaceFile,
} from "@/core/types/app-state";
import { listPrimaryAgents, resolveAgent } from "@/modules/agents/registry";
import { cn } from "@/core/utils";
import { useAppState } from "@/hooks/use-app-state";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useChat } from "@/hooks/use-chat";
import { useIdeWorkspace } from "@/providers/ide-workspace";
import { useConfig } from "@/hooks/use-config";
import { useTheme } from "@/hooks/use-theme";
import { detectFolderIntent } from "@/modules/chat/folder-intent";
import {
  buildCaptureFileName,
  capturePhoto,
  IMAGE_CAPTURE_ACTION,
} from "@/modules/device/camera-capture";
import { partitionSelectedFiles } from "@/modules/runtime/message-conversion";

const REASONING_EFFORT_OPTIONS: {  value: ReasoningEffort;
  label: string;
  description: string;
}[] = [
  {
    value: "none",
    label: "Off",
    description: "Do not request model reasoning",
  },
  {
    value: "minimal",
    label: "Minimal",
    description: "Use the lowest available reasoning level",
  },
  { value: "low", label: "Low", description: "Use light reasoning" },
  {
    value: "medium",
    label: "Medium",
    description: "Balance reasoning quality and speed (default)",
  },
  { value: "high", label: "High", description: "Use deeper reasoning" },
  {
    value: "xhigh",
    label: "Extra high",
    description: "Use the highest available reasoning level",
  },
];

// Effort picker shown from the composer + menu: the five selectable effort
// levels. (The legacy REASONING_EFFORT_OPTIONS above stays for label lookup
// of older stored values like Off/Minimal.)
const EFFORT_OPTIONS: {
  value: ReasoningEffort;
  label: string;
  description: string;
}[] = [
  { value: "low", label: "Low", description: "Fast answers, light reasoning" },
  {
    value: "medium",
    label: "Medium",
    description: "Balance reasoning quality and speed (default)",
  },
  { value: "high", label: "High", description: "Deeper reasoning, slower" },
  {
    value: "xhigh",
    label: "Extra",
    description: "Maximum reasoning before Max",
  },
  {
    value: "max",
    label: "Max",
    description: "Highest effort the model supports",
  },
];

function getReasoningEffortLabel(effort: ReasoningEffort) {
  return (
    EFFORT_OPTIONS.find((option) => option.value === effort)?.label ??
    REASONING_EFFORT_OPTIONS.find((option) => option.value === effort)?.label ??
    "Medium"
  );
}

function getComposerTrigger(prompt: string) {
  const match = /(^|\s)([@/])([^\s@/]*)$/.exec(prompt);

  if (!match) {
    return null;
  }

  return {
    kind: match[2] === "@" ? "mention" : "slash",
    query: match[3].toLowerCase(),
  } as const;
}

function clearComposerTrigger(prompt: string) {
  return prompt.replace(/(^|\s)[@/][^\s@/]*$/, "$1").replace(/\s+$/, "");
}

function matchesMenuQuery(
  query: string,
  label: string,
  subtitle?: string,
  keywords: string[] = [],
) {
  if (!query) {
    return true;
  }

  const haystack = [label, subtitle ?? "", ...keywords].join(" ").toLowerCase();
  return haystack.includes(query);
}

const EMPTY_STATE_CARDS: {
  title: string;
  desc: string;
  icon: "chevron" | "clock" | "sun" | "box";
  prompt: string;
  action: "send" | "sidebar";
}[] = [
  {
    title: "Start a task",
    desc: "Give it a goal and let it plan and act",
    icon: "chevron",
    prompt: "Start a task",
    action: "send",
  },
  {
    title: "Resume a session",
    desc: "Pick up where a past chat left off",
    icon: "clock",
    prompt: "Resume a session",
    action: "sidebar",
  },
  {
    title: "Ask anything",
    desc: "Research, write, analyze, or explain",
    icon: "sun",
    prompt: "Ask anything",
    action: "send",
  },
  {
    title: "Automate a workflow",
    desc: "Connect tools and let it run the steps",
    icon: "box",
    prompt: "Automate a workflow",
    action: "send",
  },
];

function SuggestionCard({
  card,
  onPress,
}: {
  card: (typeof EMPTY_STATE_CARDS)[number];
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className="flex-col"
      style={({ pressed }) => ({
        width: "48%",
        flexGrow: 1,
        gap: 4,
        padding: 14,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: "#2A2A2A",
        backgroundColor: pressed ? "#2A2A2A" : "#212121",
      })}
    >
      {card.icon === "chevron" ? (
        <ChevronRight color="#8E8E93" size={17} strokeWidth={1.6} />
      ) : card.icon === "clock" ? (
        <Clock color="#8E8E93" size={17} strokeWidth={1.6} />
      ) : card.icon === "sun" ? (
        <Sun color="#8E8E93" size={17} strokeWidth={1.6} />
      ) : (
        <Box color="#8E8E93" size={17} strokeWidth={1.6} />
      )}
      <Text
        className="font-sans"
        style={{ fontSize: 13, fontWeight: "500", color: "#ECECEC" }}
      >
        {card.title}
      </Text>
      <Text
        numberOfLines={2}
        className="font-sans"
        style={{ fontSize: 12, color: "#8E8E93", lineHeight: 16 }}
      >
        {card.desc}
      </Text>
    </Pressable>
  );
}

const EMPTY_WORKSPACE_FILES: WorkspaceFile[] = [];

function messageKeyExtractor(message: StoredMessage) {
  return message.id;
}

function messageItemType(message: StoredMessage) {
  return message.role;
}

function MessageListFooter() {
  return <View className="h-sp-1" />;
}

function logComposerDebug(label: string, data: Record<string, unknown>) {
  if (!__DEV__) {
    return;
  }
  console.log(`[Composer:${label}]`, JSON.stringify(data));
}

/**
 * Composer width behavior (chat-ui.html proportional spec + reference photo):
 * horizontal margin = 9.45% of the screen width on each side, keyboard open
 * or closed. The capsule's own viewport cap lives in ComposerCapsule.
 */
const COMPOSER_MARGIN_RATIO = 0.0945;

function useSyncedComposerSelection() {
  const [selection, setSelection] = useState({ end: 0, start: 0 });
  const [pendingCursor, setPendingCursor] = useState<number | null>(null);
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  const onSelectionChange = useCallback(
    (event: { nativeEvent: { selection: { end: number; start: number } } }) => {
      const next = event.nativeEvent.selection;
      // Avoid re-renders when nothing actually moved.
      setSelection((current) =>
        current.start === next.start && current.end === next.end
          ? current
          : { end: next.end, start: next.start },
      );

      // Once the native selection lands on the requested cursor, stop
      // controlling it so normal typing works untouched.
      setPendingCursor((requested) =>
        requested === null || requested === next.start ? null : requested,
      );
    },
    [],
  );

  const requestCursor = useCallback((cursor: number) => {
    setPendingCursor(cursor);
  }, []);

  return {
    onSelectionChange,
    requestCursor,
    selection,
    selectionRef,
    selectionProp:
      pendingCursor === null
        ? undefined
        : { end: pendingCursor, start: pendingCursor },
  };
}

export default function Screen() {
  const router = useRouter();
  const theme = useTheme();
  const { error, ready } = useAppState();
  const { setOpen: setSidebarOpen } = useSidebar();

  // When the user backs out of a screen opened from the sidebar (Settings,
  // Projects, MCP servers, ...), land on the open sidebar instead of the
  // collapsed main page.
  useFocusEffect(
    useCallback(() => {
      if (consumeSidebarReturnPending()) {
        setSidebarOpen(true);
      }
    }, [setSidebarOpen]),
  );

  const {
    activeModels,
    currentModel,
    currentModelSupportsImageGeneration,
    currentModelSupportsImageInput,
    currentModelSupportsTools,
    currentSelectedMcpServerIds,
    mcpServers,
    selectModel,
    setCurrentSelectedMcpServerIds,
    toolApprovalMode,
    updateToolApprovalMode,
  } = useConfig();
  const {
    approvePendingToolApproval,
    approveSessionPendingToolApproval,
    denyPendingToolApproval,
    clearConversationFolder,
    clearWorkspaceFiles,
    compactConversation,
    deleteWorkspaceFile,
    currentConversation,
    currentConversationRunStatus,
    currentExternalFolderSession,
    currentSelectedFileIds,
    currentSelectedSkillIds,
    deleteMessage,
    editAndResendMessage,
    messages,
    pendingToolApproval,
    pendingQuestionnaire,
    pickConversationFolder,
    sendMessage,
    stopSending,
    submitPendingQuestionnaire,
    dismissPendingQuestionnaire,
    createConversation,
    setCurrentSelectedFileIds,
    setCurrentSelectedSkillIds,
    skills,
    workspaceFiles,
    importFiles,
    refreshWorkspaceFiles,
    reasoningEffort,
    savedPrompts,
    setReasoningEffort,
    agents,
    currentSelectedAgentId,
    conversationAgentName,
    setConversationAgent,
    updateConversationModes,
  } = useChat();
  const currentConversationBusy =
    currentConversationRunStatus === "queued" ||
    currentConversationRunStatus === "running" ||
    currentConversationRunStatus === "waiting_for_approval" ||
    currentConversationRunStatus === "waiting_for_question" ||
    currentConversationRunStatus === "resumable" ||
    currentConversationRunStatus === "retrying";
  const contextUsage = useContextUsage();
  const [contextDrawerOpen, setContextDrawerOpen] = useState(false);
  const [compactState, setCompactState] = useState<
    "idle" | "working" | "done" | "error"
  >("idle");
  const [compactResult, setCompactResult] =
    useState<CompactConversationResult | null>(null);

  const handleCompact = useCallback(async () => {
    setCompactState("working");
    setCompactResult(null);

    try {
      const result = await compactConversation();
      setCompactResult(result);
      setCompactState(result.compacted ? "done" : "error");
    } catch (error) {
      setCompactResult({
        compacted: false,
        reason:
          error instanceof Error ? error.message : "Compaction failed.",
      });
      setCompactState("error");
    }
  }, [compactConversation]);

  // System-role messages (e.g. persisted compaction summaries) drive future
  // runs through the context pipeline but must never render as chat bubbles.
  const visibleMessages = useMemo(
    () => messages.filter((message) => message.role !== "system"),
    [messages],
  );
  const latestUserMessageId = useMemo(
    () =>
      [...messages].reverse().find((message) => message.role === "user")?.id ??
      null,
    [messages],
  );
  const latestUserMessageIdRef = useRef(latestUserMessageId);
  latestUserMessageIdRef.current = latestUserMessageId;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<string | null>(null);
  const [editNonce, setEditNonce] = useState(0);
  const [seedDraft, setSeedDraft] = useState<string | null>(null);
  const [seedNonce, setSeedNonce] = useState(0);
  const [historyDrawerMessageId, setHistoryDrawerMessageId] = useState<
    string | null
  >(null);

  useEffect(() => {
    setEditDraft(null);
    setEditingMessageId(null);
    setSeedDraft(null);
  }, [currentConversation?.id]);

  const handleEditMessage = useCallback((content: string) => {
    setEditDraft(content);
    setEditNonce((current) => current + 1);
    setEditingMessageId(latestUserMessageIdRef.current);
  }, []);
  const handleDeleteMessage = useCallback(
    async (message: StoredMessage) => {
      try {
        await deleteMessage(message.id);
      } catch (error) {
        Alert.alert(
          "Delete failed",
          error instanceof Error ? error.message : "Could not delete the message.",
        );
      }
    },
    [deleteMessage],
  );
  const handleRegenerateMessage = useCallback(
    async (assistantMessage: StoredMessage) => {
      if (currentConversationBusy) {
        return;
      }
      const ordered = [...messagesRef.current];
      const assistantIndex = ordered.findIndex(
        (item) => item.id === assistantMessage.id,
      );
      for (let index = assistantIndex - 1; index >= 0; index -= 1) {
        const candidate = ordered[index];
        if (candidate.role === "user") {
          try {
            await editAndResendMessage(candidate.id, candidate.content);
          } catch (retryError) {
            Alert.alert(
              "Retry failed",
              retryError instanceof Error
                ? retryError.message
                : "Could not resend the message.",
            );
          }
          return;
        }
      }
    },
    [currentConversationBusy, editAndResendMessage],
  );
  const handleEditAiText = useCallback((content: string) => {
    setSeedDraft(content);
    setSeedNonce((current) => current + 1);
  }, []);
  const handleSavePrompt = useCallback(
    (content: string) => {
      router.push({
        pathname: "/settings/prompts",
        params: { text: content },
      } as never);
    },
    [router],
  );
  const handleEditSend = useCallback(
    async (content: string) => {
      const message = messagesRef.current.find(
        (item) => item.id === editingMessageId,
      );

      if (!message) {
        setEditingMessageId(null);
        return;
      }

      const hasSideEffects = messagesRef.current.some(
        (candidate) =>
          candidate.role === "assistant" &&
          candidate.sequence > message.sequence &&
          Boolean(
            candidate.metadata?.toolExecutions?.length ||
            candidate.metadata?.memoryEvents?.length ||
            candidate.metadata?.promptArtifacts?.length ||
            candidate.metadata?.generatedImages?.length,
          ),
      );
      const performEdit = async () => {
        try {
          await editAndResendMessage(message.id, content);
          setEditDraft(null);
          setEditNonce((current) => current + 1);
          setEditingMessageId(null);
        } catch (error) {
          Alert.alert(
            "Edit failed",
            error instanceof Error
              ? error.message
              : "Failed to resend message.",
          );
        }
      };

      if (hasSideEffects) {
        Alert.alert(
          "Previous actions are not undone",
          "Files, memory changes, and other tool actions from the previous response may remain and could run again.",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Continue",
              onPress: () => {
                void performEdit();
              },
            },
          ],
        );
        return;
      }

      await performEdit();
    },
    [editAndResendMessage, editingMessageId],
  );
  const handleRetryMessage = useCallback(
    async (failedMessage: StoredMessage) => {
      if (currentConversationBusy) {
        return;
      }

      const ordered = [...messagesRef.current];
      const failedIndex = ordered.findIndex(
        (item) => item.id === failedMessage.id,
      );

      for (let index = failedIndex - 1; index >= 0; index -= 1) {
        const candidate = ordered[index];

        if (candidate.role === "user") {
          try {
            await editAndResendMessage(candidate.id, candidate.content);
          } catch (retryError) {
            Alert.alert(
              "Retry failed",
              retryError instanceof Error
                ? retryError.message
                : "Could not resend the message.",
            );
          }
          return;
        }
      }
    },
    [currentConversationBusy, editAndResendMessage],
  );
  const handleOpenSettings = useCallback(() => {
    router.push("/settings");
  }, [router]);
  const handleOpenMcpSettings = useCallback(() => {
    router.push("/settings/mcp" as never);
  }, [router]);
  const renderMessage = useCallback(
    ({ item: message }: { item: StoredMessage }) => (
      <ChatMessage
        canEditAndResend={
          message.id === latestUserMessageId && !currentConversationBusy
        }
        message={message}
        onDeleteMessage={
          message.status === "streaming" || currentConversationBusy
            ? undefined
            : () => {
                handleDeleteMessage(message).catch(console.error);
              }
        }
        onEditMessage={handleEditMessage}
        onEditText={
          message.role === "assistant" && message.content.trim()
            ? () => {
                handleEditAiText(message.content);
              }
            : undefined
        }
        onInterrupt={() => {
          stopSending().catch(console.error);
        }}
        onOpenHistory={() => {
          setHistoryDrawerMessageId(message.id);
        }}
        onRegenerate={
          message.role === "assistant" &&
          message.status === "completed" &&
          !currentConversationBusy
            ? () => {
                handleRegenerateMessage(message).catch(console.error);
              }
            : undefined
        }
        onRetry={
          message.status === "failed" && !currentConversationBusy
            ? () => {
                handleRetryMessage(message).catch(console.error);
              }
            : undefined
        }
        onSavePrompt={handleSavePrompt}
        workspaceFiles={
          message.metadata?.selectedFileIds?.length
            ? workspaceFiles
            : EMPTY_WORKSPACE_FILES
        }
      />
    ),
    [
      currentConversationBusy,
      handleDeleteMessage,
      handleEditAiText,
      handleEditMessage,
      handleRegenerateMessage,
      handleRetryMessage,
      handleSavePrompt,
      latestUserMessageId,
      stopSending,
      workspaceFiles,
    ],
  );
  const chatInputModelOptions = useMemo(
    () =>
      activeModels.map((model) => ({
        label: model.label,
        providerLabel: model.providerLabel,
        ref: model.ref,
      })),
    [activeModels],
  );

  return (
    <ChatErrorBoundary>
      <KeyboardAvoidingView behavior="padding" className="flex-1">
        <Container
          contentClassName="flex-1 gap-sp-4 !px-4"
          includeBottomTabInset={false}
        >
          <AppHeader
            left={
              <CapsuleContainer accessibilityLabel="Chat actions">
                <Pressable
                  accessibilityLabel="Open sidebar"
                  accessibilityRole="button"
                  onPress={() => {
                    setSidebarOpen(true);
                  }}
                  className="items-center justify-center rounded-full"
                  style={({ pressed }) => ({
                    width: ICON_INNER,
                    height: ICON_INNER,
                    opacity: pressed ? 0.8 : 1,
                  })}
                >
                  <Svg
                    width={24}
                    height={24}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke={theme.text}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <Path d="M3 8H21" />
                    <Path d="M3 16H16" />
                  </Svg>
                </Pressable>
                <Pressable
                  accessibilityLabel="Get Plus"
                  accessibilityRole="button"
                  onPress={() => {
                    router.push("/settings/providers");
                  }}
                  className="items-center justify-center rounded-full"
                  style={({ pressed }) => ({
                    width: ICON_INNER,
                    height: ICON_INNER,
                    opacity: pressed ? 0.8 : 1,
                  })}
                >
                  <Sparkle color={theme.accent} size={20} strokeWidth={2} />
                </Pressable>
              </CapsuleContainer>
            }
            right={
              <UsageCapsule
                expanded={messages.length > 0}
                percent={contextUsage.percent}
                onPressRing={() => {
                  setSidebarOpen(false);
                  setContextDrawerOpen(true);
                }}
                onNewChat={() => {
                  createConversation().catch(console.error);
                }}
              />
            }
          />

          <MessageScrollerProvider
            key={currentConversation?.id ?? "new-chat"}
            initialScrollToEnd
          >
            <View className="relative min-h-0 flex-1">
              <MessageScroller className="flex-1 rounded-none border-0">
              {!ready ? (
                <View
                  accessibilityLiveRegion="polite"
                  className="flex-1 items-center justify-center gap-sp-3"
                >
                  <ActivityIndicator color={theme.textSecondary} size="small" />
                  <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                    Loading chat…
                  </Text>
                </View>
              ) : visibleMessages.length === 0 && currentModel ? (
                <ScrollView
                  className="flex-1"
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={{
                    flexGrow: 1,
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 22,
                    paddingHorizontal: 30,
                  }}
                >
                  <Image
                    source={require("../../../assets/images/new-icon.png")}
                    contentFit="contain"
                    style={{
                      width: 62,
                      height: 62,
                      borderRadius: 14,
                      borderWidth: 1,
                      borderColor: theme.border,
                      backgroundColor: theme.backgroundElement,
                    }}
                  />
                  <View className="items-center" style={{ gap: 6 }}>
                    <Text
                      className="font-sans"
                      style={{
                        fontSize: 13,
                        fontWeight: "500",
                        color: "#8E8E93",
                        letterSpacing: 0.3,
                      }}
                    >
                      Ajiro Agent
                    </Text>
                    <Text
                      className="text-center font-sans"
                      style={{
                        fontSize: 25,
                        fontWeight: "500",
                        color: "#ECECEC",
                        letterSpacing: -0.25,
                        lineHeight: 33,
                      }}
                    >
                      What can I help with today?
                    </Text>
                    <Text
                      className="text-center font-sans"
                      style={{ fontSize: 14, color: "#8E8E93", lineHeight: 20 }}
                    >
                      Ask a question, plan something, or hand off a task.
                    </Text>
                  </View>
                  <View
                    className="w-full flex-row flex-wrap"
                    style={{ gap: 10, marginTop: 3 }}
                  >
                    {EMPTY_STATE_CARDS.map((card) => (
                      <SuggestionCard
                        key={card.title}
                        card={card}
                        onPress={() => {
                          if (card.action === "sidebar") {
                            setSidebarOpen(true);
                            return;
                          }
                          sendMessage({ content: card.prompt }).catch(
                            console.error,
                          );
                        }}
                      />
                    ))}
                  </View>
                </ScrollView>
              ) : (
                <>
                  <MessageScrollerList
                    contentContainerClassName="py-sp-3 pb-12"
                    data={visibleMessages}
                    getItemType={messageItemType}
                    keyExtractor={messageKeyExtractor}
                    renderItem={renderMessage}
                    showsVerticalScrollIndicator={false}
                    ListEmptyComponent={
                      <View className="px-sp-2 py-sp-8">
                        <Text className="font-sans text-base text-muted-foreground dark:text-muted-foreground-dark">
                          Connect a model to start chatting.
                        </Text>
                      </View>
                    }
                    ListFooterComponent={MessageListFooter}
                  />
                  {messages.length > 0 ? (
                    <MessageScrollerButton
                      accessibilityLabel="Jump to latest"
                      className="bottom-sp-2 left-1/2 right-auto -ml-5 h-10 w-10 rounded-full px-0"
                      style={{
                        borderWidth: CONTAINER_BORDER,
                        borderColor: theme.border,
                      }}
                    >
                      <ArrowDown color={theme.text} size={18} />
                    </MessageScrollerButton>
                  ) : null}
                </>
              )}
            </MessageScroller>
            <ChatHeaderShadow />
          </View>

            {error ? (
              <Text className="font-sans text-sm text-destructive dark:text-destructive-dark">
                {error}
              </Text>
            ) : null}

            {!currentModel && ready ? (
              <Button
                onPress={() => {
                  router.push("/settings");
                }}
                variant="outline"
              >
                Open settings
              </Button>
            ) : null}

            <ChatInput
              canSend={ready && currentModel !== null}
              currentModelLabel={
                currentModel
                  ? `${currentModel.providerLabel} · ${currentModel.label}`
                  : null
              }
              activeModels={chatInputModelOptions}
              currentModelRef={currentModel?.ref ?? null}
              editDraft={editDraft}
              editNonce={editNonce}
              seedDraft={seedDraft}
              seedNonce={seedNonce}
              importFiles={importFiles}
              loading={currentConversationBusy}
              onEditSend={handleEditSend}
              onCreateConversation={createConversation}
              onOpenSettings={handleOpenSettings}
              currentExternalFolderSession={currentExternalFolderSession}
              onSend={sendMessage}
              onStop={stopSending}
              pickConversationFolder={pickConversationFolder}
              clearConversationFolder={clearConversationFolder}
              clearWorkspaceFiles={clearWorkspaceFiles}
              deleteWorkspaceFile={deleteWorkspaceFile}
              refreshWorkspaceFiles={refreshWorkspaceFiles}
              selectModel={selectModel}
              selectedFileIds={currentSelectedFileIds}
              setSelectedFileIds={setCurrentSelectedFileIds}
              selectedSkillIds={currentSelectedSkillIds}
              setSelectedSkillIds={setCurrentSelectedSkillIds}
              skills={skills}
              supportsImageGeneration={currentModelSupportsImageGeneration}
              supportsImageInput={currentModelSupportsImageInput}
              supportsTools={currentModelSupportsTools}
              mcpServers={mcpServers}
              selectedMcpServerIds={currentSelectedMcpServerIds}
              setSelectedMcpServerIds={setCurrentSelectedMcpServerIds}
              onOpenMcpSettings={handleOpenMcpSettings}
              reasoningEffort={reasoningEffort}
              savedPrompts={savedPrompts}
              setReasoningEffort={setReasoningEffort}
              toolApprovalMode={toolApprovalMode}
              updateToolApprovalMode={updateToolApprovalMode}
              workspaceFiles={workspaceFiles}
              agents={agents}
              currentSelectedAgentId={currentSelectedAgentId}
              conversationAgentName={conversationAgentName}
              setConversationAgent={setConversationAgent}
              currentConversation={currentConversation}
              currentConversationId={currentConversation?.id ?? null}
              updateConversationModes={updateConversationModes}
              onOpenAgentSettings={() =>
                router.push("/settings/agents" as never)
              }
            />
          </MessageScrollerProvider>

          <Drawer dismissible={false} open={pendingToolApproval !== null}>
            <DrawerContent
              closeOnOverlayPress={false}
              showCloseButton={false}
              showHandle={false}
            >
              <DrawerHeader>
                <DrawerTitle>Tool approval required</DrawerTitle>
                <DrawerDescription>
                  The agent is paused in{" "}
                  {pendingToolApproval?.chatTitle ?? "this chat"} until you
                  review this request.
                </DrawerDescription>
              </DrawerHeader>
              <DrawerBody
                className="flex-0"
                contentContainerClassName="gap-sp-3"
              >
                <View className="gap-sp-2 rounded-ui border border-border bg-card px-sp-4 py-sp-3 dark:border-border-dark dark:bg-card-dark">
                  <Text className="font-sans text-sm font-medium text-foreground dark:text-foreground-dark">
                    {formatToolName(pendingToolApproval?.toolName ?? "")}
                  </Text>
                  {pendingToolApproval?.inputSummary ? (
                    <Text className="font-mono text-xs text-muted-foreground dark:text-muted-foreground-dark">
                      {pendingToolApproval.inputSummary}
                    </Text>
                  ) : null}
                </View>
              </DrawerBody>
              <DrawerFooter>
                <View className="gap-sp-2">
                  <View className="flex-row gap-sp-2">
                    <Button
                      className="flex-1"
                      onPress={denyPendingToolApproval}
                      variant="outline"
                    >
                      Deny
                    </Button>
                    <Button
                      className="flex-1"
                      onPress={approvePendingToolApproval}
                    >
                      Approve
                    </Button>
                  </View>
                  <Button
                    className="w-full"
                    onPress={approveSessionPendingToolApproval}
                    variant="secondary"
                  >
                    Approve for this session
                  </Button>
                </View>
              </DrawerFooter>
            </DrawerContent>
          </Drawer>

          {pendingQuestionnaire ? (
            <Questionnaire
              key={pendingQuestionnaire.id}
              questionnaire={pendingQuestionnaire}
              onDismiss={dismissPendingQuestionnaire}
              onSubmit={submitPendingQuestionnaire}
            />
          ) : null}

          <Drawer
            onOpenChange={(open) => {
              if (!open) {
                setHistoryDrawerMessageId(null);
              }
            }}
            open={historyDrawerMessageId !== null}
          >
            <DrawerContent showCloseButton showHandle size={520}>
              <DrawerHeader>
                <DrawerTitle>Step history</DrawerTitle>
                <DrawerDescription>
                  Everything the agent did during this run, in order.
                </DrawerDescription>
              </DrawerHeader>
              <DrawerBody
                contentContainerClassName="gap-sp-2 pb-sp-4"
              >
                {(() => {
                  const historyMessage = messages.find(
                    (candidate) => candidate.id === historyDrawerMessageId,
                  );
                  const events =
                    historyMessage?.metadata?.executionTimeline ?? [];

                  if (events.length === 0) {
                    return (
                      <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                        No steps recorded for this run yet.
                      </Text>
                    );
                  }

                  return events.map((event, index) => (
                    <View
                      key={event.id}
                      className="gap-1 rounded-ui border border-border bg-card px-sp-3 py-sp-2 dark:border-border-dark dark:bg-card-dark"
                    >
                      <View className="flex-row items-center justify-between gap-sp-2">
                        <Text className="flex-1 font-sans text-sm font-medium text-foreground dark:text-foreground-dark">
                          {index + 1}. {event.title}
                        </Text>
                        <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                          {event.status}
                        </Text>
                      </View>
                      {event.detail ? (
                        <Text
                          className="font-mono text-xs text-muted-foreground dark:text-muted-foreground-dark"
                          numberOfLines={4}
                          selectable
                        >
                          {event.detail}
                        </Text>
                      ) : null}
                    </View>
                  ));
                })()}
              </DrawerBody>
            </DrawerContent>
          </Drawer>

          <ContextUsageDrawer
            compactResult={compactResult}
            compactState={compactState}
            onCompact={handleCompact}
            onOpenChange={setContextDrawerOpen}
            open={contextDrawerOpen}
            usage={contextUsage}
          />
        </Container>
      </KeyboardAvoidingView>
    </ChatErrorBoundary>
  );
}

function formatToolName(toolName: string) {
  if (!toolName) {
    return "Tool";
  }

  return toolName
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function ChatHeaderShadow() {
  const { scrollable } = useMessageScrollerContext();
  return <HeaderShadow visible={scrollable.start} />;
}

const ChatInput = memo(function ChatInput({
  activeModels,
  canSend,
  currentExternalFolderSession,
  currentModelLabel,
  currentModelRef,
  editDraft,
  editNonce,
  seedDraft,
  seedNonce,
  importFiles,
  loading,
  mcpServers,
  onCreateConversation,
  onEditSend,
  onOpenMcpSettings,
  onOpenSettings,
  onSend,
  onStop,
  pickConversationFolder,
  clearConversationFolder,
  clearWorkspaceFiles,
  deleteWorkspaceFile,
  refreshWorkspaceFiles,
  selectModel,
  selectedFileIds,
  selectedMcpServerIds,
  setSelectedMcpServerIds,
  selectedSkillIds,
  setSelectedFileIds,
  setSelectedSkillIds,
  skills,
  supportsImageGeneration,
  supportsImageInput,
  supportsTools,
  reasoningEffort,
  savedPrompts,
  setReasoningEffort,
  toolApprovalMode,
  updateToolApprovalMode,
  workspaceFiles,
  agents,
  currentSelectedAgentId,
  conversationAgentName,
  setConversationAgent,
  currentConversation,
  currentConversationId,
  updateConversationModes,
  onOpenAgentSettings,
}: {
  activeModels: {
    label: string;
    providerLabel: string;
    ref: ModelRef;
  }[];
  canSend: boolean;
  clearConversationFolder: () => Promise<void>;
  clearWorkspaceFiles: () => Promise<void>;
  deleteWorkspaceFile: (fileId: string) => Promise<void>;
  currentExternalFolderSession: ExternalFolderSession | null;
  currentModelLabel: string | null;
  currentModelRef: ModelRef | null;
  editDraft: string | null;
  editNonce: number;
  seedDraft: string | null;
  seedNonce: number;
  importFiles: typeof useChat extends () => infer T
    ? T extends { importFiles: infer F }
      ? F
      : never
    : never;
  loading: boolean;
  mcpServers: McpServerConfig[];
  onCreateConversation: () => Promise<void>;
  onEditSend: (content: string) => Promise<void>;
  onOpenMcpSettings: () => void;
  onOpenSettings: () => void;
  onSend: (input: {
    content: string;
    fileContextSource?: "external-folder" | "workspace";
    selectedFileIds?: string[];
  }) => Promise<void>;
  onStop: () => Promise<void>;
  pickConversationFolder: () => Promise<ExternalFolderSession>;
  refreshWorkspaceFiles: () => Promise<void>;
  selectModel: (modelRef: ModelRef) => Promise<void>;
  selectedFileIds: string[];
  selectedMcpServerIds: string[] | null;
  setSelectedMcpServerIds: (
    selectedMcpServerIds: string[] | null,
  ) => Promise<void>;
  selectedSkillIds: string[];
  setSelectedFileIds: (selectedFileIds: string[]) => Promise<void>;
  setSelectedSkillIds: (selectedSkillIds: string[]) => Promise<void>;
  skills: SkillConfig[];
  supportsImageGeneration: boolean;
  supportsImageInput: boolean;
  supportsTools: boolean;
  reasoningEffort: ReasoningEffort;
  savedPrompts: SavedPrompt[];
  setReasoningEffort: (effort: ReasoningEffort) => Promise<void>;
  toolApprovalMode: ToolApprovalMode;
  updateToolApprovalMode: (mode: ToolApprovalMode) => Promise<void>;
  workspaceFiles: WorkspaceFile[];
  agents: AgentConfig[];
  currentSelectedAgentId: string | null;
  conversationAgentName: string;
  setConversationAgent: (
    conversationId: string,
    agentIdOrName: string | null,
  ) => Promise<void>;
  currentConversation: Conversation | null;
  currentConversationId: string | null;
  updateConversationModes: (
    conversationId: string,
    input: { skillMode?: SkillMode; webSearchMode?: WebSearchMode },
  ) => Promise<void>;
  onOpenAgentSettings: () => void;
}) {
  const theme = useTheme();
  const { height: screenHeight, width: screenWidth } = useWindowDimensions();
  const composerSelection = useSyncedComposerSelection();
  const { accent: appAccent } = useAppTheme();
  const ideWorkspace = useIdeWorkspace();
  const { scrollToEnd } = useMessageScrollerActions();
  const sendingRef = useRef(false);
  const composerRef = useRef<TextInput>(null);
  const [prompt, setPrompt] = useState("");
  // Visible keyboard height so the growth cap tracks the space actually left
  // on screen (short devices, landscape, floating keyboards).
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [filesDrawerOpen, setFilesDrawerOpen] = useState(false);
  const [plusMenuDrawerOpen, setPlusMenuDrawerOpen] = useState(false);
  const [modelsDrawerOpen, setModelsDrawerOpen] = useState(false);
  const [agentsDrawerOpen, setAgentsDrawerOpen] = useState(false);
  const [skillsDrawerOpen, setSkillsDrawerOpen] = useState(false);
  const [skillImportOpen, setSkillImportOpen] = useState(false);
  const [mcpServersDrawerOpen, setMcpServersDrawerOpen] = useState(false);
  const [busyAction, setBusyAction] = useState<
    null | "clear" | "import" | "folder" | "paste"
  >(null);
  const [folderDrawerOpen, setFolderDrawerOpen] = useState(false);
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null);
  const [folderNotice, setFolderNotice] = useState<string | null>(null);
  const [slashMenuView, setSlashMenuView] = useState<
    "commands" | "saved-prompts"
  >("commands");
  const [localWorkspaceFiles, setLocalWorkspaceFiles] = useState<
    WorkspaceFile[]
  >([]);
  const [pendingFolderSend, setPendingFolderSend] = useState<null | {
    content: string;
    selectedFileIds: string[];
  }>(null);

  const primaryAgents = useMemo(() => listPrimaryAgents(agents), [agents]);

  useEffect(() => {
    if (editDraft !== null) {
      setPrompt(editDraft);
      const focusComposer = () => {
        composerRef.current?.focus();
        KeyboardController.setFocusTo("current");
      };

      focusComposer();
      const focusTimeout = setTimeout(() => {
        focusComposer();
      }, 320);

      return () => {
        clearTimeout(focusTimeout);
      };
    }

    setPrompt("");
  }, [editDraft, editNonce]);

  useEffect(() => {
    if (seedDraft !== null) {
      setPrompt(seedDraft);
      composerRef.current?.focus();
      KeyboardController.setFocusTo("current");
    }
  }, [seedDraft, seedNonce]);

  // Keyboard height drives the capsule's own viewport cap (inside
  // ComposerCapsule). Cursor and draft live in React state (prompt +
  // selection sync), so resizing never disturbs them.
  useEffect(() => {
    const showSubscription = Keyboard.addListener(
      "keyboardDidShow",
      (event) => {
        setKeyboardHeight(event.endCoordinates.height);
      },
    );
    const hideSubscription = Keyboard.addListener("keyboardDidHide", () => {
      setKeyboardHeight(0);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  const composerWidthStyle = {
    marginHorizontal: screenWidth * COMPOSER_MARGIN_RATIO,
  };

  const composerTrigger = useMemo(() => getComposerTrigger(prompt), [prompt]);
  const mergedWorkspaceFiles = useMemo(() => {
    const map = new Map(workspaceFiles.map((file) => [file.id, file]));

    for (const file of localWorkspaceFiles) {
      map.set(file.id, file);
    }

    return [...map.values()].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    );
  }, [localWorkspaceFiles, workspaceFiles]);
  const filesDrawerSize = Math.min(
    Math.floor(screenHeight * 0.9),
    Math.max(420, 380 + mergedWorkspaceFiles.length * 52),
  );

  useEffect(() => {
    setLocalWorkspaceFiles((current) =>
      current.filter(
        (file) => !workspaceFiles.some((item) => item.id === file.id),
      ),
    );
  }, [workspaceFiles]);

  useEffect(() => {
    if (composerTrigger?.kind !== "slash") {
      setSlashMenuView("commands");
    }
  }, [composerTrigger?.kind]);

  useEffect(() => {
    if (!filesDrawerOpen) {
      return;
    }

    refreshWorkspaceFiles().catch(console.error);
  }, [filesDrawerOpen, refreshWorkspaceFiles]);

  const selectedFiles = mergedWorkspaceFiles
    .filter((file) => selectedFileIds.includes(file.id))
    .sort(
      (left, right) =>
        selectedFileIds.indexOf(left.id) - selectedFileIds.indexOf(right.id),
    );
  const selectedAttachmentBuckets = useMemo(
    () => partitionSelectedFiles(selectedFiles),
    [selectedFiles],
  );
  const activeFolderLabel = currentExternalFolderSession?.displayName ?? null;
  const enabledSkills = skills.filter((skill) => skill.enabled);
  const selectedSkills = enabledSkills.filter((skill) =>
    selectedSkillIds.includes(skill.id),
  );
  const enabledMcpServers = mcpServers.filter((server) => server.enabled);
  const activeMcpServerIds = new Set(
    selectedMcpServerIds === null
      ? enabledMcpServers.map((server) => server.id)
      : selectedMcpServerIds.filter((serverId) =>
          enabledMcpServers.some((server) => server.id === serverId),
        ),
  );

  const toggleMcpServer = async (serverId: string) => {
    if (selectedMcpServerIds === null) {
      await setSelectedMcpServerIds(
        activeMcpServerIds.has(serverId)
          ? enabledMcpServers
              .map((server) => server.id)
              .filter((id) => id !== serverId)
          : [
              ...new Set([
                ...enabledMcpServers.map((server) => server.id),
                serverId,
              ]),
            ],
      );
      return;
    }

    await setSelectedMcpServerIds(
      activeMcpServerIds.has(serverId)
        ? selectedMcpServerIds.filter((id) => id !== serverId)
        : [...new Set([...selectedMcpServerIds, serverId])],
    );
  };

  const canAttachSelectedFiles =
    !(selectedAttachmentBuckets.imageFiles.length > 0 && !supportsImageInput) &&
    !(selectedAttachmentBuckets.binaryFiles.length > 0 && !supportsTools);

  const handleGenerate = async () => {
    if (sendingRef.current) {
      logComposerDebug("handle-generate-duplicate", {});
      return;
    }

    const cleanPrompt = prompt.trim();
    const folderIntent = detectFolderIntent(cleanPrompt);
    const nextFileContextSource =
      selectedFileIds.length > 0
        ? "workspace"
        : currentExternalFolderSession
          ? "external-folder"
          : folderIntent.requiresFolderAccess
            ? "external-folder"
            : "workspace";

    if (
      loading ||
      !canSend ||
      (!cleanPrompt && selectedFileIds.length === 0) ||
      !canAttachSelectedFiles
    ) {
      const reason = loading
        ? "loading"
        : !canSend
          ? "canSend"
          : !canAttachSelectedFiles
            ? "canAttachSelectedFiles"
            : "empty";
      logComposerDebug("handle-generate-blocked", {
        canAttachSelectedFiles,
        canSend,
        cleanPromptLength: cleanPrompt.length,
        hasSelectedFiles: selectedFileIds.length > 0,
        loading,
        promptLength: prompt.length,
        reason,
        selectedFileIds,
      });
      if (__DEV__) {
        Alert.alert(
          "Send blocked",
          `Reason: ${reason}\nloading: ${loading}\ncanSend: ${canSend}\ncanAttach: ${canAttachSelectedFiles}`,
        );
      }
      return;
    }

    const previousPrompt = prompt;
    const previousSelectedFileIds = selectedFileIds;

    if (folderIntent.requiresFolderAccess) {
      if (!supportsTools) {
        setFolderNotice(
          "Folder actions need an API-key-backed model. Switch models in Settings first.",
        );
        return;
      }

      if (Platform.OS !== "android") {
        setFolderNotice(
          "Picked-folder agent access is Android-only right now. Use @ file actions to work in the app workspace on this platform.",
        );
        return;
      }

      if (!currentExternalFolderSession) {
        setPendingFolderSend({
          content: cleanPrompt,
          selectedFileIds: previousSelectedFileIds,
        });
        setFolderDrawerOpen(true);
        setFolderNotice(null);
        return;
      }
    }

    sendingRef.current = true;
    setPrompt("");
    KeyboardController.dismiss();
    composerRef.current?.blur();

    try {
      await setSelectedFileIds([]);
      scrollToEnd();

      await onSend({
        content: cleanPrompt,
        fileContextSource: nextFileContextSource,
        selectedFileIds: previousSelectedFileIds,
      });
      requestAnimationFrame(() => {
        scrollToEnd();
      });
      setFolderNotice(null);
    } catch (sendError) {
      const errorMessage =
        sendError instanceof Error ? sendError.message : String(sendError);
      logComposerDebug("handle-generate-send-error", {
        message: errorMessage,
      });
      if (__DEV__) {
        Alert.alert("Send failed", errorMessage);
      }
      setPrompt(previousPrompt);
      await setSelectedFileIds(previousSelectedFileIds);
    } finally {
      sendingRef.current = false;
    }
  };

  const handleGrantFolderAccess = async () => {
    if (!pendingFolderSend) {
      return;
    }

    setBusyAction("folder");

    try {
      const session = await pickConversationFolder();

      setFolderDrawerOpen(false);
      setPendingFolderSend(null);
      setFolderNotice(`Using ${session.displayName} for this chat.`);
      setPrompt("");
      KeyboardController.dismiss();
      composerRef.current?.blur();
      await setSelectedFileIds([]);
      scrollToEnd();
      await onSend({
        content: pendingFolderSend.content,
        fileContextSource: "external-folder",
        selectedFileIds: pendingFolderSend.selectedFileIds,
      });
      requestAnimationFrame(() => {
        scrollToEnd();
      });
    } catch (error) {
      if (!isFolderPickerCancellation(error)) {
        setFolderNotice(
          error instanceof Error ? error.message : "Could not select folder.",
        );
      }
    } finally {
      setBusyAction(null);
    }
  };

  const handleImportFiles = async () => {
    if (busyAction) {
      return;
    }

    setBusyAction("import");

    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: true,
        type: "*/*",
      });

      if (!result.canceled && result.assets.length > 0) {
        const imported = await importFiles(result.assets);

        setLocalWorkspaceFiles((current) => {
          const map = new Map(current.map((file) => [file.id, file]));

          for (const file of imported) {
            map.set(file.id, file);
          }

          return [...map.values()];
        });
        await setSelectedFileIds([
          ...selectedFileIds,
          ...imported
            .map((file) => file.id)
            .filter((id) => !selectedFileIds.includes(id)),
        ]);
        setPrompt((current) => clearComposerTrigger(current));
      }
    } finally {
      setBusyAction(null);
    }
  };

  const runCameraCapture = async () => {
    if (busyAction) {
      return;
    }

    setBusyAction("import");

    try {
      const result = await capturePhoto({
        startCameraActivity: async () => {
          const launched = await IntentLauncher.startActivityAsync(
            IMAGE_CAPTURE_ACTION,
          );
          return {
            resultCode: launched.resultCode as number,
            data: launched.data ?? undefined,
          };
        },
      });

      if (!result.ok) {
        if (result.reason === "failed") {
          setFolderNotice(result.message);
        }
        return;
      }

      const fileName = buildCaptureFileName(Date.now());
      const imported = await importFiles([
        {
          uri: result.photoUri,
          name: fileName,
          mimeType: "image/jpeg",
          lastModified: Date.now(),
        },
      ]);

      setLocalWorkspaceFiles((current) => {
        const map = new Map(current.map((file) => [file.id, file]));

        for (const file of imported) {
          map.set(file.id, file);
        }

        return [...map.values()];
      });
      await setSelectedFileIds([
        ...selectedFileIds,
        ...imported
          .map((file) => file.id)
          .filter((id) => !selectedFileIds.includes(id)),
      ]);
      setPrompt((current) => clearComposerTrigger(current));
      setFolderNotice("Photo attached to this chat.");
    } finally {
      setBusyAction(null);
    }
  };

  const handlePaste = async (payload: PasteEventPayload) => {
    if (payload.type !== "images" || payload.uris.length === 0) return;

    if (busyAction || loading) return;

    if (!supportsImageInput) {
      Alert.alert(
        "Image input unavailable",
        "The selected model does not support image attachments.",
      );
      return;
    }

    setBusyAction("paste");

    try {
      const imported = await importFiles(
        payload.uris.map((uri, index) => {
          const file = new File(uri);

          return {
            lastModified: Date.now(),
            mimeType: file.type || "image/png",
            name: file.name || `pasted-image-${Date.now()}-${index + 1}.png`,
            size: file.size,
            uri,
          };
        }),
      );

      setLocalWorkspaceFiles((current) => {
        const map = new Map(current.map((file) => [file.id, file]));
        for (const file of imported) map.set(file.id, file);
        return [...map.values()];
      });
      await setSelectedFileIds([
        ...selectedFileIds,
        ...imported
          .map((file) => file.id)
          .filter((id) => !selectedFileIds.includes(id)),
      ]);
    } catch (error) {
      Alert.alert(
        "Could not paste image",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleClearWorkspaceFiles = () => {
    if (mergedWorkspaceFiles.length === 0 || busyAction || loading) {
      return;
    }

    Alert.alert(
      "Clear workspace files?",
      "This permanently deletes all uploaded, created, and generated workspace files.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear all",
          style: "destructive",
          onPress: () => {
            setBusyAction("clear");
            clearWorkspaceFiles()
              .then(() => {
                setLocalWorkspaceFiles([]);
                setFilesDrawerOpen(false);
              })
              .catch(console.error)
              .finally(() => {
                setBusyAction(null);
              });
          },
        },
      ],
    );
  };

  const handleDeleteUploadedFile = (file: WorkspaceFile) => {
    if (deletingFileId || loading) {
      return;
    }

    Alert.alert(
      "Delete uploaded file?",
      `${file.displayName} will be permanently deleted.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            setDeletingFileId(file.id);
            deleteWorkspaceFile(file.id)
              .then(() => {
                setLocalWorkspaceFiles((current) =>
                  current.filter((item) => item.id !== file.id),
                );
              })
              .catch(console.error)
              .finally(() => {
                setDeletingFileId(null);
              });
          },
        },
      ],
    );
  };

  const sendDisabled =
    !loading &&
    ((!prompt.trim() && selectedFileIds.length === 0) ||
      !canSend ||
      !canAttachSelectedFiles);
  const clearTriggerText = () => {
    setPrompt((current) => clearComposerTrigger(current));
  };
  const mentionMenuItems = useMemo(
    () =>
      [
        {
          id: "select-file",
          icon: <FolderOpen color={theme.text} size={16} />,
          label: "Select file",
          onPress: () => {
            clearTriggerText();
            setFilesDrawerOpen(true);
          },
          subtitle: "Choose an uploaded file or upload a new one",
          visible: true,
        },
        {
          disabled: !supportsTools,
          id: "select-folder",
          icon: <FolderOpen color={theme.text} size={16} />,
          label: activeFolderLabel ? "Switch folder" : "Select folder",
          onPress: () => {
            clearTriggerText();
            if (Platform.OS !== "android") {
              setFolderNotice(
                "Picked-folder access is Android-only right now.",
              );
              return;
            }

            setBusyAction("folder");
            pickConversationFolder()
              .then((session) => {
                setFolderNotice(`Using ${session.displayName} for this chat.`);
              })
              .catch((error) => {
                if (!isFolderPickerCancellation(error)) {
                  setFolderNotice(
                    error instanceof Error
                      ? error.message
                      : "Could not select folder.",
                  );
                }
              })
              .finally(() => {
                setBusyAction(null);
              });
          },
          subtitle: supportsTools
            ? (activeFolderLabel ?? "Use an external folder for this chat")
            : "Requires a tool-capable model",
          visible: Platform.OS === "android",
        },
        {
          id: "use-workspace",
          icon: <X color={theme.text} size={16} />,
          label: "Use workspace",
          onPress: () => {
            clearTriggerText();
            clearConversationFolder()
              .then(() => {
                setFolderNotice("Switched back to the workspace.");
              })
              .catch(console.error);
          },
          subtitle: "Stop using the external folder",
          visible: currentExternalFolderSession !== null,
        },
      ]
        .filter((item) => item.visible)
        .map(({ visible: _visible, ...item }) => item),
    [
      activeFolderLabel,
      clearConversationFolder,
      currentExternalFolderSession,
      pickConversationFolder,
      supportsTools,
      theme.text,
    ],
  );
  const slashMenuItems = useMemo(
    () => [
      {
        disabled: savedPrompts.length === 0,
        id: "saved-prompts",
        icon: <Bookmark color={theme.text} size={16} />,
        label: "Saved prompts",
        onPress: () => {
          setPrompt((current) => {
            const withoutTrigger = clearComposerTrigger(current);
            return withoutTrigger ? `${withoutTrigger} /` : "/";
          });
          setSlashMenuView("saved-prompts");
        },
        subtitle:
          savedPrompts.length > 0
            ? `${savedPrompts.length} saved prompt${savedPrompts.length === 1 ? "" : "s"}`
            : "No saved prompts",
      },
      {
        id: "reasoning-level",
        icon: <Brain color={theme.text} size={16} />,
        label: "Effort",
        onPress: () => {
          clearTriggerText();
          setPlusMenuDrawerOpen(true);
        },
        subtitle: getReasoningEffortLabel(reasoningEffort) + " for this chat",
      },
      {
        id: "select-skills",
        icon: <Brain color={theme.text} size={16} />,
        label: "Select skills",
        onPress: () => {
          clearTriggerText();
          setSkillsDrawerOpen(true);
        },
        subtitle:
          selectedSkills.length > 0
            ? `${selectedSkills.length} selected`
            : "Choose chat skills",
      },
      {
        id: "select-mcp-servers",
        icon: <Server color={theme.text} size={16} />,
        label: "Select MCP servers",
        onPress: () => {
          clearTriggerText();
          setMcpServersDrawerOpen(true);
        },
        subtitle:
          enabledMcpServers.length > 0
            ? `${activeMcpServerIds.size} of ${enabledMcpServers.length} servers for this chat`
            : "No enabled MCP servers",
      },
      {
        id: "select-model",
        icon: <Check color={theme.text} size={16} />,
        label: "Select model",
        onPress: () => {
          clearTriggerText();
          setModelsDrawerOpen(true);
        },
        subtitle: currentModelLabel ?? "Choose the current chat model",
      },
    ],
    [
      activeMcpServerIds.size,
      currentModelLabel,
      enabledMcpServers.length,
      reasoningEffort,
      savedPrompts.length,
      selectedSkills.length,
      theme.text,
    ],
  );
  const savedPromptMenuItems = useMemo(
    () => [
      {
        id: "saved-prompts-back",
        icon: <ChevronLeft color={theme.text} size={16} />,
        label: "Back",
        onPress: () => {
          setPrompt((current) => {
            const withoutTrigger = clearComposerTrigger(current);
            return withoutTrigger ? `${withoutTrigger} /` : "/";
          });
          setSlashMenuView("commands");
        },
        subtitle: "All commands",
      },
      ...savedPrompts.map((savedPrompt) => ({
        id: `saved-prompt:${savedPrompt.id}`,
        icon: <Bookmark color={theme.text} size={16} />,
        label: savedPrompt.title,
        onPress: () => {
          setPrompt((current) => {
            const withoutTrigger = clearComposerTrigger(current);
            return withoutTrigger
              ? `${withoutTrigger} ${savedPrompt.content}`
              : savedPrompt.content;
          });
        },
        subtitle: savedPrompt.content.replace(/\s+/g, " ").trim(),
      })),
    ],
    [savedPrompts, theme.text],
  );
  const triggerMenuItems = useMemo(() => {
    if (!composerTrigger) {
      return [];
    }

    const source =
      composerTrigger.kind === "mention"
        ? mentionMenuItems
        : slashMenuView === "saved-prompts"
          ? savedPromptMenuItems
          : slashMenuItems;

    return source.filter(
      (item) =>
        item.id === "saved-prompts-back" ||
        matchesMenuQuery(composerTrigger.query, item.label, item.subtitle, [
          item.id,
        ]),
    );
  }, [
    composerTrigger,
    mentionMenuItems,
    savedPromptMenuItems,
    slashMenuItems,
    slashMenuView,
  ]);

  const handleComposerSendPress = () => {
    if (sendDisabled) return;
    if (loading) {
      onStop().catch(console.error);
      return;
    }
    if (editDraft !== null) {
      const cleanEditPrompt = prompt.trim();
      if (!cleanEditPrompt) return;
      KeyboardController.dismiss();
      composerRef.current?.blur();
      onEditSend(cleanEditPrompt).catch(console.error);
      return;
    }
    handleGenerate().catch(console.error);
  };

  return (
    <Animated.View className="relative" style={[composerWidthStyle]}>
      <View className="gap-sp-3">
        {activeFolderLabel ? (
          <View className="self-start rounded-full border border-border bg-card px-sp-3 py-2 dark:border-border-dark dark:bg-card-dark">
            <View className="flex-row items-center gap-sp-2">
              <FolderOpen color={theme.textSecondary} size={14} />
              <Text className="font-sans text-xs text-foreground dark:text-foreground-dark">
                {activeFolderLabel}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  clearConversationFolder()
                    .then(() => {
                      setFolderNotice("Switched back to the workspace.");
                    })
                    .catch(console.error);
                }}
              >
                <X color={theme.textSecondary} size={14} />
              </Pressable>
            </View>
          </View>
        ) : null}

        {folderNotice ? (
          <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
            {folderNotice}
          </Text>
        ) : null}

        {selectedFiles.length > 0 ? (
          <View className="gap-sp-2">
            {selectedFiles.map((file) => (
              <Attachment key={file.id} size="xs">
                <AttachmentMedia className="overflow-hidden bg-secondary dark:bg-secondary-dark">
                  {file.mimeType?.startsWith("image/") ? (
                    <Image
                      contentFit="cover"
                      source={{
                        uri: resolveWorkspaceFile(file.relativePath).uri,
                      }}
                      style={{ height: 48, width: 48 }}
                    />
                  ) : (
                    <Paperclip color={theme.text} size={18} />
                  )}
                </AttachmentMedia>
                <AttachmentContent>
                  <AttachmentTitle>{file.displayName}</AttachmentTitle>
                  <AttachmentDescription>
                    {file.mimeType ?? "Unknown type"}
                    {typeof file.size === "number"
                      ? ` · ${file.size} bytes`
                      : ""}
                  </AttachmentDescription>
                </AttachmentContent>
                <AttachmentActions>
                  <AttachmentAction
                    onPress={() => {
                      setSelectedFileIds(
                        selectedFileIds.filter((id) => id !== file.id),
                      ).catch(console.error);
                    }}
                  >
                    <X color={theme.text} size={14} />
                  </AttachmentAction>
                </AttachmentActions>
              </Attachment>
            ))}
          </View>
        ) : null}

        {composerTrigger ? (
          <View className="overflow-hidden rounded-card border border-border bg-card dark:border-border-dark dark:bg-card-dark">
            {triggerMenuItems.length > 0 ? (
              triggerMenuItems.map((item, index) => (
                <View key={item.id}>
                  {index > 0 ? <Separator /> : null}
                  <ComposerMenuRow
                    icon={item.icon}
                    disabled={"disabled" in item && item.disabled === true}
                    label={item.label}
                    onPress={item.onPress}
                    subtitle={item.subtitle}
                  />
                </View>
              ))
            ) : (
              <View className="px-sp-4 py-sp-3">
                <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                  No matches
                </Text>
              </View>
            )}
          </View>
        ) : null}

        <ComposerCapsule
          value={prompt}
          onChangeText={setPrompt}
          placeholder="Message Ajiro Agent"
          inputRef={composerRef}
          selection={composerSelection.selectionProp}
          onSelectionChange={composerSelection.onSelectionChange}
          onPaste={(payload) => {
            handlePaste(payload).catch(console.error);
          }}
          sendDisabled={sendDisabled}
          loading={loading}
          onSendPress={handleComposerSendPress}
          onPlusPress={() => {
            setPlusMenuDrawerOpen(true);
          }}
          screenHeight={screenHeight}
          keyboardHeight={keyboardHeight}
          accentColor={appAccent}
        />
      </View>

      <ComposerContextSheet
        open={plusMenuDrawerOpen}
        onOpenChange={setPlusMenuDrawerOpen}
        onUploadFile={() => {
          setFilesDrawerOpen(true);
        }}
        onTakePhoto={() => {
          if (busyAction) return;
          // Permission step: the user explicitly allows opening the
          // device camera app before anything leaves this screen.
          Alert.alert(
            "Open camera?",
            "Allow Ajiro Agent to open the device camera app to take a photo for this chat?",
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Open camera",
                onPress: () => {
                  void runCameraCapture();
                },
              },
            ],
          );
        }}
        onGallery={() => {
          setFilesDrawerOpen(true);
        }}
        onOpenProject={() => {
          setBusyAction("folder");
          pickConversationFolder()
            .then(async (session) => {
              // Single authority: the picked folder becomes the IDE active
              // project too, so Files/Editor/Terminal/Git share it.
              try {
                await ideWorkspace.openProject({
                  name: session.displayName,
                  uri: session.uri,
                  displayName: session.displayName,
                });
              } catch {
                // workspace registration is best-effort here
              }
              setFolderNotice(`Using ${session.displayName} for this chat.`);
            })
            .catch((error) => {
              if (!isFolderPickerCancellation(error)) {
                setFolderNotice(
                  error instanceof Error
                    ? error.message
                    : "Could not select folder.",
                );
              }
            })
            .finally(() => {
              setBusyAction(null);
            });
        }}
        onSelectModel={() => {
          setModelsDrawerOpen(true);
        }}
        onMcpServers={() => {
          setMcpServersDrawerOpen(true);
        }}
        skillMode={currentConversation?.skillMode ?? "auto"}
        onSkillModeChange={(mode) => {
          if (!currentConversationId) return;
          updateConversationModes(currentConversationId, {
            skillMode: mode,
          }).catch(console.error);
        }}
        pinnedSkills={skills
          .filter((skill) => skill.enabled && skill.autoMatch)
          .slice(0, 3)
          .map((skill, index) => ({
            id: skill.id,
            title: skill.title,
            description: skill.description,
            selected: selectedSkillIds.includes(skill.id),
            linked: index === 1,
          }))}
        onToggleSkill={(id) => {
          const selected = selectedSkillIds.includes(id);
          setSelectedSkillIds(
            selected
              ? selectedSkillIds.filter((entry) => entry !== id)
              : [...selectedSkillIds, id],
          ).catch(console.error);
        }}
        onAddSkills={() => {
          setSkillsDrawerOpen(true);
        }}
        webSearchMode={currentConversation?.webSearchMode ?? "smart"}
        onWebSearchModeChange={(mode) => {
          if (!currentConversationId) return;
          updateConversationModes(currentConversationId, {
            webSearchMode: mode,
          }).catch(console.error);
        }}
        effort={reasoningEffort}
        onEffortChange={(effort) => {
          setReasoningEffort(effort).catch(console.error);
        }}
        thinking={reasoningEffort !== "none"}
        onThinkingChange={(enabled) => {
          setReasoningEffort(enabled ? "medium" : "none").catch(console.error);
        }}
        agentName={conversationAgentName}
        onAgentChange={(name) => {
          if (!currentConversationId) return;
          setConversationAgent(currentConversationId, name).catch(
            console.error,
          );
        }}
        approvalMode={toolApprovalMode}
        onApprovalModeChange={(mode) => {
          updateToolApprovalMode(mode).catch(console.error);
        }}
      />

      <Drawer onOpenChange={setFilesDrawerOpen} open={filesDrawerOpen}>
        <DrawerContent showCloseButton showHandle size={filesDrawerSize}>
          <DrawerHeader>
            <DrawerTitle>Select file</DrawerTitle>
            <DrawerDescription>
              {mergedWorkspaceFiles.length} file
              {mergedWorkspaceFiles.length === 1 ? "" : "s"} available
            </DrawerDescription>
          </DrawerHeader>

          <DrawerBody contentContainerClassName="gap-sp-2 pb-sp-4">
            {mergedWorkspaceFiles.length > 0 ? (
              mergedWorkspaceFiles.map((file) => {
                const selected = selectedFileIds.includes(file.id);
                const { binaryFiles, imageFiles } = partitionSelectedFiles([
                  file,
                ]);
                const supported =
                  (imageFiles.length === 0 || supportsImageInput) &&
                  (binaryFiles.length === 0 || supportsTools);

                return (
                  <DrawerSelectRow
                    disabled={!supported && !selected}
                    key={file.id}
                    leading={
                      file.mimeType?.startsWith("image/") ? (
                        <Image
                          contentFit="cover"
                          source={{
                            uri: resolveWorkspaceFile(file.relativePath).uri,
                          }}
                          style={{
                            borderRadius: 10,
                            height: 48,
                            width: 48,
                          }}
                        />
                      ) : null
                    }
                    onPress={() => {
                      setFilesDrawerOpen(false);
                      setSelectedFileIds(
                        selectedFileIds.includes(file.id)
                          ? selectedFileIds.filter((id) => id !== file.id)
                          : [...selectedFileIds, file.id],
                      ).catch(console.error);
                    }}
                    deleting={deletingFileId === file.id}
                    onDelete={() => {
                      handleDeleteUploadedFile(file);
                    }}
                    selected={selected}
                    subtitle={
                      supported
                        ? (file.mimeType ?? "Unknown type")
                        : "Not supported with current model"
                    }
                    title={file.displayName}
                  />
                );
              })
            ) : (
              <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                No files in the workspace yet. Upload one below to attach it.
              </Text>
            )}
          </DrawerBody>
          <DrawerFooter>
            <View className="gap-sp-2">
              <Button
                leftIcon={<Upload color={theme.text} size={16} />}
                loading={busyAction === "import"}
                onPress={handleImportFiles}
                variant="secondary"
              >
                Upload new file
              </Button>
              <Button
                disabled={mergedWorkspaceFiles.length === 0 || loading}
                leftIcon={<Trash2 color={theme.destructive} size={16} />}
                loading={busyAction === "clear"}
                onPress={handleClearWorkspaceFiles}
                textClassName="text-destructive dark:text-destructive-dark"
                variant="ghost"
              >
                Clear all workspace files
              </Button>
            </View>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      <Drawer
        onOpenChange={(open) => {
          setFolderDrawerOpen(open);

          if (!open) {
            setPendingFolderSend(null);
          }
        }}
        open={folderDrawerOpen}
      >
        <DrawerContent showCloseButton showHandle>
          <DrawerHeader>
            <DrawerTitle>Grant folder access</DrawerTitle>
            <DrawerDescription>
              Choose one folder for this chat only.
            </DrawerDescription>
          </DrawerHeader>

          <DrawerFooter className="border-t-0 pt-0">
            <Button
              loading={busyAction === "folder"}
              onPress={handleGrantFolderAccess}
            >
              Choose folder
            </Button>
            <Button
              onPress={() => {
                setFolderDrawerOpen(false);
                setPendingFolderSend(null);
              }}
              variant="outline"
            >
              Cancel
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      <Drawer onOpenChange={setAgentsDrawerOpen} open={agentsDrawerOpen}>
        <DrawerContent showCloseButton showHandle>
          <DrawerHeader>
            <DrawerTitle>Select agent</DrawerTitle>
            <DrawerDescription>
              Choose the agent that runs this chat.
            </DrawerDescription>
          </DrawerHeader>
          <DrawerBody contentContainerClassName="gap-sp-2 pb-sp-4">
            {primaryAgents.map((agent) => (
              <DrawerSelectRow
                key={agent.id}
                onPress={() => {
                  if (!currentConversationId) return;
                  setConversationAgent(currentConversationId, agent.name)
                    .then(() => {
                      setAgentsDrawerOpen(false);
                    })
                    .catch(console.error);
                }}
                selected={
                  resolveAgent(agents, currentSelectedAgentId).name ===
                  agent.name
                }
                subtitle={agent.description ?? undefined}
                title={
                  agent.name === "build"
                    ? "Build"
                    : agent.name === "plan"
                      ? "Plan"
                      : agent.name
                }
              />
            ))}
            <DrawerSelectRow
              onPress={() => {
                setAgentsDrawerOpen(false);
                onOpenAgentSettings();
              }}
              selected={false}
              title="Manage agents"
            />
          </DrawerBody>
        </DrawerContent>
      </Drawer>

      <ComposerModelModal
        onOpenChange={setModelsDrawerOpen}
        open={modelsDrawerOpen}
      />

      <ComposerSkillsModal
        onImportSkill={() => {
          setSkillImportOpen(true);
        }}
        onManageSkills={() => {
          setSkillsDrawerOpen(false);
          onOpenSettings();
        }}
        onOpenChange={setSkillsDrawerOpen}
        onToggleSkill={(id) => {
          const selected = selectedSkillIds.includes(id);
          setSelectedSkillIds(
            selected
              ? selectedSkillIds.filter((entry) => entry !== id)
              : [...selectedSkillIds, id],
          ).catch(console.error);
        }}
        open={skillsDrawerOpen}
        selectedSkillIds={selectedSkillIds}
      />

      <SkillImportDrawer
        onOpenChange={setSkillImportOpen}
        open={skillImportOpen}
      />

      <Drawer
        onOpenChange={setMcpServersDrawerOpen}
        open={mcpServersDrawerOpen}
      >
        <DrawerContent showCloseButton showHandle>
          <DrawerHeader>
            <DrawerTitle>MCP servers</DrawerTitle>
            <DrawerDescription>
              {activeMcpServerIds.size} used in this chat.
            </DrawerDescription>
          </DrawerHeader>
          <DrawerBody contentContainerClassName="gap-sp-2 pb-sp-4">
            {enabledMcpServers.length > 0 ? (
              enabledMcpServers.map((server) => (
                <DrawerSelectRow
                  key={server.id}
                  onPress={() => {
                    toggleMcpServer(server.id).catch(console.error);
                  }}
                  selected={activeMcpServerIds.has(server.id)}
                  subtitle={server.url}
                  title={server.label}
                />
              ))
            ) : (
              <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                No enabled MCP servers. Enable one in MCP servers settings.
              </Text>
            )}
          </DrawerBody>
          <DrawerFooter>
            <Button
              onPress={() => {
                setMcpServersDrawerOpen(false);
                onOpenMcpSettings();
              }}
              variant="outline"
            >
              Manage MCP servers
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </Animated.View>
  );
});

function ComposerMenuRow({
  icon,
  disabled = false,
  label,
  onPress,
  subtitle,
}: {
  icon: ReactNode;
  disabled?: boolean;
  label: string;
  onPress: () => void;
  subtitle?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      className={cn(
        "flex-row items-center gap-sp-3 px-sp-4 py-sp-3",
        disabled && "opacity-50",
      )}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => (pressed ? { opacity: 0.82 } : null)}
    >
      <View className="h-9 w-9 items-center justify-center rounded-full bg-background dark:bg-background-dark">
        {icon}
      </View>
      <View className="min-w-0 flex-1 gap-1">
        <Text className="font-sans text-sm font-medium text-foreground dark:text-foreground-dark">
          {label}
        </Text>
        {subtitle ? (
          <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
            {subtitle}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function DrawerSelectRow({
  deleting = false,
  disabled = false,
  leading,
  onDelete,
  onPress,
  selected,
  subtitle,
  title,
}: {
  deleting?: boolean;
  disabled?: boolean;
  leading?: ReactNode;
  onDelete?: () => void;
  onPress: () => void;
  selected: boolean;
  subtitle?: string;
  title: string;
}) {
  const theme = useTheme();

  return (
    <View
      className={cn(
        "flex-row items-center gap-sp-3 rounded-ui border px-sp-4 py-sp-3",
        selected
          ? "border-foreground bg-secondary dark:border-foreground-dark dark:bg-secondary-dark"
          : "border-border bg-background dark:border-border-dark dark:bg-background-dark",
      )}
    >
      <Pressable
        accessibilityState={{ disabled }}
        accessibilityRole="button"
        className={cn(
          "min-w-0 flex-1 flex-row items-center gap-sp-3",
          disabled && "opacity-50",
        )}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => (pressed ? { opacity: 0.85 } : null)}
      >
        {leading ? (
          <View className="h-12 w-12 shrink-0 overflow-hidden rounded-card">
            {leading}
          </View>
        ) : null}
        <View className="min-w-0 flex-1 gap-1">
          <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
            {title}
          </Text>
          {subtitle ? (
            <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
              {subtitle}
            </Text>
          ) : null}
        </View>
      </Pressable>
      {onDelete ? (
        <Pressable
          accessibilityLabel={`Delete ${title}`}
          accessibilityRole="button"
          disabled={deleting}
          hitSlop={8}
          onPress={onDelete}
          style={({ pressed }) => ({
            opacity: deleting ? 0.45 : pressed ? 0.7 : 1,
          })}
        >
          <Trash2 color={theme.destructive} size={18} />
        </Pressable>
      ) : null}
    </View>
  );
}
