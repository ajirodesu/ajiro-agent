import type { ExpoSQLiteDatabase } from "drizzle-orm/expo-sqlite";
import type { SQLiteDatabase } from "expo-sqlite";

import type { schema } from "@/core/db/schema";
import type { MemoryStore } from "@/modules/memory/types";
import type { CheckpointRepository } from "@/core/db/repositories/checkpoint-repository";
import type { EditorRevisionRepository } from "@/core/db/repositories/editor-revision-repository";
import type { ProjectCodingSettings } from "@/core/services/coding/coding-settings";
import type {
  AgentConfig,
  AgentMode,
  AgentRun,
  AgentRunStatus,
  AppSettings,
  BuiltInToolSettings,
  Conversation,
  DatabaseMode,
  ExternalFolderSession,
  FileContextSource,
  McpServerAuthMode,
  McpServerConfig,
  McpServerStatus,
  McpServerTransport,
  MemoryEntry,
  MessageMetadata,
  ModelPreset,
  NotificationSettings,
  ProvenanceEvent,
  ProviderConfig,
  ReasoningEffort,
  SavedPrompt,
  Schedule,
  ScheduleRun,
  ScheduleRunStatus,
  SkillConfig,
  SkillMode,
  InteractionMode,
  StoredMessage,
  ToolApprovalMode,
  ThemeMode,
  WebSearchMode,
  WorkspaceFile,
  WorkspaceFileSourceKind,
} from "@/core/types/app-state";

export interface AgentRepository {
  create(input: {
    description?: string | null;
    enabled?: boolean;
    hidden?: boolean;
    id?: string;
    mode?: AgentConfig["mode"];
    modelModelId?: string | null;
    modelProviderId?: string | null;
    name: string;
    prompt?: string | null;
    sourceMarkdown?: string | null;
    sourceUrl?: string | null;
    lastSyncedAt?: string | null;
    temperature?: number | null;
    toolPermissions?: AgentConfig["toolPermissions"];
  }): Promise<AgentConfig>;
  delete(id: string): Promise<void>;
  getById(id: string): Promise<AgentConfig | null>;
  getByName(name: string): Promise<AgentConfig | null>;
  list(): Promise<AgentConfig[]>;
  update(
    id: string,
    input: {
      description?: string | null;
      enabled?: boolean;
      hidden?: boolean;
      mode?: AgentConfig["mode"];
      modelModelId?: string | null;
      modelProviderId?: string | null;
      name?: string;
      prompt?: string | null;
      sourceMarkdown?: string | null;
      sourceUrl?: string | null;
      lastSyncedAt?: string | null;
      temperature?: number | null;
      toolPermissions?: AgentConfig["toolPermissions"];
    },
  ): Promise<void>;
}

export interface ConversationRepository {
  deleteById(id: string): Promise<void>;
  fork(
    id: string,
    options?: { title?: string; upToSequence?: number },
  ): Promise<Conversation>;
  search(query: string): Promise<Conversation[]>;
  setArchived(id: string, archivedAt: string | null): Promise<void>;
  create(input: {
    id?: string;
    agentId?: string | null;
    modelId?: string | null;
    pinnedAt?: string | null;
    providerId?: string | null;
    title: string;
  }): Promise<Conversation>;
  getById(id: string): Promise<Conversation | null>;
  list(): Promise<Conversation[]>;
  updateMetadata(
    id: string,
    input: {
      agentMode?: AgentMode;
      agentId?: string | null;
      externalFolderSession?: ExternalFolderSession | null;
      modelId?: string | null;
      pinnedAt?: string | null;
      providerId?: string | null;
      reasoningEffort?: ReasoningEffort;
      selectedFileIds?: string[];
      selectedMcpServerIds?: string[] | null;
      selectedSkillIds?: string[];
      skillMode?: SkillMode;
      webSearchMode?: WebSearchMode;
      interactionMode?: InteractionMode;
      title?: string;
      updatedAt?: string;
    },
  ): Promise<void>;
}

