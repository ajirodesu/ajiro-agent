import { useRouter } from "expo-router";
import { ChevronLeft, RefreshCw, Search } from "lucide-react-native";
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { Container } from "@/components/shared/container";
import { SkillAvatar } from "@/components/skills/skill-avatar";
import { SkillDetailView } from "@/components/skills/skill-detail-view";
import { SkillImportDrawer } from "@/components/skills/skill-import-drawer";
import { Button } from "@/components/ui/button";
import { AppHeader, CircleIconButton } from "@/components/ui/chrome";
import { withAlpha } from "@/components/ui/chrome-spec";
import { Card } from "@/components/ui/card";
import { useConfig } from "@/hooks/use-config";
import { useTheme } from "@/hooks/use-theme";
import { slugifySkillName, parseSkillMarkdown } from "@/modules/skills/skill-markdown";
import { fetchSkillMarkdownFromUrl } from "@/modules/skills/skill-github";
import { extractFrontmatterField } from "@/modules/skills/skill-validation";
import {
  deriveInstallState,
  filterStoreCatalog,
  loadStoreCatalog,
  searchStoreCatalog,
  storeCategories,
  type StoreSkillEntry,
} from "@/modules/skills/skill-store-catalog";
import { isSkillUpdateAvailable } from "@/modules/skills/skill-install";
import { resolveSkillMcpStatus } from "@/modules/skills/skill-scopes";
import type { SkillInstallProgress } from "@/modules/skills/skill-install";

type LiveDetail = {
  description: string;
  fileCount: number;
  files: { path: string; size: number | null }[];
  mcpIds: string[];
  license: string | null;
  offline: boolean;
};

function StateBadge({ state }: { state: string }) {
  const theme = useTheme();
  const colors: Record<string, string> = {
    Installed: theme.text,
    "Update available": theme.accent,
    Disabled: theme.textSecondary,
  };
  if (state === "Not installed") return null;
  return (
    <Text
      className="font-mono text-xs"
      style={{ color: colors[state] ?? theme.textSecondary }}
    >
      {state}
    </Text>
  );
}

