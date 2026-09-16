/**
 * Composer Skills Modal — select and activate skills for the current chat.
 *
 * Functional reference: the lobehub Composer Skills hierarchy (grouping,
 * selection model, search, active/selected states, detail + management
 * navigation) rebuilt on Ajiro's Drawer + theme + typography. Selecting a
 * skill writes real runtime state through `onToggleSkill`; nothing here is
 * visual-only.
 */
import { useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { ChevronLeft, Search } from "lucide-react-native";

import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { useTheme } from "@/hooks/use-theme";
import { SkillAvatar } from "@/components/skills/skill-avatar";
import { SkillDetailView } from "@/components/skills/skill-detail-view";
import type { ProjectSkill } from "@/modules/skills/project-skills";

export interface SkillsModalSkill {
  id: string;
  title: string;
  description: string | null;
  enabled: boolean;
  autoMatch: boolean;
  selected: boolean;
  keywords: string[];
  fileCount: number;
  mcpAttention: boolean;
}

export interface SkillsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  skills: SkillsModalSkill[];
  projectSkills: ProjectSkill[];
  notice?: string | null;
  onToggleSkill: (id: string) => void;
  onToggleEnabled: (id: string) => void;
  onInstallProjectSkill: (dir: string) => void;
  installingDir: string | null;
  onManageSkills: () => void;
  onImportSkill: () => void;
  onOpenStore: () => void;
}

function matchesQuery(skill: SkillsModalSkill, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [skill.title, skill.description ?? "", ...(skill.keywords ?? [])].some(
    (field) => field.toLowerCase().includes(needle),
  );
}

function SkillRow({
  avatarSeed,
  badges,
  description,
  onOpenDetail,
  onToggle,
  selected,
  title,
  toggleVerb,
}: {
  avatarSeed: string;
  badges: string[];
  description?: string | null;
  onOpenDetail: () => void;
  onToggle: () => void;
  selected: boolean;
  title: string;
  toggleVerb?: string;
}) {
  const theme = useTheme();
  return (
    <View
      accessibilityState={{ selected }}
      className={`flex-row items-center gap-sp-3 rounded-ui border px-sp-3 py-sp-2 ${
        selected
          ? "border-foreground bg-secondary dark:border-foreground-dark dark:bg-secondary-dark"
          : "border-border bg-background dark:border-border-dark dark:bg-background-dark"
      }`}
    >
      <SkillAvatar seed={avatarSeed} title={title} size={40} />
      <Pressable
        accessibilityLabel={`${toggleVerb ?? (selected ? "Deselect" : "Select")} ${title}`}
        accessibilityRole="checkbox"
        accessibilityState={{ selected }}
        className="min-w-0 flex-1 gap-1 py-1"
        onPress={onToggle}
      >
        <Text
          className="font-sans text-base text-foreground dark:text-foreground-dark"
          numberOfLines={1}
        >
          {title}
        </Text>
        {description ? (
          <Text
            className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark"
            numberOfLines={2}
          >
            {description}
          </Text>
        ) : null}
        {badges.length > 0 ? (
          <Text className="font-mono text-xs text-muted-foreground dark:text-muted-foreground-dark">
            {badges.join(" · ")}
          </Text>
        ) : null}
      </Pressable>
      <Button onPress={onOpenDetail} size="xs" variant="ghost">
        <Text style={{ color: theme.textSecondary, fontSize: 12 }}>Detail</Text>
      </Button>
    </View>
  );
}

