/**
 * Bot commands page (`/bot/commands`) — list with per-command enable toggle
 * (custom pill design) + Delete, Add Command form, Import Repository
 * section, and toolbar bulk actions (Remove All Imported / Manual, Reset,
 * Download manual `.zip` with paired `.ts` + `.md` per command).
 */
import { useRouter } from "expo-router";
import * as Sharing from "expo-sharing";
import { ChevronLeft, Download, Plus, Trash2 } from "lucide-react-native";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal as ReactNativeModal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Directory, File, Paths } from "expo-file-system";

import { AppHeader, CircleIconButton } from "@/components/ui/chrome";
import { CommandBuilderSheet } from "@/components/bot/command-builder-sheet";
import { useBotCommands } from "@/hooks/use-bot-commands";
import { useTheme } from "@/hooks/use-theme";
import type { BotCommandItem } from "@/modules/bot/bot-service";

export default function BotCommandsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const bot = useBotCommands();
  const [builderOpen, setBuilderOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [repoUrl, setRepoUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const runBulk = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (err) {
      Alert.alert("Failed", err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const download = async () => {
    setBusy("Download");
    try {
      const bytes = await bot.downloadZip();
      const dir = new Directory(Paths.cache, "bot-commands");
      if (!dir.exists) dir.create();
      const file = new File(dir, `manual-commands-${Date.now()}.zip`);
      file.write(bytes);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri);
      } else {
        Alert.alert("Saved", `Manual commands saved to ${file.uri}`);
      }
    } catch (err) {
      Alert.alert("Failed", err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <SafeAreaView
      className="flex-1 bg-background dark:bg-background-dark"
      edges={["top", "left", "right", "bottom"]}
    >
      <View className="flex-1 gap-sp-2 px-sp-4" style={{ paddingTop: 12 }}>
        <AppHeader
          left={
            <CircleIconButton
              accessibilityLabel="Back"
              onPress={() => {
                router.back();
              }}
            >
              <ChevronLeft color={theme.text} size={20} strokeWidth={2} />
            </CircleIconButton>
          }
          title="Commands"
          subtitle={`${bot.items.length} total`}
          right={
            <CircleIconButton
              accessibilityLabel="Add command"
              onPress={() => {
                setSaveError(null);
                setBuilderOpen(true);
              }}
            >
              <Plus color={theme.text} size={20} strokeWidth={2} />
            </CircleIconButton>
          }
        />

        {bot.loading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="large" color={theme.textSecondary} />
          </View>
        ) : (
          <ScrollView
            className="flex-1"
            contentContainerClassName="gap-sp-3 pb-sp-6"
            showsVerticalScrollIndicator={false}
          >
            {/* Toolbar bulk actions */}
            <View className="flex-row flex-wrap gap-sp-2">
              <BulkButton label="Remove All Imported" busy={busy === "Remove All Imported"} onPress={() => void runBulk("Remove All Imported", bot.removeAllImported)} />
              <BulkButton label="Remove All Manual" busy={busy === "Remove All Manual"} onPress={() => void runBulk("Remove All Manual", bot.removeAllManual)} />
              <BulkButton label="Reset" busy={busy === "Reset"} onPress={() => void runBulk("Reset", bot.reset)} />
              <BulkButton label="Download" icon={<Download color={theme.text} size={15} />} busy={busy === "Download"} onPress={() => void download()} />
            </View>

            {/* Import repository */}
            <View className="gap-sp-2 rounded-3xl border border-border p-sp-4 dark:border-border-dark">
              <Text className="font-sans text-base font-semibold text-foreground dark:text-foreground-dark">
                Import Repository
              </Text>
              <TextInput
                className="min-h-11 rounded-xl border border-border bg-input px-sp-3 font-sans text-base text-foreground dark:border-border-dark dark:bg-input-dark dark:text-foreground-dark"
                placeholder="owner/repo or https://github.com/owner/repo"
                placeholderTextColor={theme.textSecondary}
                value={repoUrl}
                onChangeText={setRepoUrl}
                autoCapitalize="none"
              />
              {importError ? (
                <Text className="font-sans text-sm text-destructive dark:text-destructive-dark">
                  {importError}
                </Text>
              ) : null}
              <Pressable
                accessibilityRole="button"
                disabled={importing || !repoUrl.trim()}
                onPress={() => {
                  setImporting(true);
                  setImportError(null);
                  bot
                    .addRepository(repoUrl)
                    .then((result) => {
                      setRepoUrl("");
                      if (result.skipped.length > 0) {
                        setImportError(
                          `Imported ${result.importedCount}; skipped ${result.skipped.length} file(s).`,
                        );
                      }
                    })
                    .catch((err) => {
                      setImportError(err instanceof Error ? err.message : String(err));
                    })
                    .finally(() => setImporting(false));
                }}
                className="h-11 items-center justify-center rounded-full bg-secondary dark:bg-secondary-dark"
                style={{ opacity: importing ? 0.6 : 1 }}
              >
                {importing ? (
                  <ActivityIndicator size="small" color={theme.text} />
                ) : (
                  <Text className="font-sans text-base font-semibold text-foreground dark:text-foreground-dark">
                    Scan & import
                  </Text>
                )}
              </Pressable>
              {bot.repositories.map((r) => (
                <View key={r.id} className="flex-row items-center gap-sp-2 rounded-2xl bg-card p-sp-3 dark:bg-card-dark">
                  <Text numberOfLines={1} className="flex-1 font-mono text-xs text-foreground dark:text-foreground-dark">
                    {r.url}
                  </Text>
                  <Pressable
                    accessibilityLabel={`Remove repository ${r.url}`}
                    accessibilityRole="button"
                    hitSlop={8}
                    onPress={() => {
                      void runBulk("Remove repository", () => bot.removeRepository(r.id));
                    }}
                  >
                    <Text className="font-sans text-sm font-medium text-destructive dark:text-destructive-dark">
                      Remove Repository
                    </Text>
                  </Pressable>
                </View>
              ))}
            </View>

            {/* Command tiles */}
            {bot.items.length === 0 ? (
              <Text className="px-sp-1 py-sp-4 text-center font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                No commands yet. Build one with Add Command or import a repository.
              </Text>
            ) : (
              bot.items.map((item) => (
                <CommandTile
                  key={item.name}
                  item={item}
                  onToggle={(enabled) => {
                    void runBulk("toggle", () => bot.toggle(item.name, enabled));
                  }}
                  onDelete={() => {
                    Alert.alert("Delete command", `Delete /${item.name}?`, [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Delete",
                        style: "destructive",
                        onPress: () => {
                          void runBulk("delete", () => bot.remove(item.name));
                        },
                      },
                    ]);
                  }}
                />
              ))
            )}
          </ScrollView>
        )}
      </View>

      {/* Add Command */}
      <ReactNativeModal
        animationType="slide"
        onRequestClose={() => setBuilderOpen(false)}
        statusBarTranslucent
        visible={builderOpen}
      >
        <View className="flex-1 bg-background dark:bg-background-dark" style={{ paddingTop: insets.top + 8 }}>
          <View className="flex-row items-center gap-sp-3 px-sp-4 pb-sp-2">
            <CircleIconButton
              accessibilityLabel="Close builder"
              onPress={() => setBuilderOpen(false)}
            >
              <ChevronLeft color={theme.text} size={20} strokeWidth={2} />
            </CircleIconButton>
            <Text className="flex-1 font-sans text-xl font-bold text-foreground dark:text-foreground-dark">
              Add Command
            </Text>
          </View>
          <CommandBuilderSheet
            fetching={fetching}
            fetchError={fetchError}
            saving={saving}
            saveError={saveError}
            onFetch={async (input) => {
              setFetching(true);
              setFetchError(null);
              try {
                return await bot.fetchEndpoint(input);
              } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                setFetchError(message);
                throw err;
              } finally {
                setFetching(false);
              }
            }}
            onSubmit={async (config, apiKey) => {
              setSaving(true);
              setSaveError(null);
              try {
                await bot.create(config, apiKey);
                setBuilderOpen(false);
              } catch (err) {
                setSaveError(err instanceof Error ? err.message : String(err));
                throw err;
              } finally {
                setSaving(false);
              }
            }}
          />
        </View>
      </ReactNativeModal>
    </SafeAreaView>
  );
}

