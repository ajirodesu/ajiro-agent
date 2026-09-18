import type { AppThemeId } from "@/theme/types";

export type ProviderFamily =  | "openai"
  | "anthropic"
  | "google"
  | "on-device"
  | "openrouter"
  | "ollama"
  | "xai"
  | "openai-compatible";

export type ProviderAuthType = "oauth" | "apiKey" | "none";
export type DatabaseMode = "local" | "remote";
export type FileContextSource = "workspace" | "external-folder";
export type MessageRole = "system" | "user" | "assistant";
export type MessageStatus = "streaming" | "completed" | "failed";
export type ModelKind = "chat" | "small";
export type ModelRef = `${string}/${string}`;
export type ReasoningEffort =
  "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type ModelTransport =
  | "anthropic"
  | "codexResponses"
  | "google"
  | "onDevice"
  | "openaiChat"
  | "openaiCompatible"
  | "openaiResponses";
export type ToolApprovalMode = "ask" | "auto" | "allowList";
export type AgentMode = "plan" | "build";
export type AgentVisibilityMode = "primary" | "subagent" | "all";
export type AgentToolPermissions = {
  builtInTools?: Partial<Record<BuiltInToolKey, boolean>>;
  mcpServers?: Record<string, boolean>;
  /**
   * Agent skill assignment (skill id → allowed). Absent map or absent entry
   * means allowed; explicit `false` denies (deny-wins). Stored in the same
   * `tool_permissions_json` blob, so no migration is needed.
   */
  skills?: Record<string, boolean>;
};
export type ThemeMode = "system" | "light" | "dark";
export type McpServerTransport = "http" | "sse";
export type McpServerAuthMode = "none" | "headers" | "oauth";
export type McpServerStatus = "untested" | "connected" | "failed";
export type AgentRunStatus =
  | "queued"
  | "running"
  | "waiting_for_approval"
  | "waiting_for_question"
  | "completed"
  | "failed"
  | "canceled"
  | "resumable"
  | "retrying";
export type WorkspaceFileSourceKind = "artifact" | "created" | "imported";
export type ExternalFolderPlatform = "android" | "ios" | "web";
export type BuiltInToolKey =
  | "workspaceListFiles"
  | "workspaceRead"
  | "workspaceWrite"
  | "workspaceCreateFile"
  | "workspaceGrep"
  | "workspaceGlob"
  | "workspaceEdit"
  | "downloadFile"
  | "folderListDirectory"
  | "folderRead"
  | "folderWrite"
  | "folderCreateFile"
  | "folderCreateDirectory"
  | "folderRenameEntry"
  | "folderMoveEntry"
  | "folderDeleteEntry"
  | "folderGrep"
  | "folderGlob"
  | "folderEdit"
  | "exec"
  | "git"
  | "todos"
  | "question"
  | "skill"
  | "schedules";
export type BuiltInToolSettings = Record<BuiltInToolKey, boolean>;
export type SkillFile = {
  id: string;
  path: string;
  content: string;
  mimeType: string | null;
  size: number | null;
  createdAt: string;
  updatedAt: string;
};
export type SkillConfig = {
  id: string;
  title: string;
  description: string | null;
  instructions: string;
  sourceMarkdown: string | null;
  /** Origin URL the skill was installed from (store catalog or import URL). */
  sourceUrl: string | null;
  /** Author attribution from the catalog or skill metadata. */
  author: string | null;
  skillFiles: SkillFile[];
  enabled: boolean;
  autoMatch: boolean;
  matchKeywords: string[];
  recommendedMcpServerIds: string[];
  recommendedBuiltInToolKeys: BuiltInToolKey[];
  createdAt: string;
  updatedAt: string;
};
export type AgentConfig = {
  id: string;
  name: string;
  description: string | null;
  prompt: string | null;
  mode: AgentVisibilityMode;
  modelProviderId: string | null;
  modelModelId: string | null;
  temperature: number | null;
  enabled: boolean;
  hidden: boolean;
  sourceMarkdown: string | null;
  /** Origin URL the agent was imported from (pack import URL). */
  sourceUrl: string | null;
  /** Last successful re-sync from sourceUrl (ISO timestamp). */
  lastSyncedAt: string | null;
  toolPermissions: AgentToolPermissions;
  createdAt: string;
  updatedAt: string;
};
export type SavedPrompt = {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};
export type MemoryEntry = {
  id: string;
  content: string;
  enabled: boolean;
  sourceConversationId: string | null;
  sourceMessageId: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};
