import { useLocalSearchParams, useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { ChevronLeft, Copy, Save, Sparkles, Trash2 } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { Container } from "@/components/shared/container";
import { Button } from "@/components/ui/button";
import { AppHeader, CircleIconButton } from "@/components/ui/chrome";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import type {
  AgentConfig,
  AgentToolPermissions,
  AgentVisibilityMode,
  BuiltInToolKey,
} from "@/core/types/app-state";
import { secureSecretStore } from "@/core/services/secrets";
import { useConfig } from "@/hooks/use-config";
import { useTheme } from "@/hooks/use-theme";
import {
  DEFAULT_AGENT_SYSTEM_PROMPT_PLACEHOLDER,
  buildAgentGeneratePrompt,
  parseAgentJsonDraft,
} from "@/modules/agents/generate";
import { serializeAgentToMarkdown } from "@/modules/agents/agent-markdown";
import { validateAgentDraft } from "@/modules/agents/agent-validation";
import { ALL_BUILT_IN_TOOL_KEYS } from "@/modules/config/built-in-tools";
import { modelRuntime } from "@/modules/runtime/model-runtime";

/**
 * Agent editor: persona, model override, temperature, availability, and
 * per-agent tool access. Screen-based (not a drawer) so it works on every
 * platform the app ships to.
 *
 * Author: AjiroDesu
 */

const MODE_OPTIONS: { label: string; value: AgentVisibilityMode }[] = [
  { label: "Chat + Subagent", value: "all" },
  { label: "Chat only", value: "primary" },
  { label: "Subagent only", value: "subagent" },
];

type Draft = {
  description: string;
  mode: AgentVisibilityMode;
  modelRef: string;
  name: string;
  prompt: string;
  temperature: string;
  toolPermissions: AgentToolPermissions;
};

const BUILT_IN_TOOL_LABELS: Partial<Record<BuiltInToolKey, string>> = {
  downloadFile: "Download files",
  exec: "Run checks (exec)",
  git: "Local git tools",
  folderCreateDirectory: "Create folders (external)",
  folderCreateFile: "Create files (external)",
  folderDeleteEntry: "Delete entries (external)",
  folderEdit: "Edit files (external)",
  folderGlob: "Find files (external)",
  folderGrep: "Search text (external)",
  folderListDirectory: "List folders (external)",
  folderMoveEntry: "Move entries (external)",
  folderRead: "Read files (external)",
  folderRenameEntry: "Rename entries (external)",
  folderWrite: "Write files (external)",
  question: "Ask questions",
  schedules: "Scheduled jobs",
  skill: "Use skills",
  todos: "Todo lists",
  workspaceCreateFile: "Create files",
  workspaceEdit: "Edit files",
  workspaceGlob: "Find files",
  workspaceGrep: "Search text",
  workspaceListFiles: "List files",
  workspaceRead: "Read files",
  workspaceWrite: "Write files",
};

function draftFromAgent(agent: AgentConfig): Draft {
  return {
    description: agent.description ?? "",
    mode: agent.mode,
    modelRef:
      agent.modelProviderId && agent.modelModelId
        ? `${agent.modelProviderId}/${agent.modelModelId}`
        : "",
    name: agent.name,
    prompt: agent.prompt ?? "",
    temperature:
      agent.temperature !== null && agent.temperature !== undefined
        ? String(agent.temperature)
        : "",
    toolPermissions: agent.toolPermissions,
  };
}

const EMPTY_DRAFT: Draft = {
  description: "",
  mode: "all",
  modelRef: "",
  name: "",
  prompt: "",
  temperature: "",
  toolPermissions: {},
};

function parseDraftModelRef(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return { modelId: null, providerId: null };
  }

  const separatorIndex = trimmed.indexOf("/");

  if (separatorIndex <= 0 || separatorIndex === trimmed.length - 1) {
    return undefined;
  }

  return {
    providerId: trimmed.slice(0, separatorIndex),
    modelId: trimmed.slice(separatorIndex + 1),
  };
}