export interface MessageRepository {
  create(input: {
    content: string;
    conversationId: string;
    error?: string | null;
    id?: string;
    metadata?: MessageMetadata | null;
    role: StoredMessage["role"];
    sequence: number;
    status: StoredMessage["status"];
  }): Promise<StoredMessage>;
  getNextSequence(conversationId: string): Promise<number>;
  listByConversation(conversationId: string): Promise<StoredMessage[]>;
  listAll(): Promise<StoredMessage[]>;
  listStreaming(): Promise<StoredMessage[]>;
  /** Delete every message of a conversation with `sequence < given`. Used by
      context compaction to trim older history. */
  deleteBefore(conversationId: string, sequence: number): Promise<void>;
  /** Delete a single message by id. Used by message deletion. */
  deleteById(id: string): Promise<void>;
  recoverInterruptedStreams(): Promise<void>;
  updateContent(input: {
    content: string;
    error?: string | null;
    id: string;
    metadata?: MessageMetadata | null;
    status?: StoredMessage["status"];
  }): Promise<void>;
}

export interface AgentRunRepository {
  create(input: {
    agentMode?: AgentMode;
    agentId?: string | null;
    assistantMessageId: string;
    autoApprove?: boolean;
    completedAt?: string | null;
    conversationId: string;
    externalFolderSession?: ExternalFolderSession | null;
    fileContextSource?: FileContextSource | null;
    id?: string;
    input: string;
    lastError?: string | null;
    modelId: string;
    providerId: string;
    resumeCount?: number;
    retryCount?: number;
    maxRetries?: number;
    lastRetryAt?: string | null;
    selectedFileIds?: string[];
    startedAt?: string;
    status: AgentRunStatus;
    updatedAt?: string;
    userMessageId: string;
  }): Promise<AgentRun>;
  getById(id: string): Promise<AgentRun | null>;
  getActiveByConversation(conversationId: string): Promise<AgentRun | null>;
  list(): Promise<AgentRun[]>;
  update(
    id: string,
    input: {
  agentMode?: AgentMode;
  agentId?: string | null;
  completedAt?: string | null;
  externalFolderSession?: ExternalFolderSession | null;
  fileContextSource?: FileContextSource | null;
  input?: string;
  lastError?: string | null;
  modelId?: string;
  providerId?: string;
  resumeCount?: number;
  retryCount?: number;
  maxRetries?: number;
  lastRetryAt?: string | null;
  selectedFileIds?: string[];
  startedAt?: string;
  status?: AgentRunStatus;
  updatedAt?: string;
  autoApprove?: boolean;
  }): Promise<void>;
  /** Delete a single agent run by id. Used by message deletion. */
  deleteById(id: string): Promise<void>;
}

export interface WorkspaceRepository {
  create(input: {
    displayName: string;
    id?: string;
    mimeType?: string | null;
    originalName?: string | null;
    relativePath: string;
    size?: number | null;
    sourceKind: WorkspaceFileSourceKind;
  }): Promise<WorkspaceFile>;
  getById(id: string): Promise<WorkspaceFile | null>;
  getByIds(ids: string[]): Promise<WorkspaceFile[]>;
  list(): Promise<WorkspaceFile[]>;
  deleteAll(): Promise<void>;
  delete(id: string): Promise<void>;
  updateMetadata(
    id: string,
    input: {
      displayName?: string;
      mimeType?: string | null;
      originalName?: string | null;
      relativePath?: string;
      size?: number | null;
      updatedAt?: string;
    },
  ): Promise<void>;
}

export interface McpServerRepository {
  create(input: {
    authMode: McpServerAuthMode;
    enabled?: boolean;
    headerNames?: string[];
    id?: string;
    label: string;
    oauthAllowedAuthOrigin?: string | null;
    oauthAuthorizationUrl?: string | null;
    oauthClientId?: string | null;
    oauthScopes?: string | null;
    oauthTokenUrl?: string | null;
    transport: McpServerTransport;
    url: string;
  }): Promise<McpServerConfig>;
  delete(id: string): Promise<void>;
  getById(id: string): Promise<McpServerConfig | null>;
  list(): Promise<McpServerConfig[]>;
  update(
    id: string,
    input: {
      authMode?: McpServerAuthMode;
      enabled?: boolean;
      headerNames?: string[];
      label?: string;
      oauthAllowedAuthOrigin?: string | null;
      oauthAuthorizationUrl?: string | null;
      oauthClientId?: string | null;
      oauthScopes?: string | null;
      oauthTokenUrl?: string | null;
      transport?: McpServerTransport;
      url?: string;
    },
  ): Promise<void>;
  updateConnectionState(
    id: string,
    input: {
      lastError?: string | null;
      lastStatus: McpServerStatus;
      serverInfo?: Record<string, unknown> | null;
      serverInstructions?: string | null;
      toolCount?: number | null;
    },
  ): Promise<void>;
}

