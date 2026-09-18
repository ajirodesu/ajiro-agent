/**
 * Backup collect / validate / apply (Dynamic Data Controls prompt).
 *
 * Covers the 18 user-content tables across 12 JSON files plus a manifest
 * with per-file CRC32 checksums. `provenance_events` is intentionally
 * excluded (internal audit log, not user content).
 *
 * All logic runs against the small `BackupReader` / `BackupWriter`
 * interfaces so it unit-tests with in-memory fakes; `drizzle-store.ts`
 * adapts the real Drizzle database. Import and clear-history apply inside
 * a single transaction â€” any failure rolls back everything, so the
 * registry, filesystem rows, and runtime state can never disagree.
 */
import { crc32Hex } from "./zip";

export const BACKUP_SCHEMA_VERSION = 1;

export const BACKUP_FILES = [
  "manifest.json",
  "conversations.json",
  "memory.json",
  "providers.json",
  "mcp-servers.json",
  "skills.json",
  "agents.json",
  "commands.json",
  "prompts.json",
  "scheduled-tasks.json",
  "workspace.json",
  "settings.json",
] as const;

export type BackupFileName = (typeof BACKUP_FILES)[number];

export type BackupTableName =
  | "agentRuns"
  | "agents"
  | "appSettings"
  | "botCommandConfigs"
  | "botCommandRepositories"
  | "botCommandSecrets"
  | "botModes"
  | "codingCheckpoints"
  | "conversations"
  | "editorFileRevisions"
  | "mcpServers"
  | "memories"
  | "messages"
  | "modelPresets"
  | "providerConfigs"
  | "savedPrompts"
  | "scheduleRuns"
  | "schedules"
  | "skillFiles"
  | "skills"
  | "workspaceFiles";

export type BackupRow = Record<string, unknown>;

export interface BackupReader {
  readTable(table: BackupTableName): Promise<BackupRow[]>;
  readMemoryDocument(): Promise<{
    content: string;
    enabled: boolean;
  } | null>;
  readSettings(keys: string[]): Promise<Record<string, string | null>>;
}

export interface BackupTableStore {
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  replaceTable(table: BackupTableName, rows: BackupRow[]): Promise<void>;
  /** Insert-or-replace each row, matched by `matchFields` (the pk). */
  upsertRows(
    table: BackupTableName,
    matchFields: string[],
    rows: BackupRow[],
  ): Promise<void>;
  deleteAll(table: BackupTableName): Promise<void>;
  deleteMatching(
    table: BackupTableName,
    match: Record<string, unknown | unknown[]>,
  ): Promise<void>;
  readTable(table: BackupTableName): Promise<BackupRow[]>;
  readWhere(
    table: BackupTableName,
    field: string,
    values: unknown[],
  ): Promise<BackupRow[]>;
}

export type BackupWriter = BackupTableStore;

export type BackupFilePayload = {
  crc: string;
  json: string;
};

export type BackupManifest = {
  appVersion: string | null;
  deviceInfo: string | null;
  exportedAt: string;
  files: Record<string, { crc: string; rows?: number }>;
  schemaVersion: number;
};

export type CollectedBackup = {
  files: Record<string, BackupFilePayload>;
  manifest: BackupManifest;
};

/** app_settings keys exported inside memory.json (profile + flags). */
const MEMORY_SETTING_KEYS = [
  "memory_enabled",
  "user_nickname",
  "user_occupation",
  "user_about_me",
];

/**
 * app_settings keys that are never exported: connection strings and
 * anything else that can carry credentials. `database_url` can embed
 * `user:password@host`, so it stays out even though its name does not
 * match the credential pattern below.
 */
const EXCLUDED_SETTING_KEYS = new Set(["database_url"]);

/** Regression guard: no exported value may look like a credential. */
const CREDENTIAL_FIELD_PATTERN = /key|token|secret|password/i;
/**
 * Registry endpoint URLs, not credentials: the token *endpoint* address
 * is public IdP metadata, never a bearer value.
 */
const CREDENTIAL_FIELD_ALLOWLIST = new Set([
  "oauthTokenUrl",
  "oauthAuthorizationUrl",
]);

function stableStringify(value: unknown): string {
  return JSON.stringify(value);
}

function checksumOf(json: string): string {
  return crc32Hex(new TextEncoder().encode(json));
}

function tableFile(
  files: Record<string, BackupFilePayload>,
  name: string,
  payload: unknown,
): void {
  const json = stableStringify(payload);
  files[name] = { crc: checksumOf(json), json };
}