function BulkButton({ label, busy, onPress, icon }: { label: string; busy: boolean; onPress: () => void; icon?: React.ReactNode }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      disabled={busy}
      onPress={onPress}
      className="flex-row items-center gap-sp-1 rounded-full border border-border px-sp-3 py-sp-2 dark:border-border-dark"
      style={{ opacity: busy ? 0.6 : 1 }}
    >
      {busy ? <ActivityIndicator size="small" color={theme.textSecondary} /> : icon}
      <Text className="font-sans text-sm font-medium text-foreground dark:text-foreground-dark">
        {label}
      </Text>
    </Pressable>
  );
}

function CommandTile({
  item,
  onToggle,
  onDelete,
}: {
  item: BotCommandItem;
  onToggle: (enabled: boolean) => void;
  onDelete: () => void;
}) {
  const theme = useTheme();
  return (
    <View className="gap-sp-2 rounded-3xl bg-card p-sp-4 dark:bg-card-dark">
      <View className="flex-row items-center gap-sp-3">
        <View className="min-w-0 flex-1">
          <Text className="font-mono text-base font-semibold text-foreground dark:text-foreground-dark">
            /{item.name}
          </Text>
          <Text numberOfLines={2} className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
            {item.description || "No description"}
          </Text>
        </View>
        {/* Custom enable pill (fresh design, not the shared Switch style) */}
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: item.enabled }}
          accessibilityLabel={`${item.enabled ? "Disable" : "Enable"} ${item.name}`}
          onPress={() => onToggle(!item.enabled)}
          className="h-9 w-16 items-center justify-center rounded-full"
          style={{
            backgroundColor: item.enabled ? theme.accent : theme.border,
          }}
        >
          <Text
            className="font-sans text-xs font-bold"
            style={{
              color: item.enabled ? theme.accentForeground : theme.textSecondary,
            }}
          >
            {item.enabled ? "ON" : "OFF"}
          </Text>
        </Pressable>
        <Pressable
          accessibilityLabel={`Delete ${item.name}`}
          accessibilityRole="button"
          hitSlop={8}
          onPress={onDelete}
          className="p-sp-1"
        >
          <Trash2 color={theme.destructive} size={18} />
        </Pressable>
      </View>
      <View className="flex-row items-center gap-sp-2">
        <Text className="rounded-full bg-secondary px-sp-2 py-0.5 font-sans text-xs text-foreground dark:bg-secondary-dark dark:text-foreground-dark">
          {item.source}
        </Text>
        <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
          {item.category} · {item.cooldown}s
        </Text>
        {item.requiresApiKey ? (
          <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
            · {item.hasApiKey ? "🔑 key saved" : "🔑 key needed"}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