export default function SkillStoreScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { installStoreSkill, mcpServers, skills, uninstallStoreSkill } = useConfig();

  const catalog = useMemo(() => loadStoreCatalog(), []);
  const categories = useMemo(() => storeCategories(catalog), [catalog]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [detailSlug, setDetailSlug] = useState<string | null>(null);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [phase, setPhase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updates, setUpdates] = useState<Set<string>>(new Set());
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [live, setLive] = useState<Record<string, LiveDetail>>({});

  const installedBySlug = useMemo(() => {
    const map = new Map<string, (typeof skills)[number]>();
    for (const skill of skills) {
      map.set(slugifySkillName(skill.title), skill);
    }
    return map;
  }, [skills]);

  const visible = useMemo(() => {
    const searched = searchStoreCatalog(catalog, query);
    return filterStoreCatalog(searched, { category });
  }, [catalog, query, category]);

  const openDetail = (entry: StoreSkillEntry) => {
    setDetailSlug(entry.slug);
    setError(null);
    if (live[entry.slug]) return;
    fetchSkillMarkdownFromUrl(entry.sourceUrl)
      .then(({ content }) => {
        const parsed = parseSkillMarkdown(content);
        setLive((current) => ({
          ...current,
          [entry.slug]: {
            description: parsed.description ?? entry.description,
            fileCount: parsed.files.length,
            files: parsed.files.map((path) => ({ path, size: null })),
            license: extractFrontmatterField(content, "license"),
            mcpIds: parsed.recommendedMcpServerIds,
            offline: false,
          },
        }));
      })
      .catch(() => {
        setLive((current) => ({
          ...current,
          [entry.slug]: {
            description: entry.description,
            fileCount: 0,
            files: [],
            license: null,
            mcpIds: [],
            offline: true,
          },
        }));
      });
  };

  const detailEntry = detailSlug
    ? (catalog.find((entry) => entry.slug === detailSlug) ?? null)
    : null;
  const detailInstalled = detailSlug ? (installedBySlug.get(detailSlug) ?? null) : null;

  const runAction = async (slug: string, action: () => Promise<void>) => {
    setBusySlug(slug);
    setError(null);
    setPhase(null);
    try {
      await action();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Store action failed.");
    } finally {
      setBusySlug(null);
      setPhase(null);
    }
  };

  const handleInstall = (entry: StoreSkillEntry) =>
    runAction(entry.slug, async () => {
      await installStoreSkill({
        author: entry.author,
        slug: entry.slug,
        sourceUrl: entry.sourceUrl,
        onProgress: (progress: SkillInstallProgress) => {
          setPhase(progress.phase === "done" || progress.phase === "error" ? null : progress.phase);
        },
      });
    });

  const handleUninstall = (entry: StoreSkillEntry) =>
    runAction(entry.slug, async () => {
      const installed = installedBySlug.get(entry.slug);
      if (!installed) return;
      await uninstallStoreSkill(installed.id);
      setUpdates((current) => {
        const next = new Set(current);
        next.delete(entry.slug);
        return next;
      });
    });

  const handleCheckUpdates = async () => {
    setCheckingUpdates(true);
    setError(null);
    try {
      const found = new Set<string>();
      for (const entry of catalog) {
        const installed = installedBySlug.get(entry.slug);
        if (!installed) continue;
        try {
          // Prefers the installed skill's stored origin URL, so skills
          // installed from a different URL for the same slug compare
          // against their own source instead of the catalog one.
          if (await isSkillUpdateAvailable(installed)) {
            found.add(entry.slug);
          }
        } catch {
          // One unreachable source must not block the rest.
        }
      }
      setUpdates(found);
    } finally {
      setCheckingUpdates(false);
    }
  };

  const stateLabel = (entry: StoreSkillEntry): string => {
    const installed = installedBySlug.get(entry.slug);
    if (!installed) return "Not installed";
    const state = deriveInstallState(
      entry,
      [
        {
          contentHash: null,
          enabled: installed.enabled,
          id: installed.id,
          slug: entry.slug,
          title: installed.title,
        },
      ],
      updates,
    );
    return state === "installed"
      ? "Installed"
      : state === "installed-disabled"
        ? "Disabled"
        : "Update available";
  };

  return (
    <Container
      scroll
      contentClassName="gap-sp-4 py-sp-4"
      includeBottomTabInset={false}
    >
      <AppHeader
        left={
          <CircleIconButton
            accessibilityLabel="Back"
            onPress={() => {
              if (detailSlug) {
                setDetailSlug(null);
              } else if (router.canGoBack()) {
                router.back();
              } else {
                router.push("/settings");
              }
            }}
          >
            <ChevronLeft color={theme.text} size={20} strokeWidth={2} />
          </CircleIconButton>
        }
        title={detailEntry ? detailEntry.name : "Skill Store"}
        subtitle={
          detailEntry
            ? `By ${detailEntry.author} · ${detailEntry.category}`
            : "Ajiro skill catalog"
        }
        right={
          !detailEntry ? (
            <CircleIconButton
              accessibilityLabel="Check for updates"
              onPress={handleCheckUpdates}
            >
              {checkingUpdates ? (
                <ActivityIndicator size="small" color={theme.textSecondary} />
              ) : (
                <RefreshCw color={theme.text} size={20} strokeWidth={2} />
              )}
            </CircleIconButton>
          ) : undefined
        }
      />

      {error ? (
        <Text className="font-sans text-xs text-foreground dark:text-foreground-dark">
          {error}
        </Text>
      ) : null}

      {detailEntry ? (
        <SkillDetailView
          skill={{
            description: live[detailEntry.slug]?.description ?? detailEntry.description,
            enabled: detailInstalled?.enabled ?? true,
            author: detailInstalled?.author ?? detailEntry.author,
            autoMatch: detailInstalled?.autoMatch ?? true,
            files:
              live[detailEntry.slug]?.files ??
              detailInstalled?.skillFiles.map((file) => ({
                path: file.path,
                size: file.size,
              })) ??
              [],
            id: detailEntry.slug,
            keywords: detailInstalled?.matchKeywords ?? [],
            license: live[detailEntry.slug]?.license ?? null,
            sourceLabel: `Catalog · ${detailEntry.author}`,
            title: detailEntry.name,
          }}
          mcp={
            live[detailEntry.slug]
              ? resolveSkillMcpStatus(
                  { recommendedMcpServerIds: live[detailEntry.slug]?.mcpIds ?? [] },
                  mcpServers,
                )
              : detailInstalled
                ? resolveSkillMcpStatus(detailInstalled, mcpServers)
                : null
          }
          actions={
            <>
              {!detailInstalled ? (
                <Button
                  disabled={busySlug !== null}
                  onPress={() => handleInstall(detailEntry)}
                >
                  {busySlug === detailEntry.slug
                    ? `Installing…${phase ? ` (${phase})` : ""}`
                    : "Install"}
                </Button>
              ) : (
                <>
                  {updates.has(detailEntry.slug) ? (
                    <Button
                      disabled={busySlug !== null}
                      onPress={() => handleInstall(detailEntry)}
                    >
                      {busySlug === detailEntry.slug ? "Updating…" : "Update"}
                    </Button>
                  ) : null}
                  <Button
                    disabled={busySlug !== null}
                    onPress={() => handleUninstall(detailEntry)}
                    variant="outline"
                  >
                    Uninstall
                  </Button>
                  <Button
                    onPress={() => router.push(`/settings/skills/${detailInstalled.id}`)}
                    variant="outline"
                  >
                    Manage
                  </Button>
                </>
              )}
            </>
          }
        />
      ) : (
        <>
          <View className="flex-row items-center gap-sp-2 rounded-ui border border-border px-sp-2 py-1 dark:border-border-dark">
            <Search color={theme.textSecondary} size={14} />
            <TextInput
              accessibilityLabel="Search the Skill Store"
              autoCapitalize="none"
              autoCorrect={false}
              className="min-w-0 flex-1 font-sans text-sm text-foreground dark:text-foreground-dark"
              onChangeText={setQuery}
              placeholder="Search skills…"
              placeholderTextColor={theme.textSecondary}
              value={query}
            />
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerClassName="gap-sp-1 pr-sp-1"
          >
            <FilterChip
              active={category === null}
              label="All"
              onPress={() => setCategory(null)}
            />
            {categories.map((entry) => (
              <FilterChip
                key={entry}
                active={category === entry}
                label={entry}
                onPress={() => setCategory(category === entry ? null : entry)}
              />
            ))}
          </ScrollView>

          {visible.length === 0 ? (
            <Card className="px-sp-4 py-sp-4">
              <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                {query ? "No skills match your search." : "The catalog is empty."}
              </Text>
            </Card>
          ) : (
            <View className="gap-sp-2">
              {visible.map((entry) => (
                <Pressable
                  key={entry.slug}
                  accessibilityLabel={`${entry.name}. ${stateLabel(entry)}`}
                  accessibilityRole="button"
                  onPress={() => openDetail(entry)}
                >
                  <Card className="px-sp-3 py-sp-2">
                    <View className="flex-row items-center gap-sp-3">
                      <SkillAvatar seed={entry.slug} title={entry.name} size={44} />
                      <View className="min-w-0 flex-1 gap-1">
                        <View className="flex-row items-center justify-between gap-sp-2">
                          <Text
                            className="min-w-0 flex-1 font-sans text-base font-semibold text-foreground dark:text-foreground-dark"
                            numberOfLines={1}
                          >
                            {entry.name}
                          </Text>
                          <StateBadge state={stateLabel(entry)} />
                        </View>
                        <Text
                          className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark"
                          numberOfLines={2}
                        >
                          {entry.description}
                        </Text>
                        <Text className="font-mono text-xs text-muted-foreground dark:text-muted-foreground-dark">
                          {entry.author} · {entry.category}
                        </Text>
                      </View>
                    </View>
                  </Card>
                </Pressable>
              ))}
            </View>
          )}

          <View className="flex-row flex-wrap gap-sp-2">
            <Button onPress={() => setImportOpen(true)} variant="outline">
              Import from URL
            </Button>
            <Button onPress={() => router.push("/settings/skills")} variant="outline">
              Manage installed
            </Button>
          </View>
        </>
      )}

      <SkillImportDrawer onOpenChange={setImportOpen} open={importOpen} />
    </Container>
  );
}

function FilterChip({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      className="rounded-full px-sp-3 py-1"
      style={({ pressed }) => ({
        borderWidth: active ? 1 : 0,
        borderColor: active ? theme.accent : "transparent",
        backgroundColor: active
          ? withAlpha(theme.accent, 0.18)
          : "transparent",
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text
        className="font-sans text-xs"
        style={{ color: active ? theme.text : theme.textSecondary }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