export interface SkillRepository {
  create(input: {
    author?: string | null;
    autoMatch?: boolean;
    description?: string | null;
    enabled?: boolean;
    id?: string;
    instructions: string;
    matchKeywords?: string[];
    recommendedBuiltInToolKeys?: SkillConfig["recommendedBuiltInToolKeys"];
    recommendedMcpServerIds?: string[];
    skillFiles?: Omit<SkillConfig["skillFiles"][number], "createdAt" | "updatedAt" | "id">[];
    sourceMarkdown?: string | null;
    sourceUrl?: string | null;
    title: string;
  }): Promise<SkillConfig>;
  delete(id: string): Promise<void>;
  getById(id: string): Promise<SkillConfig | null>;
  list(): Promise<SkillConfig[]>;
  update(
    id: string,
    input: {
      author?: string | null;
      autoMatch?: boolean;
      description?: string | null;
      enabled?: boolean;
      instructions?: string;
      matchKeywords?: string[];
      recommendedBuiltInToolKeys?: SkillConfig["recommendedBuiltInToolKeys"];
      recommendedMcpServerIds?: string[];
      skillFiles?: Omit<SkillConfig["skillFiles"][number], "createdAt" | "updatedAt" | "id">[];
      sourceMarkdown?: string | null;
      sourceUrl?: string | null;
      title?: string;
    },
  ): Promise<void>;
  listFilesForSkill(
    skillId: string,
  ): Promise<SkillConfig["skillFiles"]>;
  deleteFilesForSkill(skillId: string): Promise<void>;
}

export interface MemoryEntryRepository {
  create(input: {
    content: string;
    enabled?: boolean;
    id?: string;
    sourceConversationId?: string | null;
    sourceMessageId?: string | null;
  }): Promise<MemoryEntry>;
  delete(id: string): Promise<void>;
  deleteAll(): Promise<void>;
  getById(id: string): Promise<MemoryEntry | null>;
  list(): Promise<MemoryEntry[]>;
  setEnabled(id: string, enabled: boolean): Promise<void>;
}

export type UserProfile = {
  aboutMe: string | null;
  nickname: string | null;
  occupation: string | null;
};

export interface SavedPromptRepository {
  create(input: {
    content: string;
    id?: string;
    title: string;
  }): Promise<SavedPrompt>;
  delete(id: string): Promise<void>;
  getById(id: string): Promise<SavedPrompt | null>;
  list(): Promise<SavedPrompt[]>;
  update(
    id: string,
    input: {
      content?: string;
      title?: string;
    },
  ): Promise<void>;
}

export interface ScheduleRepository {
  create(input: {
    agentId?: string | null;
    autoApprove?: boolean;
    conversationId?: string | null;
    enabled?: boolean;
    expression: string;
    externalFolderSession?: ExternalFolderSession | null;
    id?: string;
    lastRunAt?: string | null;
    modelId: string;
    nextRunAt?: string | null;
    prompt: string;
    providerId: string;
    timezone: string;
    title: string;
  }): Promise<Schedule>;
  delete(id: string): Promise<void>;
  getById(id: string): Promise<Schedule | null>;
  list(): Promise<Schedule[]>;
  listEnabled(): Promise<Schedule[]>;
  update(
    id: string,
    input: {
      agentId?: string | null;
      autoApprove?: boolean;
      conversationId?: string | null;
      enabled?: boolean;
      expression?: string;
      externalFolderSession?: ExternalFolderSession | null;
      lastRunAt?: string | null;
      modelId?: string;
      nextRunAt?: string | null;
      prompt?: string;
      providerId?: string;
      timezone?: string;
      title?: string;
    },
  ): Promise<void>;
}

export interface ScheduleRunRepository {
  create(input: {
    completedAt?: string | null;
    error?: string | null;
    id?: string;
    runId?: string | null;
    scheduleId: string;
    startedAt?: string;
    status: ScheduleRunStatus;
  }): Promise<ScheduleRun>;
  getById(id: string): Promise<ScheduleRun | null>;
  listAll(): Promise<ScheduleRun[]>;
  listBySchedule(scheduleId: string, limit?: number): Promise<ScheduleRun[]>;
  update(
    id: string,
    input: {
      completedAt?: string | null;
      error?: string | null;
      runId?: string | null;
      status?: ScheduleRunStatus;
    },
  ): Promise<void>;
}

