import { useLocalSearchParams, useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { ChevronLeft, Pencil } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { Text, TextInput, View } from "react-native";

import { Container } from "@/components/shared/container";
import { SkillDetailView } from "@/components/skills/skill-detail-view";
import { Button } from "@/components/ui/button";
import { AppHeader, CircleIconButton } from "@/components/ui/chrome";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { useConfig } from "@/hooks/use-config";
import { useTheme } from "@/hooks/use-theme";
import { useIdeWorkspace } from "@/providers/ide-workspace";
import type { BuiltInToolKey, SkillConfig } from "@/core/types/app-state";
import { BUILT_IN_FILE_TOOL_CONTROLS } from "@/modules/config/built-in-tools";
import { serializeSkillToMarkdown } from "@/modules/skills/skill-markdown";
import { versionForSkillContent } from "@/modules/skills/lifecycle";
import {
  validateSkillDraft,
  type SkillDraftError,
} from "@/modules/skills/skill-validation";
import { resolveSkillMcpStatus } from "@/modules/skills/skill-scopes";
import { loadStoreCatalog, skillOriginLabel } from "@/modules/skills/skill-store-catalog";

type Draft = {
  title: string;
  description: string;
  instructions: string;
  keywords: string;
  autoMatch: boolean;
  enabled: boolean;
  mcpServerIds: string[];
  toolKeys: BuiltInToolKey[];
};

function draftFromSkill(skill: SkillConfig): Draft {
  return {
    autoMatch: skill.autoMatch,
    description: skill.description ?? "",
    enabled: skill.enabled,
    instructions: skill.instructions,
    keywords: skill.matchKeywords.join(", "),
    mcpServerIds: [...skill.recommendedMcpServerIds],
    title: skill.title,
    toolKeys: [...skill.recommendedBuiltInToolKeys],
  };
}

const EMPTY_DRAFT: Draft = {
  autoMatch: true,
  description: "",
  enabled: true,
  instructions: "",
  keywords: "",
  mcpServerIds: [],
  title: "",
  toolKeys: [],
};

export default function SettingsSkillDetailScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === "new";
  const {
    agents,
    createSkill,
    deleteSkill,
    exportSkillMarkdown,
    getProjectSkillIds,
    mcpServers,
    setProjectSkillIds,
    skills,
    updateSkill,
  } = useConfig();
  const ide = useIdeWorkspace();

  const existing = useMemo(
    () => (isNew ? null : (skills.find((skill) => skill.id === id) ?? null)),
    [skills, id, isNew],
  );
  const [editing, setEditing] = useState(isNew);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<SkillDraftError[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pinnedToProject, setPinnedToProject] = useState(false);

  useEffect(() => {
    if (!draft && !isNew && existing) setDraft(draftFromSkill(existing));
  }, [draft, existing, isNew]);
  useEffect(() => {
    if (isNew && !draft) setDraft({ ...EMPTY_DRAFT });
  }, [draft, isNew]);
  useEffect(() => {
    if (!editing && existing) setDraft(draftFromSkill(existing));
  }, [editing, existing]);

  const session = ide.activeSession;
  const storeCatalog = useMemo(() => loadStoreCatalog(), []);
  useEffect(() => {
    if (!session || !existing) {
      setPinnedToProject(false);
      return;
    }
    getProjectSkillIds(session)
      .then((ids) => setPinnedToProject(ids.includes(existing.id)))
      .catch(() => setPinnedToProject(false));
  }, [session, existing, getProjectSkillIds]);

  const errorFor = (field: SkillDraftError["field"]): string | null =>
    errors.find((entry) => entry.field === field)?.message ?? null;

  const handleSave = async () => {
    if (!draft || busy) return;
    const keywords = draft.keywords
      .split(/[\n,]+/)
      .map((keyword) => keyword.trim())
      .filter(Boolean);
    const validation = validateSkillDraft({
      description: draft.description.trim() ? draft.description : null,
      instructions: draft.instructions,
      matchKeywords: keywords,
      title: draft.title,
    });
    setErrors(validation);
    if (validation.length > 0) return;
    setBusy(true);
    setError(null);
    try {
      const input = {
        autoMatch: draft.autoMatch,
        description: draft.description.trim() || null,
        enabled: draft.enabled,
        instructions: draft.instructions.trim(),
        matchKeywords: keywords,
        recommendedBuiltInToolKeys: draft.toolKeys,
        recommendedMcpServerIds: draft.mcpServerIds,
        title: draft.title.trim(),
      };
      if (isNew) {
        const created = await createSkill(input);
        router.replace(`/settings/skills/${created.id}`);
      } else if (existing) {
        await updateSkill(existing.id, input);
        setEditing(false);
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!existing || busy) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setBusy(true);
    try {
      await deleteSkill(existing.id);
      router.back();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Delete failed.");
      setBusy(false);
    }
  };

  const handleTogglePinned = async () => {
    if (!session || !existing || busy) return;
    setBusy(true);
    setError(null);
    try {
      const ids = await getProjectSkillIds(session);
      const next = pinnedToProject
        ? ids.filter((entry) => entry !== existing.id)
        : [...ids, existing.id];
      await setProjectSkillIds(session, next);
      setPinnedToProject(!pinnedToProject);
    } catch (pinError) {
      setError(pinError instanceof Error ? pinError.message : "Pin failed.");
    } finally {
      setBusy(false);
    }
  };

  if (!isNew && !existing) {
    return (
      <Container scroll contentClassName="gap-sp-4 py-sp-4" includeBottomTabInset={false}>
      <AppHeader
        left={
          <CircleIconButton
            accessibilityLabel="Back"
            onPress={() => router.back()}
          >
            <ChevronLeft color={theme.text} size={20} strokeWidth={2} />
          </CircleIconButton>
        }
        title="Skill"
      />
        <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
          Skill not found.
        </Text>
      </Container>
    );
  }

  const skill = existing;
  const mcpStatus = skill ? resolveSkillMcpStatus(skill, mcpServers) : null;
  const version = skill
    ? versionForSkillContent(skill.sourceMarkdown ?? serializeSkillToMarkdown(skill))
    : null;
  const denyingAgents = skill
    ? agents.filter((agent) => agent.toolPermissions.skills?.[skill.id] === false)
    : [];

  return (
    <Container scroll contentClassName="gap-sp-4 py-sp-4" includeBottomTabInset={false}>
      <AppHeader
        left={
          <CircleIconButton
            accessibilityLabel="Back"
            onPress={() => router.back()}
          >
            <ChevronLeft color={theme.text} size={20} strokeWidth={2} />
          </CircleIconButton>
        }
        title={isNew ? "New skill" : (skill?.title ?? "Skill")}
        right={
          !isNew && !editing ? (
            <CircleIconButton
              accessibilityLabel="Edit skill"
              onPress={() => setEditing(true)}
            >
              <Pencil color={theme.text} size={20} strokeWidth={2} />
            </CircleIconButton>
          ) : undefined
        }
      />

      {error ? (
        <Text className="font-sans text-xs text-foreground dark:text-foreground-dark">
          {error}
        </Text>
      ) : null}

      {editing || isNew ? (
        draft ? (
          <EditorForm
            draft={draft}
            errorFor={errorFor}
            mcpServers={mcpServers.map((server) => ({
              id: server.id,
              label: server.label,
            }))}
            onChange={(patch) => setDraft({ ...draft, ...patch })}
            onCancel={
              isNew
                ? undefined
                : () => {
                    setEditing(false);
                    setErrors([]);
                  }
            }
            onSave={handleSave}
            saving={busy}
            isNew={isNew}
          />
        ) : null
      ) : skill ? (
        <>
          <SkillDetailView
            skill={{
              autoMatch: skill.autoMatch,
              author: skill.author,
              description: skill.description,
              enabled: skill.enabled,
              files: skill.skillFiles.map((file) => ({ path: file.path, size: file.size })),
              id: skill.id,
              keywords: skill.matchKeywords,
              sourceLabel: skillOriginLabel(skill, storeCatalog),
              title: skill.title,
              version,
            }}
            mcp={mcpStatus}
            actions={
              <>
                <Button
                  onPress={() =>
                    updateSkill(skill.id, { enabled: !skill.enabled }).catch((updateError) =>
                      setError(
                        updateError instanceof Error ? updateError.message : "Update failed.",
                      ),
                    )
                  }
                  variant="outline"
                >
                  {skill.enabled ? "Disable" : "Enable"}
                </Button>
                <Button
                  onPress={async () => {
                    try {
                      await Clipboard.setStringAsync(exportSkillMarkdown(skill.id));
                    } catch (copyError) {
                      setError(
                        copyError instanceof Error ? copyError.message : "Copy failed.",
                      );
                    }
                  }}
                  variant="outline"
                >
                  Copy markdown
                </Button>
                {session ? (
                  <Button onPress={handleTogglePinned} variant="outline">
                    {pinnedToProject ? "Unpin from project" : "Pin to project"}
                  </Button>
                ) : null}
                <Button onPress={handleDelete} variant="outline">
                  {confirmDelete ? "Confirm delete" : "Delete"}
                </Button>
              </>
            }
          />

          <Card className="px-sp-3 py-sp-2">
            <Text className="font-sans text-xs font-semibold text-foreground dark:text-foreground-dark">
              Agent access
            </Text>
            <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
              Agents use enabled skills by default. Blocking is per agent, deny-wins.
            </Text>
            {agents.length === 0 ? (
              <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                No agents configured.
              </Text>
            ) : (
              agents.map((agent) => {
                const denied = agent.toolPermissions.skills?.[skill.id] === false;
                return (
                  <View
                    key={agent.id}
                    className="flex-row items-center justify-between gap-sp-2 py-1"
                  >
                    <Text
                      className="min-w-0 flex-1 font-sans text-sm text-foreground dark:text-foreground-dark"
                      numberOfLines={1}
                    >
                      {agent.name}
                    </Text>
                    <Text className="font-mono text-xs text-muted-foreground dark:text-muted-foreground-dark">
                      {denied ? "Blocked" : "Allowed"}
                    </Text>
                    <Button
                      onPress={() => router.push(`/settings/agents/${agent.id}`)}
                      size="xs"
                      variant="ghost"
                    >
                      Edit
                    </Button>
                  </View>
                );
              })
            )}
            {denyingAgents.length > 0 ? (
              <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                Blocked for {denyingAgents.length} agent
                {denyingAgents.length === 1 ? "" : "s"}.
              </Text>
            ) : null}
          </Card>

          <Text className="font-sans text-sm font-semibold text-foreground dark:text-foreground-dark">
            Instructions
          </Text>
          <Card className="px-sp-3 py-sp-2">
            <Text
              selectable
              className="font-mono text-xs leading-5 text-foreground dark:text-foreground-dark"
            >
              {skill.instructions}
            </Text>
          </Card>
        </>
      ) : null}
    </Container>
  );
}

function EditorField({
  error,
  label,
  children,
}: {
  error?: string | null;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View className="gap-1">
      <Text className="font-sans text-xs font-semibold text-foreground dark:text-foreground-dark">
        {label}
      </Text>
      {children}
      {error ? (
        <Text className="font-sans text-xs text-foreground dark:text-foreground-dark">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

function EditorForm({
  draft,
  errorFor,
  isNew,
  mcpServers,
  onCancel,
  onChange,
  onSave,
  saving,
}: {
  draft: {
    title: string;
    description: string;
    instructions: string;
    keywords: string;
    autoMatch: boolean;
    enabled: boolean;
    mcpServerIds: string[];
    toolKeys: BuiltInToolKey[];
  };
  errorFor: (field: "title" | "description" | "instructions" | "matchKeywords") => string | null;
  isNew: boolean;
  mcpServers: { id: string; label: string }[];
  onCancel?: () => void;
  onChange: (patch: Partial<typeof draft>) => void;
  onSave: () => void;
  saving: boolean;
}) {
  const theme = useTheme();
  return (
    <View className="gap-sp-3">
      <EditorField label="Title" error={errorFor("title")}>
        <TextInput
          accessibilityLabel="Skill title"
          autoCapitalize="none"
          autoCorrect={false}
          className="rounded-ui border border-border px-sp-2 py-1 font-sans text-sm text-foreground dark:border-border-dark dark:text-foreground-dark"
          onChangeText={(text) => onChange({ title: text })}
          placeholder="pdf-helper"
          placeholderTextColor={theme.textSecondary}
          value={draft.title}
        />
      </EditorField>
      <EditorField label="Description (one line)" error={errorFor("description")}>
        <TextInput
          accessibilityLabel="Skill description"
          autoCapitalize="sentences"
          className="rounded-ui border border-border px-sp-2 py-1 font-sans text-sm text-foreground dark:border-border-dark dark:text-foreground-dark"
          multiline
          onChangeText={(text) => onChange({ description: text })}
          placeholder="When and why to use this skill."
          placeholderTextColor={theme.textSecondary}
          value={draft.description}
        />
      </EditorField>
      <EditorField label="Instructions (markdown)" error={errorFor("instructions")}>
        <TextInput
          accessibilityLabel="Skill instructions"
          autoCapitalize="sentences"
          className="min-h-40 rounded-ui border border-border px-sp-2 py-1 font-mono text-sm text-foreground dark:border-border-dark dark:text-foreground-dark"
          multiline
          onChangeText={(text) => onChange({ instructions: text })}
          placeholder="# Workflow&#10;&#10;1. …"
          placeholderTextColor={theme.textSecondary}
          textAlignVertical="top"
          value={draft.instructions}
        />
      </EditorField>
      <EditorField label="Keywords (comma separated)" error={errorFor("matchKeywords")}>
        <TextInput
          accessibilityLabel="Skill keywords"
          autoCapitalize="none"
          autoCorrect={false}
          className="rounded-ui border border-border px-sp-2 py-1 font-mono text-sm text-foreground dark:border-border-dark dark:text-foreground-dark"
          onChangeText={(text) => onChange({ keywords: text })}
          placeholder="pdf, merge, split"
          placeholderTextColor={theme.textSecondary}
          value={draft.keywords}
        />
      </EditorField>
      <Checkbox
        checked={draft.autoMatch}
        onCheckedChange={(checked) => onChange({ autoMatch: checked === true })}
      >
        Auto-match this skill by relevance
      </Checkbox>
      <Checkbox
        checked={draft.enabled}
        onCheckedChange={(checked) => onChange({ enabled: checked === true })}
      >
        Enabled
      </Checkbox>
      {mcpServers.length > 0 ? (
        <View className="gap-1">
          <Text className="font-sans text-xs font-semibold text-foreground dark:text-foreground-dark">
            Recommended MCP servers
          </Text>
          {mcpServers.map((server) => {
            const checked = draft.mcpServerIds.includes(server.id);
            return (
              <Checkbox
                key={server.id}
                checked={checked}
                onCheckedChange={(next) =>
                  onChange({
                    mcpServerIds:
                      next === true
                        ? [...draft.mcpServerIds, server.id]
                        : draft.mcpServerIds.filter((id) => id !== server.id),
                  })
                }
              >
                {server.label}
              </Checkbox>
            );
          })}
        </View>
      ) : null}
      <View className="gap-1">
        <Text className="font-sans text-xs font-semibold text-foreground dark:text-foreground-dark">
          Recommended tool groups
        </Text>
        {BUILT_IN_FILE_TOOL_CONTROLS.map((control) => {
          const checked = control.keys.some((key) => draft.toolKeys.includes(key));
          return (
            <Checkbox
              key={control.label}
              checked={checked}
              onCheckedChange={(next) => {
                const updated = new Set(draft.toolKeys);
                if (next === true) {
                  for (const key of control.keys) updated.add(key);
                } else {
                  for (const key of control.keys) updated.delete(key);
                }
                onChange({ toolKeys: [...updated] });
              }}
            >
              {control.label}
            </Checkbox>
          );
        })}
      </View>
      <View className="flex-row gap-sp-2">
        {onCancel ? (
          <Button disabled={saving} onPress={onCancel} variant="outline">
            Cancel
          </Button>
        ) : null}
        <Button disabled={saving} onPress={onSave}>
          {saving ? "Saving…" : isNew ? "Create skill" : "Save changes"}
        </Button>
      </View>
    </View>
  );
}