export function SkillsModal(props: SkillsModalProps) {
  const theme = useTheme();
  const [query, setQuery] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);

  const visible = useMemo(
    () => props.skills.filter((skill) => matchesQuery(skill, query)),
    [props.skills, query],
  );
  const selected = useMemo(
    () => visible.filter((skill) => skill.selected),
    [visible],
  );
  const available = useMemo(
    () => visible.filter((skill) => skill.enabled && !skill.selected),
    [visible],
  );
  const disabled = useMemo(
    () => visible.filter((skill) => !skill.enabled),
    [visible],
  );
  const matchingProjects = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return props.projectSkills.filter(
      (skill) =>
        !needle ||
        skill.name.toLowerCase().includes(needle) ||
        (skill.description ?? "").toLowerCase().includes(needle),
    );
  }, [props.projectSkills, query]);

  const detailSkill = detailId
    ? (props.skills.find((skill) => skill.id === detailId) ?? null)
    : null;
  const detailProject = detailId
    ? (props.projectSkills.find((skill) => skill.id === detailId) ?? null)
    : null;

  const selectedCount = props.skills.filter((skill) => skill.selected).length;

  return (
    <Drawer
      onOpenChange={(open) => {
        if (!open) {
          setDetailId(null);
          setQuery("");
        }
        props.onOpenChange(open);
      }}
      open={props.open}
    >
      <DrawerContent showCloseButton showHandle>
        <DrawerHeader>
          {detailId ? (
            <View className="flex-row items-center gap-sp-2">
              <Button
                leftIcon={<ChevronLeft color={theme.text} size={16} />}
                onPress={() => setDetailId(null)}
                size="icon-xs"
                variant="ghost"
              />
              <DrawerTitle>Skill detail</DrawerTitle>
            </View>
          ) : (
            <DrawerTitle>Skills</DrawerTitle>
          )}
          <DrawerDescription>
            {detailId
              ? "Inspect before activating."
              : `${selectedCount} selected for this chat.`}
          </DrawerDescription>
        </DrawerHeader>
        <DrawerBody contentContainerClassName="gap-sp-2 pb-sp-4">
          {detailSkill ? (
            <SkillDetailView
              skill={{
                autoMatch: detailSkill.autoMatch,
                description: detailSkill.description,
                enabled: detailSkill.enabled,
                files: [],
                id: detailSkill.id,
                keywords: detailSkill.keywords,
                title: detailSkill.title,
              }}
              actions={
                !detailSkill.enabled ? (
                  <Button
                    onPress={() => {
                      props.onToggleEnabled(detailSkill.id);
                    }}
                  >
                    Enable skill
                  </Button>
                ) : (
                  <Button
                    onPress={() => {
                      props.onToggleSkill(detailSkill.id);
                    }}
                    variant={detailSkill.selected ? "outline" : "default"}
                  >
                    {detailSkill.selected ? "Deselect" : "Select for this chat"}
                  </Button>
                )
              }
            />
          ) : detailProject ? (
            <SkillDetailView
              instructionsPreview
              skill={{
                autoMatch: false,
                description: detailProject.description,
                enabled: true,
                files: detailProject.files.map((path) => ({ path, size: null })),
                id: detailProject.id,
                keywords: [],
                sourceLabel: detailProject.dir,
                title: detailProject.name,
                instructionsPreview: detailProject.instructions,
              }}
              actions={
                detailProject.invalidReason ? (
                  <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                    Cannot install: {detailProject.invalidReason}
                  </Text>
                ) : (
                  <Button
                    disabled={props.installingDir !== null}
                    onPress={() => props.onInstallProjectSkill(detailProject.dir)}
                  >
                    {props.installingDir === detailProject.dir
                      ? "Installing…"
                      : "Install to skills"}
                  </Button>
                )
              }
            />
          ) : (
            <>
              {props.notice ? (
                <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                  {props.notice}
                </Text>
              ) : null}
              <View className="flex-row items-center gap-sp-2 rounded-ui border border-border px-sp-2 py-1 dark:border-border-dark">
                <Search color={theme.textSecondary} size={14} />
                <TextInput
                  accessibilityLabel="Search skills"
                  autoCapitalize="none"
                  autoCorrect={false}
                  className="min-w-0 flex-1 font-sans text-sm text-foreground dark:text-foreground-dark"
                  onChangeText={setQuery}
                  placeholder="Search skills…"
                  placeholderTextColor={theme.textSecondary}
                  value={query}
                />
              </View>

              {selected.length > 0 ? (
                <View className="gap-sp-2">
                  <Text className="font-sans text-xs font-semibold uppercase text-muted-foreground dark:text-muted-foreground-dark">
                    Selected ({selected.length})
                  </Text>
                  {selected.map((skill) => (
                    <SkillRow
                      key={skill.id}
                      avatarSeed={skill.id}
                      badges={[
                        ...(skill.autoMatch ? ["Auto"] : []),
                        ...(skill.mcpAttention ? ["MCP attention"] : []),
                      ]}
                      description={skill.description}
                      onOpenDetail={() => setDetailId(skill.id)}
                      onToggle={() => props.onToggleSkill(skill.id)}
                      selected
                      title={skill.title}
                    />
                  ))}
                </View>
              ) : null}

              {matchingProjects.length > 0 ? (
                <View className="gap-sp-2">
                  <Text className="font-sans text-xs font-semibold uppercase text-muted-foreground dark:text-muted-foreground-dark">
                    From this project
                  </Text>
                  {matchingProjects.map((skill) => (
                    <SkillRow
                      key={skill.id}
                      avatarSeed={skill.id}
                      badges={[
                        "Project",
                        ...(skill.invalidReason ? ["Invalid"] : []),
                      ]}
                      description={skill.description ?? skill.dir}
                      onOpenDetail={() => setDetailId(skill.id)}
                      onToggle={() => setDetailId(skill.id)}
                      selected={false}
                      title={skill.name}
                    />
                  ))}
                </View>
              ) : null}

              <View className="gap-sp-2">
                <Text className="font-sans text-xs font-semibold uppercase text-muted-foreground dark:text-muted-foreground-dark">
                  Available ({available.length})
                </Text>
                {available.length > 0 ? (
                  available.map((skill) => (
                    <SkillRow
                      key={skill.id}
                      avatarSeed={skill.id}
                      badges={[
                        ...(skill.autoMatch ? ["Auto"] : []),
                        ...(skill.mcpAttention ? ["MCP attention"] : []),
                      ]}
                      description={skill.description}
                      onOpenDetail={() => setDetailId(skill.id)}
                      onToggle={() => props.onToggleSkill(skill.id)}
                      selected={false}
                      title={skill.title}
                    />
                  ))
                ) : (
                  <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                    {query ? "No skills match." : "No more skills."}
                  </Text>
                )}
              </View>

              {disabled.length > 0 ? (
                <View className="gap-sp-2">
                  <Text className="font-sans text-xs font-semibold uppercase text-muted-foreground dark:text-muted-foreground-dark">
                    Disabled ({disabled.length})
                  </Text>
                  {disabled.map((skill) => (
                    <SkillRow
                      key={skill.id}
                      avatarSeed={skill.id}
                      badges={["Disabled — tap to enable"]}
                      description={skill.description}
                      onOpenDetail={() => setDetailId(skill.id)}
                      onToggle={() => props.onToggleEnabled(skill.id)}
                      selected={false}
                      title={skill.title}
                      toggleVerb="Enable"
                    />
                  ))}
                </View>
              ) : null}

              {props.skills.length === 0 && matchingProjects.length === 0 ? (
                <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                  No skills yet. Import one or visit the Skill Store.
                </Text>
              ) : null}
            </>
          )}
        </DrawerBody>
        <DrawerFooter>
          <Button onPress={props.onImportSkill} variant="outline">
            Import
          </Button>
          <Button onPress={props.onOpenStore} variant="outline">
            Skill Store
          </Button>
          <Button onPress={props.onManageSkills} variant="outline">
            Manage
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