export async function collectBackup(input: {
  appVersion: string | null;
  deviceInfo?: string | null;
  exportedAt?: string;
  reader: BackupReader;
}): Promise<CollectedBackup> {
  const { reader } = input;
  const read = (table: BackupTableName) => reader.readTable(table);
  const [
    conversations,
    messages,
    agentRuns,
    memoryDocument,
    memorySettings,
    memories,
    providerConfigs,
    modelPresets,
    mcpServers,
    skills,
    skillFiles,
    agents,
    botCommandConfigs,
    botCommandRepositories,
    botModes,
    botCommandSecrets,
    savedPrompts,
    schedules,
    scheduleRuns,
    workspaceFiles,
    codingCheckpoints,
    editorFileRevisions,
    allSettings,
  ] = await Promise.all([
    read("conversations"),
    read("messages"),
    read("agentRuns"),
    reader.readMemoryDocument(),
    reader.readSettings(MEMORY_SETTING_KEYS),
    read("memories"),
    read("providerConfigs"),
    read("modelPresets"),
    read("mcpServers"),
    read("skills"),
    read("skillFiles"),
    read("agents"),
    read("botCommandConfigs"),
    read("botCommandRepositories"),
    read("botModes"),
    read("botCommandSecrets"),
    read("savedPrompts"),
    read("schedules"),
    read("scheduleRuns"),
    read("workspaceFiles"),
    read("codingCheckpoints"),
    read("editorFileRevisions"),
    reader.readSettings([]),
  ]);

  const files: Record<string, BackupFilePayload> = {};
  tableFile(files, "conversations.json", { agentRuns, conversations, messages });
  tableFile(files, "memory.json", {
    memories,
    memoryDocument,
    memoryEnabled: memorySettings.memory_enabled !== "false",
    userAboutMe: memorySettings.user_about_me ?? null,
    userNickname: memorySettings.user_nickname ?? null,
    userOccupation: memorySettings.user_occupation ?? null,
  });
  tableFile(files, "providers.json", { modelPresets, providerConfigs });
  tableFile(files, "mcp-servers.json", { mcpServers });
  tableFile(files, "skills.json", { skillFiles, skills });
  tableFile(files, "agents.json", { agents });
  tableFile(files, "commands.json", {
    botCommandConfigs,
    botCommandRepositories,
    botCommandSecrets,
    botModes,
  });
  tableFile(files, "prompts.json", { savedPrompts });
  tableFile(files, "scheduled-tasks.json", { scheduleRuns, schedules });
  tableFile(files, "workspace.json", {
    codingCheckpoints,
    editorFileRevisions,
    workspaceFiles,
  });
  const remainingSettings: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(allSettings)) {
    if (MEMORY_SETTING_KEYS.includes(key)) continue;
    if (EXCLUDED_SETTING_KEYS.has(key)) continue;
    remainingSettings[key] = value;
  }
  tableFile(files, "settings.json", { settings: remainingSettings });

  const manifest: BackupManifest = {
    appVersion: input.appVersion,
    deviceInfo: input.deviceInfo ?? null,
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    files: Object.fromEntries(
      Object.entries(files).map(([name, file]) => [name, { crc: file.crc }]),
    ),
    schemaVersion: BACKUP_SCHEMA_VERSION,
  };
  return { files, manifest };
}

export type ParsedBackup = {
  files: Record<string, unknown>;
  manifest: BackupManifest;
};

/**
 * Validate a bundle before touching the database: manifest presence and
 * shape, supported schema version, every expected file present with a
 * matching checksum. Throws naming the failed file â€” never partially
 * imports.
 */
export function parseBackupBundle(
  files: Record<string, string>,
): ParsedBackup {
  const rawManifest = files["manifest.json"];
  if (!rawManifest) throw new Error('Backup is missing "manifest.json".');
  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(rawManifest) as BackupManifest;
  } catch {
    throw new Error('Backup "manifest.json" is not valid JSON.');
  }
  if (
    typeof manifest.schemaVersion !== "number" ||
    !manifest.files ||
    typeof manifest.files !== "object"
  ) {
    throw new Error('Backup "manifest.json" is malformed.');
  }
  if (manifest.schemaVersion > BACKUP_SCHEMA_VERSION) {
    throw new Error(
      `Backup needs schema v${manifest.schemaVersion}; this app supports v${BACKUP_SCHEMA_VERSION}. Update the app to import it.`,
    );
  }
  const parsed: Record<string, unknown> = {};
  for (const name of BACKUP_FILES) {
    if (name === "manifest.json") continue;
    const json = files[name];
    if (json === undefined) {
      throw new Error(`Backup is missing "${name}".`);
    }
    const expected = manifest.files[name]?.crc;
    if (!expected) {
      throw new Error(`Backup manifest does not cover "${name}".`);
    }
    if (checksumOf(json) !== expected) {
      throw new Error(
        `Backup file "${name}" failed integrity check and was not imported.`,
      );
    }
    try {
      parsed[name] = JSON.parse(json);
    } catch {
      throw new Error(`Backup file "${name}" is not valid JSON.`);
    }
  }
  return { files: parsed, manifest };
}