export type MemoryEvent = {
  id: string;
  kind: "created" | "updated" | "deleted";
  memoryId: string;
  content: string;
  previousContent: string | null;
  reason: string | null;
  createdAt: string;
};
export type PendingToolApprovalRequest = {
  id: string;
  inputSummary: string;
  toolName: string;
};
export type PendingToolApproval = PendingToolApprovalRequest & {
  chatTitle: string;
  conversationId: string;
  runId: string;
};
export type QuestionnaireItem = {
  id: string;
  prompt: string;
  description?: string | null;
  required?: boolean;
  multiple?: boolean;
  choices?: string[];
  allowFreeform?: boolean;
  freeformPlaceholder?: string | null;
};
export type PendingQuestionnaireRequest = {
  id: string;
  items: QuestionnaireItem[];
};
export type PendingQuestionnaireAnswer = {
  id: string;
  value: string | string[] | null;
};
export type PendingQuestionnaire = PendingQuestionnaireRequest & {
  chatTitle: string;
  conversationId: string;
  runId: string;
};
export type ModelUsageSnapshot = {
  providerId: string;
  providerLabel: string;
  modelId: string;
  modelLabel: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  costInput: number | null;
  costOutput: number | null;
  costTotal: number | null;
  contextWindow: number | null;
  remainingContext: number | null;
  contextUsagePercent: number | null;
  /** Vercel-AI-SDK style granular breakdown (provider-dependent). */
  inputTokenDetails?: {
    noCacheTokens: number | null;
    cacheReadTokens: number | null;
    cacheWriteTokens: number | null;
  } | null;
  outputTokenDetails?: {
    textTokens: number | null;
    reasoningTokens: number | null;
  } | null;
};

export type ModelCapabilities = {
  imageGeneration: boolean;
  imageInput: boolean;
  reasoning: boolean;
  tools: boolean;
};

export type GeneratedImageAttachment = {
  id: string;
  mimeType: string;
  uri: string;
};

export type ToolExecutionRecord = {
  createdAt: string;
  id?: string;
  toolName: string;
  status: "completed" | "failed" | "pending" | "running";
  inputSummary: string;
  outputSummary: string | null;
  error: string | null;
};

/**
 * Provenance record (§98): what ran, who ran it, where, under which
 * permission, with what result. Written by the execution broker callers
 * for plugins, MCP, terminal, GitHub, builds, and filesystem writes.
 */
export type ProvenanceEvent = {
  id: string;
  action: string;
  agentId: string | null;
  tool: string | null;
  runtime: string | null;
  permission: string;
  input: string | null;
  result: string | null;
  ok: boolean;
  sessionId: string | null;
  createdAt: string;
};

export type SkillMode = "auto" | "manual";
export type WebSearchMode = "offline" | "smart";
/**
 * Per-conversation interaction posture. Agent Mode is today's full
 * behavior; Bot Mode constrains runs to answers only (read-only tools,
 * no skill/agent/memory management, no subagents or schedules).
 */
export type InteractionMode = "agent" | "bot";

export type PromptArtifact = {
  id: string;
  category: "model" | "tool";
  fileId: string;
  displayName: string;
  relativePath: string;
  createdAt: string;
};

export type ExecutionTimelineEvent = {
  id: string;
  kind: "run" | "prompt" | "tool" | "image";
  status: "pending" | "completed" | "failed" | "info";
  title: string;
  detail: string | null;
  createdAt: string;
};

export type ReasoningBlock = {
  id: string;
  text: string;
  startedAt: string;
  completedAt: string | null;
};

export type TodoStatus = "pending" | "in_progress" | "completed";

export type TodoListItem = {
  id: string;
  title: string;
  status: TodoStatus;
  createdAt: string;
  completedAt: string | null;
};

