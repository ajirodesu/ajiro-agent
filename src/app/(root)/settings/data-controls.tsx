/**
 * Data Controls: backup ownership for the local SQLite database.
 *
 * Export assembles all 18 user-content tables (plus settings and the
 * memory document) into one checksum-manifested ZIP; import validates the
 * manifest before touching the database and applies inside a single
 * transaction; Clear Chat History removes conversations, messages, runs,
 * and orphaned checkpoints only. API keys and credentials are never in
 * the database, so they are never in the backup — the export notice and
 * the post-import banner both say so.
 */
import { useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { ChevronLeft, DatabaseBackup, Download, Trash2, Upload } from "lucide-react-native";
import { useState } from "react";
import { Alert, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Container } from "@/components/shared/container";
import { Button } from "@/components/ui/button";
import { AppHeader, CircleIconButton } from "@/components/ui/chrome";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useConfig } from "@/hooks/use-config";
import { useTheme } from "@/hooks/use-theme";
import { parseBackupBundle } from "@/modules/backup/backup";
import { buildZip, parseZip } from "@/modules/backup/zip";

function backupFileName(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `ajiro-agent-backup-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.zip`
  );
}

type Banner =
  | { kind: "error"; text: string }
  | { kind: "notice"; text: string }
  | null;

export default function DataControlsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { clearChatHistoryData, exportBackupData, importBackupData } = useConfig();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [banner, setBanner] = useState<Banner>(null);
  const [importCounts, setImportCounts] = useState<{
    botCommands: number;
    mcpServers: number;
    providers: number;
  } | null>(null);
  const [exportSlow, setExportSlow] = useState(false);

  const runAction = async (key: string, action: () => Promise<void>) => {
    setBusyKey(key);
    setBanner(null);
    setImportCounts(null);
    try {
      await action();
    } catch (actionError) {
      setBanner({
        kind: "error",
        text: actionError instanceof Error ? actionError.message : "Action failed.",
      });
    } finally {
      setBusyKey(null);
      setExportSlow(false);
    }
  };

  const handleExport = () =>
    runAction("export", async () => {
      const slowTimer = setTimeout(() => setExportSlow(true), 1000);
      try {
        const collected = await exportBackupData();
        const archive = buildZip([
          { data: new TextEncoder().encode(JSON.stringify(collected.manifest)), name: "manifest.json" },
          ...Object.entries(collected.files).map(([name, file]) => ({
            data: new TextEncoder().encode(file.json),
            name,
          })),
        ]);
        const dir = new Directory(Paths.cache, "backups");
        if (!dir.exists) dir.create();
        const file = new File(dir, backupFileName(new Date()));
        file.write(archive);
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(file.uri);
        } else {
          setBanner({ kind: "notice", text: `Backup saved to ${file.uri}` });
        }
      } finally {
        clearTimeout(slowTimer);
      }
    });

  const applyImport = async (bytes: Uint8Array, mode: "merge" | "replace") => {
    const entries = parseZip(bytes);
    const files: Record<string, string> = {};
    const decoder = new TextDecoder();
    for (const entry of entries) {
      files[entry.name] = decoder.decode(entry.data);
    }
    const counts = await importBackupData(files, mode);
    setImportCounts(counts);
    const parts: string[] = [];
    if (counts.providers > 0) {
      parts.push(`${counts.providers} provider(s)`);
    }
    if (counts.mcpServers > 0) {
      parts.push(`${counts.mcpServers} MCP server(s)`);
    }
    if (counts.botCommands > 0) {
      parts.push(`${counts.botCommands} bot command(s)`);
    }
    setBanner({
      kind: "notice",
      text:
        parts.length > 0
          ? `Restored, but API keys are never backed up: ${parts.join(", ")} need their keys re-entered before use.`
          : "Backup restored.",
    });
  };

  const handleImport = () =>
    runAction("import", async () => {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
        type: ["application/zip", "application/x-zip-compressed"],
      });
      if (result.canceled || result.assets.length === 0) return;
      const asset = result.assets[0]!;
      if (!asset.name.toLowerCase().endsWith(".zip")) {
        throw new Error("Please choose a .zip backup file.");
      }
      const bytes = new Uint8Array(await new File(asset.uri).arrayBuffer());
      // Validate before offering a choice, so Merge/Replace only ever
      // appears for a bundle that can actually import.
      await applyImportProbe(bytes);
      const choice = await new Promise<"merge" | "replace" | null>((resolve) => {
        Alert.alert(
          "Restore backup",
          "Merge with existing data, or replace everything?",
          [
            { style: "cancel", text: "Cancel", onPress: () => resolve(null) },
            { text: "Merge", onPress: () => resolve("merge") },
            {
              style: "destructive",
              text: "Replace all",
              onPress: () => resolve("replace"),
            },
          ],
        );
      });
      if (!choice) return;
      await applyImport(bytes, choice);
    });

  const applyImportProbe = async (bytes: Uint8Array): Promise<void> => {
    // A dry parse: malformed archives and bad checksums throw here, before
    // the Merge/Replace dialog and long before any database write.
    const entries = parseZip(bytes);
    const decoder = new TextDecoder();
    parseBackupBundle(
      Object.fromEntries(
        entries.map((entry) => [entry.name, decoder.decode(entry.data)]),
      ),
    );
  };

  const handleClearHistory = () => {
    Alert.alert(
      "Clear chat history?",
      "This will permanently delete all conversations. This cannot be undone.",
      [
        { style: "cancel", text: "Cancel" },
        {
          style: "destructive",
          text: "Clear",
          onPress: () => {
            void runAction("clear", async () => {
              const counts = await clearChatHistoryData();
              setBanner({
                kind: "notice",
                text:
                  `Deleted ${counts.conversations} conversation(s), ` +
                  `${counts.messages} message(s), ${counts.agentRuns} run(s)` +
                  (counts.checkpoints > 0
                    ? `, and ${counts.checkpoints} orphaned checkpoint(s).`
                    : "."),
              });
            });
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView
      className="flex-1 bg-background dark:bg-background-dark"
      edges={["top", "left", "right"]}
    >
      <Container scroll contentClassName="gap-sp-4 py-sp-4" includeBottomTabInset={false}>
        <AppHeader
          left={
            <CircleIconButton
              accessibilityLabel="Back"
              onPress={() => {
                if (router.canGoBack()) router.back();
                else router.push("/settings");
              }}
            >
              <ChevronLeft color={theme.text} size={20} strokeWidth={2} />
            </CircleIconButton>
          }
          title="Data Controls"
        />

        <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
          For security, saved API keys and server credentials are not included
          in backups — you&apos;ll need to re-enter them after importing.
        </Text>

        <Card className="gap-sp-3 px-sp-4 py-sp-4">
          <View className="flex-row items-center gap-sp-3">
            <DatabaseBackup color={theme.text} size={22} strokeWidth={2} />
            <View className="min-w-0 flex-1">
              <Text className="font-sans text-base font-medium text-foreground dark:text-foreground-dark">
                Export Data
              </Text>
              <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                Download a complete backup of your conversations, agents, and
                settings.
              </Text>
            </View>
          </View>
          <Button
            disabled={busyKey !== null}
            leftIcon={<Download color={theme.accentForeground} size={16} />}
            loading={busyKey === "export"}
            onPress={() => {
              void handleExport();
            }}
          >
            {exportSlow && busyKey === "export" ? "Preparing export…" : "Export"}
          </Button>
        </Card>

        <Card className="gap-sp-3 px-sp-4 py-sp-4">
          <View className="flex-row items-center gap-sp-3">
            <Upload color={theme.text} size={22} strokeWidth={2} />
            <View className="min-w-0 flex-1">
              <Text className="font-sans text-base font-medium text-foreground dark:text-foreground-dark">
                Import Data
              </Text>
              <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                Restore conversations, agents, and settings from a backup file.
              </Text>
            </View>
          </View>
          <Button
            disabled={busyKey !== null}
            loading={busyKey === "import"}
            onPress={() => {
              void handleImport();
            }}
            variant="outline"
          >
            Import
          </Button>
        </Card>

        {banner ? (
          <Card className="gap-sp-2 px-sp-4 py-sp-4">
            <Text
              className={
                banner.kind === "error"
                  ? "font-sans text-sm text-destructive dark:text-destructive-dark"
                  : "font-sans text-sm text-foreground dark:text-foreground-dark"
              }
            >
              {banner.text}
            </Text>
            {banner.kind === "notice" && importCounts ? (
              <View className="gap-sp-2">
                <Separator />
                <Button
                  onPress={() => router.push("/settings/providers" as never)}
                  variant="outline"
                >
                  Re-enter provider keys
                </Button>
                <Button
                  onPress={() => router.push("/settings/mcp" as never)}
                  variant="outline"
                >
                  Re-enter MCP credentials
                </Button>
                <Button
                  onPress={() => router.push("/bot/commands" as never)}
                  variant="outline"
                >
                  Re-enter bot command keys
                </Button>
              </View>
            ) : null}
          </Card>
        ) : null}

        <Card className="gap-sp-3 px-sp-4 py-sp-4">
          <View className="flex-row items-center gap-sp-3">
            <Trash2 color={theme.destructive} size={22} strokeWidth={2} />
            <View className="min-w-0 flex-1">
              <Text className="font-sans text-base font-medium text-destructive dark:text-destructive-dark">
                Clear Chat History
              </Text>
              <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                Permanently delete all conversations, messages, and run
                history. Memory, providers, skills, and schedules are kept.
              </Text>
            </View>
          </View>
          <Button
            disabled={busyKey !== null}
            loading={busyKey === "clear"}
            onPress={handleClearHistory}
            variant="destructive"
          >
            Clear history
          </Button>
        </Card>
      </Container>
    </SafeAreaView>
  );
}