export type CredentialViolation = {
  field: string;
  file: string;
};

/**
 * Regression guard: walk every exported value; any field whose name looks
 * like a credential holding a non-boolean, non-null value is a violation.
 * `hasApiKey`-style boolean flags and documented endpoint URLs pass.
 */
export function scanForCredentials(
  files: Record<string, unknown>,
): CredentialViolation[] {
  const violations: CredentialViolation[] = [];
  const visit = (file: string, value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(file, entry, `${path}[${index}]`));
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, entry] of Object.entries(value)) {
        const at = path ? `${path}.${key}` : key;
        if (
          CREDENTIAL_FIELD_PATTERN.test(key) &&
          !CREDENTIAL_FIELD_ALLOWLIST.has(key) &&
          entry !== null &&
          typeof entry !== "boolean" &&
          typeof entry !== "object"
        ) {
          violations.push({ field: at, file });
        }
        visit(file, entry, at);
      }
    }
  };
  for (const [file, value] of Object.entries(files)) {
    visit(file, value, "");
  }
  return violations;
}

const TABLE_PK: Record<BackupTableName, string[]> = {
  agentRuns: ["id"],
  agents: ["id"],
  appSettings: ["key"],
  botCommandConfigs: ["id"],
  botCommandRepositories: ["id"],
  botCommandSecrets: ["botId", "commandName"],
  botModes: ["botId"],
  codingCheckpoints: ["id"],
  conversations: ["id"],
  editorFileRevisions: ["id"],
  mcpServers: ["id"],
  memories: ["id"],
  messages: ["id"],
  modelPresets: ["id"],
  providerConfigs: ["id"],
  savedPrompts: ["id"],
  scheduleRuns: ["id"],
  schedules: ["id"],
  skillFiles: ["id"],
  skills: ["id"],
  workspaceFiles: ["id"],
};

function tableRows(parsed: ParsedBackup, file: string, key: string): BackupRow[] {
  const payload = parsed.files[file] as Record<string, unknown> | undefined;
  const rows = payload?.[key];
  return Array.isArray(rows) ? (rows as BackupRow[]) : [];
}

/**
 * Apply a validated bundle. Merge upserts every row by primary key;
 * replace wipes the 18 user-content tables first (provenance_events is
 * never touched). Runs inside one caller-provided transaction. Returns
 * counts of restored providers/MCP servers/bot commands for the
 * re-enter-credentials banner.
 */