export type NotificationSettings = {
  approvalRequests: boolean;
  runFinished: boolean;
};

export type ScheduleFrequency =
  | "hourly"
  | "daily"
  | "weekly"
  | "monthly"
  | "custom";

export type Schedule = {
  id: string;
  title: string;
  prompt: string;
  expression: string;
  timezone: string;
  providerId: string;
  modelId: string;
  agentId: string | null;
  autoApprove: boolean;
  enabled: boolean;
  conversationId: string | null;
  externalFolderSession: ExternalFolderSession | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ScheduleRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

export type ScheduleRun = {
  id: string;
  scheduleId: string;
  runId: string | null;
  status: ScheduleRunStatus;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
};

export type MessageMetadata = {
  agentName?: string | null;
  appliedSkillIds?: string[];
  executionTimeline?: ExecutionTimelineEvent[];
  externalFolderDisplayName?: string | null;
  fileContextSource?: FileContextSource;
  generatedImages?: GeneratedImageAttachment[];
  memoryEvents?: MemoryEvent[];
  promptArtifacts?: PromptArtifact[];
  reasoning?: ReasoningBlock[];
  runId?: string | null;
  selectedFileIds?: string[];
  todoList?: TodoListItem[];
  toolExecutions?: ToolExecutionRecord[];
  usage?: ModelUsageSnapshot | null;
};

export type AgentRun = {
  id: string;
  conversationId: string;
  status: AgentRunStatus;
  userMessageId: string;
  assistantMessageId: string;
  providerId: string;
  modelId: string;
  input: string;
  fileContextSource: FileContextSource | null;
  selectedFileIds: string[];
  externalFolderSession: ExternalFolderSession | null;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  lastError: string | null;
  resumeCount: number;
  retryCount: number;
  maxRetries: number;
  lastRetryAt: string | null;
  agentMode: AgentMode;
  agentId: string | null;
  autoApprove: boolean;
};

export type ExternalFolderSession = {
  uri: string;
  displayName: string;
  platform: ExternalFolderPlatform;
  sourceType: "external-folder";
  grantedAt: string;
};

export type ProviderConfig = {
  id: string;
  family: ProviderFamily;
  label: string;
  authType: ProviderAuthType;
  baseUrl: string | null;
  enabled: boolean;
  oauthAccountEmail: string | null;
  createdAt: string;
  updatedAt: string;
};

export type McpServerConfig = {
  id: string;
  label: string;
  url: string;
  transport: McpServerTransport;
  authMode: McpServerAuthMode;
  enabled: boolean;
  headerNames: string[];
  oauthClientId: string | null;
  oauthAuthorizationUrl: string | null;
  oauthTokenUrl: string | null;
  oauthScopes: string | null;
  oauthAllowedAuthOrigin: string | null;
  lastStatus: McpServerStatus;
  lastError: string | null;
  toolCount: number | null;
  serverInfo: Record<string, unknown> | null;
  serverInstructions: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ModelPreset = {
  id: string;
  providerId: string;
  modelId: string;
  label: string | null;
  isDefault: boolean;
  options: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

export type Conversation = {
  id: string;
  title: string;
  providerId: string | null;
  modelId: string | null;
  reasoningEffort: ReasoningEffort;
  agentMode: AgentMode;
  agentId: string | null;
  selectedFileIds: string[];
  selectedMcpServerIds: string[] | null;
  selectedSkillIds: string[];
  skillMode: SkillMode;
  webSearchMode: WebSearchMode;
  interactionMode: InteractionMode;
  externalFolderSession: ExternalFolderSession | null;
  pinnedAt: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type StoredMessage = {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  metadata: MessageMetadata | null;
  status: MessageStatus;
  error: string | null;
  sequence: number;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceFile = {
  id: string;
  displayName: string;
  originalName: string | null;
  mimeType: string | null;
  size: number | null;
  relativePath: string;
  sourceKind: WorkspaceFileSourceKind;
  createdAt: string;
  updatedAt: string;
};

export type SendMessageInput = {
  content: string;
  fileContextSource?: FileContextSource;
  selectedFileIds?: string[];
};

export type AppSettings = {
  activeConversationId: string | null;
  activeModelRef: ModelRef | null;
  builtInToolSettings: BuiltInToolSettings;
  codingSettings: import("@/core/services/coding/coding-settings").CodingSettings;
  databaseMode: DatabaseMode;
  databaseUrl: string | null;
  memoryEnabled: boolean;
  /** Personalization injected into the system prompt when memory is on. */
  userNickname: string | null;
  userOccupation: string | null;
  userAboutMe: string | null;
  maxToolSteps: number;
  schedulingEnabled: boolean;
  themeMode: ThemeMode;
  /**
   * Full theme selection (existing system/light/dark plus aqua/burnt/
   * indigo). Missing/invalid resolves to aqua for fresh installs; existing
   * legacy preferences are preserved by the startup rule.
   */
  themeId: AppThemeId;
  /** User accent override (legacy themes only; locked themes ignore it). */
  accentColor: string | null;
  toolApprovalMode: ToolApprovalMode;
  /** Persisted allow-list for approval mode "allowList" (tool names). */
  toolAllowList: string[];
  notificationSettings: NotificationSettings;
};

export type CuratedModelDefinition = {
  capabilities?: Partial<ModelCapabilities>;
  contextWindow?: number | null;
  id: string;
  isFree?: boolean;
  kind: ModelKind;
  label: string;
  outputType?: "image" | "text";
  options?: Record<string, unknown>;
  transport?: ModelTransport;
};

export type ResolvedModel = {
  capabilities: ModelCapabilities;
  ref: ModelRef;
  providerId: string;
  providerFamily: ProviderFamily;
  providerAuthType: ProviderAuthType;
  providerLabel: string;
  modelId: string;
  label: string;
  outputType: "image" | "text";
  isDefault: boolean;
  isFree: boolean;
  source: "suggested" | "custom";
  active: boolean;
  supportsTools: boolean;
  supportsImageInput: boolean;
  supportsImageGeneration: boolean;
  supportsReasoning: boolean;
  transport: ModelTransport;
  options: Record<string, unknown> | null;
  contextWindow: number | null;
};

export type ResolvedConfig = {
  activeProviderIds: string[];
  providers: ProviderConfig[];
  modelPresets: ModelPreset[];
  suggestedModelsByProvider: Record<string, CuratedModelDefinition[]>;
  providerModelDiscovery: Record<
    string,
    { error: string | null; status: "connected" | "failed" }
  >;
  availableModels: ResolvedModel[];
  activeModels: ResolvedModel[];
  currentModel: ResolvedModel | null;
  currentModelSupportsImageGeneration: boolean;
  currentModelSupportsImageInput: boolean;
  currentModelSupportsTools: boolean;
  databaseMode: DatabaseMode;
  databaseUrl: string | null;
};

export type AppStateSnapshot = {
  agentRuns: AgentRun[];
  agents: AgentConfig[];
  conversations: Conversation[];
  currentConversation: Conversation | null;
  currentSelectedAgentId: string | null;
  currentSelectedFileIds: string[];
  currentSelectedMcpServerIds: string[] | null;
  currentSelectedSkillIds: string[];
  memory: MemoryEntry | null;
  mcpServers: McpServerConfig[];
  messages: StoredMessage[];
  savedPrompts: SavedPrompt[];
  schedules: Schedule[];
  skills: SkillConfig[];
  workspaceFiles: WorkspaceFile[];
  resolvedConfig: ResolvedConfig;
  settings: AppSettings;
};

export function createModelRef(providerId: string, modelId: string): ModelRef {
  return `${providerId}/${modelId}`;
}

export function parseModelRef(modelRef: ModelRef) {
  const separatorIndex = modelRef.indexOf("/");

  if (separatorIndex <= 0 || separatorIndex === modelRef.length - 1) {
    throw new Error(`Invalid model ref: ${modelRef}`);
  }

  return {
    providerId: modelRef.slice(0, separatorIndex),
    modelId: modelRef.slice(separatorIndex + 1),
  };
}