export interface ConfigRepository {
  createProvider(input: {
    authType: ProviderConfig["authType"];
    baseUrl?: string | null;
    enabled?: boolean;
    family: ProviderConfig["family"];
    id: string;
    label: string;
    oauthAccountEmail?: string | null;
  }): Promise<ProviderConfig>;
  deleteProvider(providerId: string): Promise<void>;
  ensureDefaultProviders(): Promise<void>;
  getSettings(): Promise<AppSettings>;
  listModelPresets(): Promise<ModelPreset[]>;
  listProviderConfigs(): Promise<ProviderConfig[]>;
  createModelPreset(input: {
    label?: string | null;
    makeDefault?: boolean;
    modelId: string;
    options?: Record<string, unknown> | null;
    providerId: string;
  }): Promise<ModelPreset>;
  deleteModelPreset(modelPresetId: string): Promise<void>;
  setDatabaseSettings(input: {
    databaseMode?: DatabaseMode;
    databaseUrl?: string | null;
  }): Promise<void>;
  setBuiltInToolSettings(input: Partial<BuiltInToolSettings>): Promise<void>;
  setMemoryEnabled(enabled: boolean): Promise<void>;
  getUserProfile(): Promise<UserProfile>;
  updateUserProfile(input: Partial<UserProfile>): Promise<UserProfile>;
  setSchedulingEnabled(enabled: boolean): Promise<void>;
  setThemeMode(mode: ThemeMode): Promise<void>;
  setToolApprovalMode(mode: ToolApprovalMode): Promise<void>;
  setToolAllowList(toolNames: string[]): Promise<void>;
  setMaxToolSteps(maxToolSteps: number): Promise<void>;
  setNotificationSettings(input: Partial<NotificationSettings>): Promise<void>;
  setCodingSettings(
    input: Partial<AppSettings["codingSettings"]>,
  ): Promise<void>;
  getProjectCodingSettings(
    session: ExternalFolderSession,
  ): Promise<ProjectCodingSettings | null>;
  setProjectCodingSettings(
    session: ExternalFolderSession,
    input: Partial<ProjectCodingSettings>,
  ): Promise<void>;
  setDefaultModelPreset(modelPresetId: string): Promise<void>;
  updateProvider(
    providerId: string,
    input: {
      baseUrl?: string | null;
      enabled?: boolean;
      label?: string;
      oauthAccountEmail?: string | null;
    },
  ): Promise<void>;
  setProviderOauthEmail(
    providerId: string,
    email: string | null,
  ): Promise<void>;
  setSetting(key: string, value: string | null): Promise<void>;
  /** Raw app_settings rows for backup (values may be null). */
  listRawSettings(): Promise<Record<string, string | null>>;
}

export interface ProvenanceRepository {
  record(input: {
    action: string;
    agentId?: string | null;
    id?: string;
    input?: string | null;
    ok: boolean;
    permission: string;
    result?: string | null;
    runtime?: string | null;
    sessionId?: string | null;
    tool?: string | null;
  }): Promise<ProvenanceEvent>;
  getById(id: string): Promise<ProvenanceEvent | null>;
  list(input: {
    action?: string;
    limit?: number;
    sessionId?: string | null;
  }): Promise<ProvenanceEvent[]>;
  prune(beforeIso: string): Promise<void>;
}

export type BotCommandRepository = import("./bot-command-repository").BotCommandRepository;

export type Repositories = {
  botCommandRepository: BotCommandRepository;
  agentRepository: AgentRepository;
  agentRunRepository: AgentRunRepository;
  checkpointRepository: CheckpointRepository;
  configRepository: ConfigRepository;
  conversationRepository: ConversationRepository;
  editorRevisionRepository: EditorRevisionRepository;
  memoryStore: MemoryStore;
  mcpServerRepository: McpServerRepository;
  memoryEntryRepository: MemoryEntryRepository;
  messageRepository: MessageRepository;
  provenanceRepository: ProvenanceRepository;
  savedPromptRepository: SavedPromptRepository;
  scheduleRepository: ScheduleRepository;
  scheduleRunRepository: ScheduleRunRepository;
  skillRepository: SkillRepository;
  workspaceRepository: WorkspaceRepository;
};

export type AppDatabase = ExpoSQLiteDatabase<typeof schema>;
export type SqliteDb = SQLiteDatabase;