export async function applyBackupBundle(
  writer: BackupWriter,
  parsed: ParsedBackup,
  mode: "merge" | "replace",
): Promise<{
  appSettings: number;
  botCommands: number;
  mcpServers: number;
  providers: number;
}> {
  const put = async (
    table: BackupTableName,
    rows: BackupRow[],
  ): Promise<void> => {
    if (mode === "replace") {
      await writer.replaceTable(table, rows);
    } else {
      await writer.upsertRows(table, TABLE_PK[table], rows);
    }
  };

  const conversations = tableRows(parsed, "conversations.json", "conversations");
  const messages = tableRows(parsed, "conversations.json", "messages");
  const agentRuns = tableRows(parsed, "conversations.json", "agentRuns");
  const skills = tableRows(parsed, "skills.json", "skills");
  const skillFiles = tableRows(parsed, "skills.json", "skillFiles");
  const agents = tableRows(parsed, "agents.json", "agents");
  const providerConfigs = tableRows(parsed, "providers.json", "providerConfigs");
  const modelPresets = tableRows(parsed, "providers.json", "modelPresets");
  const mcpServers = tableRows(parsed, "mcp-servers.json", "mcpServers");
  const memories = tableRows(parsed, "memory.json", "memories");
  const savedPrompts = tableRows(parsed, "prompts.json", "savedPrompts");
  const schedules = tableRows(parsed, "scheduled-tasks.json", "schedules");
  const scheduleRuns = tableRows(parsed, "scheduled-tasks.json", "scheduleRuns");
  const workspaceFiles = tableRows(parsed, "workspace.json", "workspaceFiles");
  const codingCheckpoints = tableRows(parsed, "workspace.json", "codingCheckpoints");
  const editorFileRevisions = tableRows(parsed, "workspace.json", "editorFileRevisions");
  const botCommandConfigs = tableRows(parsed, "commands.json", "botCommandConfigs");
  const botCommandRepositories = tableRows(parsed, "commands.json", "botCommandRepositories");
  const botModes = tableRows(parsed, "commands.json", "botModes");
  const botCommandSecrets = tableRows(parsed, "commands.json", "botCommandSecrets");

  const settingsPayload = (parsed.files["settings.json"] ?? {}) as {
    settings?: Record<string, string | null>;
  };
  const memoryPayload = (parsed.files["memory.json"] ?? {}) as {
    memoryEnabled?: boolean;
    userAboutMe?: string | null;
    userNickname?: string | null;
    userOccupation?: string | null;
  };

  // app_settings rows flow through the same transaction as every table, so
  // settings can never disagree with content. The memory.md document lives
  // in MemoryStore (a separate row family); the caller applies it right
  // after this resolves, as one near-atomic write.
  const settings: Record<string, string | null> = {
    ...(settingsPayload.settings ?? {}),
  };
  if (memoryPayload.memoryEnabled !== undefined) {
    settings.memory_enabled = memoryPayload.memoryEnabled ? "true" : "false";
  }
  if (memoryPayload.userNickname !== undefined) {
    settings.user_nickname = memoryPayload.userNickname;
  }
  if (memoryPayload.userOccupation !== undefined) {
    settings.user_occupation = memoryPayload.userOccupation;
  }
  if (memoryPayload.userAboutMe !== undefined) {
    settings.user_about_me = memoryPayload.userAboutMe;
  }
  const settingRows = Object.entries(settings).map(([key, value]) => ({
    key,
    value,
  }));

  await writer.transaction(async () => {
    await put("conversations", conversations);
    await put("messages", messages);
    await put("agentRuns", agentRuns);
    await put("skills", skills);
    await put("skillFiles", skillFiles);
    await put("agents", agents);
    await put("providerConfigs", providerConfigs);
    await put("modelPresets", modelPresets);
    await put("mcpServers", mcpServers);
    await put("memories", memories);
    await put("savedPrompts", savedPrompts);
    await put("schedules", schedules);
    await put("scheduleRuns", scheduleRuns);
    await put("workspaceFiles", workspaceFiles);
    await put("codingCheckpoints", codingCheckpoints);
    await put("editorFileRevisions", editorFileRevisions);
    await put("botCommandConfigs", botCommandConfigs);
    await put("botCommandRepositories", botCommandRepositories);
    await put("botModes", botModes);
    await put("botCommandSecrets", botCommandSecrets);
    await put("appSettings", settingRows);
  });

  return {
    appSettings: settingRows.length,
    botCommands: botCommandSecrets.length,
    mcpServers: mcpServers.length,
    providers: providerConfigs.length,
  };
}

/**
 * Clear chat history: conversations, messages, agent runs, plus coding
 * checkpoints tied to deleted conversations (their conversationId is
 * NOT NULL, so they would otherwise orphan â€” there is no cascade).
 * editorFileRevisions carry only a projectUri with no conversation link,
 * so they are project history, not chat history, and stay.
 */
export async function clearChatHistory(
  writer: BackupWriter,
  reader: Pick<BackupReader, "readTable">,
): Promise<{ agentRuns: number; checkpoints: number; conversations: number; messages: number }> {
  return writer.transaction(async () => {
    const conversations = await reader.readTable("conversations");
    const ids = conversations
      .map((row) => row.id)
      .filter((id): id is string => typeof id === "string");
    const messages = await reader.readTable("messages");
    const agentRuns = await reader.readTable("agentRuns");
    const checkpoints = await reader.readTable("codingCheckpoints");
    const orphaned = checkpoints.filter(
      (row) =>
        typeof row.conversationId === "string" && ids.includes(row.conversationId),
    );
    await writer.deleteAll("agentRuns");
    await writer.deleteAll("messages");
    await writer.deleteAll("conversations");
    for (const row of orphaned) {
      await writer.deleteMatching("codingCheckpoints", { id: row.id });
    }
    return {
      agentRuns: agentRuns.length,
      checkpoints: orphaned.length,
      conversations: conversations.length,
      messages: messages.length,
    };
  });
}