export default function SettingsAgentEditorScreen() {
  const router = useRouter();
  const theme = useTheme();
  const {
    activeModels,
    agents,
    createAgent,
    currentModel,
    mcpServers,
    providers,
    skills,
    updateAgent,
    deleteAgent,
    syncAgentFromSource,
  } = useConfig();
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === "new";

  const existing = useMemo(
    () => agents.find((agent) => agent.id === id) ?? null,
    [agents, id],
  );

  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<null | "generate" | "save">(null);
  const [error, setError] = useState<string | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);

  if (!draft) {
    if (existing) {
      setDraft(draftFromAgent(existing));
    } else if (isNew) {
      setDraft({ ...EMPTY_DRAFT });
    }
  }

  if (!isNew && !existing) {
    return (
      <Container scroll contentClassName="gap-sp-4 py-sp-4" includeBottomTabInset={false}>
      <AppHeader
        left={
          <CircleIconButton
            accessibilityLabel="Back"
            onPress={() => {
              if (router.canGoBack()) {
                router.back();
              } else {
                router.push("/settings/agents" as never);
              }
            }}
          >
            <ChevronLeft color={theme.text} size={20} strokeWidth={2} />
          </CircleIconButton>
        }
        title="Agent not found"
      />
      </Container>
    );
  }

  const current = draft ?? EMPTY_DRAFT;
  const updateDraft = (patch: Partial<Draft>) =>
    setDraft({ ...current, ...patch });

  const parseModelRefInput = (value: string) => parseDraftModelRef(value);

  const handleSave = async () => {
    if (busy) {
      return;
    }

    // Shared builder gate (same rules as pack imports): typed per-field
    // errors instead of ad-hoc checks, so the editor, imports, and future
    // builder surfaces stay in sync.
    const draftErrors = validateAgentDraft({
      description: current.description,
      mode: current.mode,
      modelRef: current.modelRef,
      name: current.name,
      prompt: current.prompt,
      temperature: current.temperature,
    });

    if (draftErrors.length > 0) {
      setError(draftErrors[0]!.message);
      return;
    }

    const parsedModel = parseModelRefInput(current.modelRef);

    if (parsedModel === undefined) {
      setError("Model must look like provider/model, or stay empty.");
      return;
    }

    let temperature: number | null = null;

    if (current.temperature.trim()) {
      temperature = Number.parseFloat(current.temperature);

      if (!Number.isFinite(temperature)) {
        setError("Temperature must be a number like 0.3, or stay empty.");
        return;
      }
    }

    setBusy("save");
    setError(null);

    try {
      const payload = {
        description: current.description.trim() || null,
        mode: current.mode,
        ...parsedModel,
        prompt: current.prompt.trim() || null,
        temperature,
        toolPermissions: current.toolPermissions,
      };

      if (existing) {
        await updateAgent(existing.id, {
          ...payload,
          name: current.name,
        });
      } else {
        await createAgent({
          ...payload,
          name: current.name,
        });
      }

      router.back();
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Could not save.",
      );
    } finally {
      setBusy(null);
    }
  };

  const handleSync = async () => {
    if (syncBusy || !existing?.sourceUrl) {
      return;
    }

    setSyncBusy(true);
    setSyncNotice(null);

    try {
      const result = await syncAgentFromSource(existing.id);

      if (result.unchanged) {
        setSyncNotice("Already up to date with the source.");
      } else {
        setDraft(draftFromAgent(result.agent));
        setSyncNotice("Updated from the source.");
      }
    } catch (syncError) {
      setSyncNotice(
        syncError instanceof Error ? syncError.message : "Re-sync failed.",
      );
    } finally {
      setSyncBusy(false);
    }
  };

  const handleDelete = async () => {
    if (busy || !existing) {
      return;
    }

    setBusy("save");
    setError(null);

    try {
      await deleteAgent(existing.id);
      router.replace("/settings/agents" as never);
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : "Could not delete.",
      );
    } finally {
      setBusy(null);
    }
  };

  const handleGenerate = async () => {
    if (busy) {
      return;
    }

    const model = currentModel ?? activeModels[0] ?? null;

    if (!model) {
      setError("Configure a provider first to generate agents with AI.");
      return;
    }

    const provider = providers.find(
      (item: { id: string }) => item.id === model.providerId,
    );

    if (!provider) {
      setError("The selected model's provider is unavailable.");
      return;
    }

    setBusy("generate");
    setError(null);

    try {
      const result = await modelRuntime.generateTextStream({
        maxToolSteps: 1,
        messages: [
          {
            role: "system",
            content:
              "You output only a single JSON object. No markdown fences, no commentary.",
          },
          {
            role: "user",
            content: buildAgentGeneratePrompt({
              description: current.description || current.name,
              existingNames: agents.map((agent) => agent.name),
              hasPrompt: Boolean(current.prompt.trim()),
            }),
          },
        ],
        model,
        provider,
        secretStore: secureSecretStore,
      });
      const parsed = parseAgentJsonDraft(result.text);

      updateDraft({
        ...(parsed.description ? { description: parsed.description } : {}),
        ...(parsed.name ? { name: parsed.name } : {}),
        ...(parsed.systemPrompt && !current.prompt.trim()
          ? { prompt: parsed.systemPrompt }
          : {}),
      });
    } catch (generateError) {
      setError(
        generateError instanceof Error
          ? generateError.message
          : "Generation failed.",
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <Container scroll contentClassName="gap-sp-4 py-sp-4" includeBottomTabInset={false}>
      <AppHeader
        left={
          <CircleIconButton
            accessibilityLabel="Back"
            onPress={() => {
              if (router.canGoBack()) {
                router.back();
              } else {
                router.push("/settings/agents" as never);
              }
            }}
          >
            <ChevronLeft color={theme.text} size={20} strokeWidth={2} />
          </CircleIconButton>
        }
        title={isNew ? "New agent" : current.name || "Agent"}
        subtitle="Persona, model override, and tool access"
      />

      {existing?.sourceUrl ? (
        <Card className="gap-sp-2 px-sp-4 py-sp-4">
          <View className="flex-row items-center justify-between gap-sp-2">
            <Text className="font-sans text-sm font-medium text-foreground dark:text-foreground-dark">
              Imported source
            </Text>
            <Button
              loading={syncBusy}
              onPress={handleSync}
              size="sm"
              variant="outline"
            >
              Re-sync
            </Button>
          </View>
          <Text
            numberOfLines={2}
            className="font-mono text-xs text-muted-foreground dark:text-muted-foreground-dark"
          >
            {existing.sourceUrl}
          </Text>
          {existing.lastSyncedAt ? (
            <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
              Last synced{" "}
              {new Date(existing.lastSyncedAt).toLocaleString()}
            </Text>
          ) : null}
          {syncNotice ? (
            <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
              {syncNotice}
            </Text>
          ) : null}
        </Card>
      ) : null}

      <Card className="gap-sp-3 px-sp-4 py-sp-4">
        <View className="gap-sp-2">
          <Text className="font-sans text-sm font-medium text-foreground dark:text-foreground-dark">
            Name
          </Text>
          <Input
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={(name) => updateDraft({ name })}
            placeholder="code-reviewer"
            value={current.name}
          />
        </View>
        <View className="gap-sp-2">
          <Text className="font-sans text-sm font-medium text-foreground dark:text-foreground-dark">
            Description
          </Text>
          <Input
            onChangeText={(description) => updateDraft({ description })}
            placeholder="When should this agent be used?"
            value={current.description}
          />
        </View>
        <ModePicker draft={current} onChange={updateDraft} />
        <View className="gap-sp-2">
          <Text className="font-sans text-sm font-medium text-foreground dark:text-foreground-dark">
            Model override
          </Text>
          <Input
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={(modelRef) => updateDraft({ modelRef })}
            placeholder="provider/model — empty uses the chat model"
            value={current.modelRef}
          />
        </View>
        <View className="gap-sp-2">
          <Text className="font-sans text-sm font-medium text-foreground dark:text-foreground-dark">
            Temperature
          </Text>
          <Input
            autoCapitalize="none"
            keyboardType="decimal-pad"
            onChangeText={(temperature) => updateDraft({ temperature })}
            placeholder="Empty uses the model default"
            value={current.temperature}
          />
        </View>
      </Card>

      <Card className="gap-sp-3 px-sp-4 py-sp-4">
        <View className="flex-row items-center justify-between gap-sp-2">
          <Text className="font-sans text-sm font-medium text-foreground dark:text-foreground-dark">
            System prompt
          </Text>
          <Button
            leftIcon={<Sparkles color={theme.text} size={14} />}
            loading={busy === "generate"}
            onPress={handleGenerate}
            size="sm"
            variant="outline"
          >
            Generate with AI
          </Button>
        </View>
        <Textarea
          className="min-h-40"
          onChangeText={(prompt) => updateDraft({ prompt })}
          placeholder={DEFAULT_AGENT_SYSTEM_PROMPT_PLACEHOLDER}
          value={current.prompt}
        />
        {!current.prompt.trim() ? (
          <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
            Empty uses the default Ajiro Agent system prompt.
          </Text>
        ) : null}
      </Card>

      <ToolPermissionsCard
        draft={current}
        mcpServerIds={mcpServers.map((server) => server.id)}
        onChange={updateDraft}
        skills={skills}
      />

      <AgentMarkdownPreview draft={current} />

      {error ? (
        <Text className="font-sans text-sm text-destructive dark:text-destructive-dark">
          {error}
        </Text>
      ) : null}

      <View className="flex-row gap-sp-2">
        <Button
          leftIcon={<Save color={theme.background} size={16} />}
          loading={busy === "save"}
          onPress={handleSave}
          size="sm"
        >
          {isNew ? "Create agent" : "Save changes"}
        </Button>
        {!isNew && existing ? (
          <Button
            disabled={busy !== null}
            leftIcon={<Trash2 color={theme.destructive} size={16} />}
            onPress={handleDelete}
            size="sm"
            variant="ghost"
          >
            Delete
          </Button>
        ) : null}
      </View>
    </Container>
  );
}

function AgentMarkdownPreview({ draft }: { draft: Draft }) {
  const [copied, setCopied] = useState(false);
  const theme = useTheme();

  let preview: string | null = null;

  if (draft.prompt.trim()) {
    try {
      const model = parseDraftModelRef(draft.modelRef);
      const temperature = draft.temperature.trim()
        ? Number.parseFloat(draft.temperature)
        : null;
      preview = serializeAgentToMarkdown({
        description: draft.description.trim() || null,
        mode: draft.mode,
        modelModelId: model?.modelId ?? null,
        modelProviderId: model?.providerId ?? null,
        name: draft.name.trim() || "agent",
        prompt: draft.prompt,
        temperature: Number.isFinite(temperature) ? temperature : null,
        toolPermissions: draft.toolPermissions,
      });
    } catch {
      preview = null;
    }
  }

  const handleCopy = async () => {
    if (!preview) {
      return;
    }
    await Clipboard.setStringAsync(preview);
    setCopied(true);
  };

  return (
    <Card className="gap-sp-3 px-sp-4 py-sp-4">
      <View className="flex-row items-center justify-between gap-sp-2">
        <Text className="font-sans text-sm font-medium text-foreground dark:text-foreground-dark">
          AGENT.md preview
        </Text>
        <Button
          disabled={!preview}
          leftIcon={<Copy color={theme.text} size={14} />}
          onPress={handleCopy}
          size="sm"
          variant="outline"
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </View>
      {preview ? (
        <Text
          selectable
          className="font-mono text-xs text-foreground dark:text-foreground-dark"
        >
          {preview}
        </Text>
      ) : (
        <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
          Write a system prompt above to see the exact AGENT.md this editor
          will store.
        </Text>
      )}
    </Card>
  );
}

function ModePicker({
  draft,
  onChange,
}: {
  draft: Draft;
  onChange: (patch: Partial<Draft>) => void;
}) {
  const [open, setOpen] = useState(false);
  const label =
    MODE_OPTIONS.find((option) => option.value === draft.mode)?.label ??
    "Chat + Subagent";

  return (
    <Drawer onOpenChange={setOpen} open={open}>
      <DrawerTrigger asChild>
        <Pressable
          accessibilityRole="button"
          className="flex-row items-center justify-between rounded-ui border border-border bg-input px-sp-3 py-sp-3 dark:border-border-dark dark:bg-input-dark"
          style={({ pressed }) => (pressed ? { opacity: 0.85 } : null)}
        >
          <Text className="font-sans text-sm text-foreground dark:text-foreground-dark">
            Where available: {label}
          </Text>
          <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
            Change
          </Text>
        </Pressable>
      </DrawerTrigger>
      <DrawerContent showCloseButton showHandle>
        <DrawerHeader>
          <DrawerTitle>Availability</DrawerTitle>
          <DrawerDescription>
            Chat agents are selectable in chats; subagents are invoked by other
            agents via the task tool.
          </DrawerDescription>
        </DrawerHeader>
        <DrawerBody contentContainerClassName="gap-sp-2 pb-sp-4">
          {MODE_OPTIONS.map((option) => (
            <Pressable
              key={option.value}
              className="flex-row items-center gap-sp-3 rounded-ui border border-border px-sp-3 py-sp-3 dark:border-border-dark"
              onPress={() => {
                onChange({ mode: option.value });
                setOpen(false);
              }}
            >
              <Checkbox checked={draft.mode === option.value} onCheckedChange={() => {}} />
              <Text className="flex-1 font-sans text-sm text-foreground dark:text-foreground-dark">
                {option.label}
              </Text>
            </Pressable>
          ))}
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}

function ToolPermissionsCard({
  draft,
  mcpServerIds,
  onChange,
  skills,
}: {
  draft: Draft;
  mcpServerIds: string[];
  onChange: (patch: Partial<Draft>) => void;
  skills: { id: string; title: string }[];
}) {
  const [open, setOpen] = useState(false);
  const builtInDenies = draft.toolPermissions.builtInTools ?? {};
  const mcpPermissions = draft.toolPermissions.mcpServers ?? {};
  const skillPermissions = draft.toolPermissions.skills ?? {};

  const setBuiltInAllowed = (key: BuiltInToolKey, allowed: boolean) => {
    const next = { ...builtInDenies };

    if (allowed) {
      delete next[key];
    } else {
      next[key] = false;
    }

    onChange({
      toolPermissions: {
        ...draft.toolPermissions,
        ...(Object.keys(next).length > 0 ? { builtInTools: next } : {}),
      },
    });
  };

  const setMcpAllowed = (serverId: string, allowed: boolean) => {
    const next = { ...mcpPermissions, [serverId]: allowed };

    onChange({
      toolPermissions: {
        ...draft.toolPermissions,
        mcpServers: next,
      },
    });
  };

  const setSkillAllowed = (skillId: string, allowed: boolean) => {
    const next = { ...skillPermissions };
    if (allowed) {
      delete next[skillId];
    } else {
      next[skillId] = false;
    }
    const { skills: _dropped, ...rest } = draft.toolPermissions;
    void _dropped;
    onChange({
      toolPermissions: {
        ...rest,
        ...(Object.keys(next).length > 0 ? { skills: next } : {}),
      },
    });
  };

  return (
    <Card className="gap-sp-3 px-sp-4 py-sp-4">
      <Text className="font-sans text-sm font-medium text-foreground dark:text-foreground-dark">
        Tool access
      </Text>
      <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
        Agents can use every globally-enabled tool by default. Toggle tools off
        to deny them for this agent.
      </Text>
      <Button onPress={() => setOpen(true)} size="sm" variant="outline">
        Configure tool access
      </Button>
      <Drawer onOpenChange={setOpen} open={open}>
        <DrawerContent showCloseButton showHandle>
          <DrawerHeader>
            <DrawerTitle>Tool access</DrawerTitle>
            <DrawerDescription>
              Enabled tools stay subject to the global tool settings; disabled
              ones are denied for this agent.
            </DrawerDescription>
          </DrawerHeader>
          <DrawerBody contentContainerClassName="gap-sp-1 pb-sp-4">
            {ALL_BUILT_IN_TOOL_KEYS.map((key, index) => (
              <View key={key}>
                <Pressable
                  accessibilityRole="button"
                  className="flex-row items-center gap-sp-3 px-sp-1 py-sp-2"
                  onPress={() =>
                    setBuiltInAllowed(key, builtInDenies[key] !== false)
                  }
                >
                  <Checkbox
                    checked={builtInDenies[key] !== false}
                    onCheckedChange={(checked) =>
                      setBuiltInAllowed(key, checked === true)
                    }
                  />
                  <Text className="flex-1 font-sans text-sm text-foreground dark:text-foreground-dark">
                    {BUILT_IN_TOOL_LABELS[key] ?? key}
                  </Text>
                </Pressable>
                {index < ALL_BUILT_IN_TOOL_KEYS.length - 1 ? (
                  <Separator />
                ) : null}
              </View>
            ))}
            {mcpServerIds.length > 0 ? (
              <>
                <Text className="px-sp-1 pt-sp-3 font-sans text-sm font-semibold text-foreground dark:text-foreground-dark">
                  MCP servers
                </Text>
                {mcpServerIds.map((serverId) => (
                  <Pressable
                    key={serverId}
                    accessibilityRole="button"
                    className="flex-row items-center gap-sp-3 px-sp-1 py-sp-2"
                    onPress={() =>
                      setMcpAllowed(serverId, mcpPermissions[serverId] !== false)
                    }
                  >
                    <Checkbox
                      checked={mcpPermissions[serverId] !== false}
                      onCheckedChange={(checked) =>
                        setMcpAllowed(serverId, checked === true)
                      }
                    />
                    <Text className="flex-1 font-sans text-sm text-foreground dark:text-foreground-dark">
                      {serverId}
                    </Text>
                  </Pressable>
                ))}
              </>
            ) : null}
            {skills.length > 0 ? (
              <>
                <Text className="px-sp-1 pt-sp-3 font-sans text-sm font-semibold text-foreground dark:text-foreground-dark">
                  Skills
                </Text>
                <Text className="px-sp-1 font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                  Agents use enabled skills by default. Uncheck to deny a
                  skill for this agent.
                </Text>
                {skills.map((skill) => (
                  <Checkbox
                    key={skill.id}
                    checked={skillPermissions[skill.id] !== false}
                    onCheckedChange={(checked) =>
                      setSkillAllowed(skill.id, checked === true)
                    }
                  >
                    {skill.title}
                  </Checkbox>
                ))}
              </>
            ) : null}
          </DrawerBody>
        </DrawerContent>
      </Drawer>
    </Card>
  );
}
