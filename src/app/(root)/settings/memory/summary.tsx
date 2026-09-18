/**
 * Memory Summary: the `memories` table as individually deletable bullets.
 * "Clear all" removes memories rows only — never memory.md (the freeform
 * document) and never conversations. The document stays reachable through
 * the "Edit memory document" row, preserving memory/local.tsx.
 */
import { useFocusEffect, useRouter } from "expo-router";
import { ChevronLeft, ChevronRight, FileText, Trash2 } from "lucide-react-native";
import { useCallback, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";

import { Container } from "@/components/shared/container";
import { Button } from "@/components/ui/button";
import { AppHeader, CircleIconButton } from "@/components/ui/chrome";
import { Card } from "@/components/ui/card";
import { useConfig } from "@/hooks/use-config";
import { useTheme } from "@/hooks/use-theme";
import type { MemoryEntry } from "@/core/types/app-state";

export default function MemorySummaryScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { clearMemoryEntries, deleteMemoryEntry, listMemoryEntries } = useConfig();
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const rows = await listMemoryEntries();
      setEntries(rows.filter((entry) => !entry.archivedAt));
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Could not load memories.",
      );
    }
  }, [listMemoryEntries]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const runAction = async (key: string, action: () => Promise<void>) => {
    setBusyKey(key);
    setError(null);
    try {
      await action();
      await reload();
    } catch (actionError) {
      setError(
        actionError instanceof Error ? actionError.message : "Memory action failed.",
      );
    } finally {
      setBusyKey(null);
    }
  };

  const confirmDelete = (entry: MemoryEntry) => {
    Alert.alert("Delete memory?", "This saved memory will be removed.", [
      { style: "cancel", text: "Cancel" },
      {
        style: "destructive",
        text: "Delete",
        onPress: () => {
          void runAction(`delete:${entry.id}`, async () => {
            await deleteMemoryEntry(entry.id);
          });
        },
      },
    ]);
  };

  const confirmClearAll = () => {
    Alert.alert(
      "Clear all memories?",
      "Every saved memory will be removed. The memory document and conversations are kept.",
      [
        { style: "cancel", text: "Cancel" },
        {
          style: "destructive",
          text: "Clear all",
          onPress: () => {
            void runAction("clear-all", async () => {
              await clearMemoryEntries();
            });
          },
        },
      ],
    );
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
              if (router.canGoBack()) {
                router.back();
              } else {
                router.push("/settings/memory");
              }
            }}
          >
            <ChevronLeft color={theme.text} size={20} strokeWidth={2} />
          </CircleIconButton>
        }
        title="Memory Summary"
      />

      {entries.length === 0 ? (
        <Card className="px-sp-4 py-sp-4">
          <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
            Ajiro Agent hasn&apos;t saved any memories yet.
          </Text>
        </Card>
      ) : (
        <Card className="gap-sp-1 px-sp-4 py-sp-3">
          {entries.map((entry) => (
            <View key={entry.id} className="flex-row items-start gap-sp-2">
              <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                •
              </Text>
              <Text className="min-w-0 flex-1 font-sans text-sm text-foreground dark:text-foreground-dark">
                {entry.content}
              </Text>
              <Pressable
                accessibilityLabel={`Delete memory: ${entry.content.slice(0, 60)}`}
                accessibilityRole="button"
                disabled={busyKey !== null}
                hitSlop={8}
                onPress={() => confirmDelete(entry)}
                style={({ pressed }) => (pressed ? { opacity: 0.7 } : null)}
              >
                <Trash2 color={theme.textSecondary} size={16} />
              </Pressable>
            </View>
          ))}
        </Card>
      )}

      {entries.length > 0 ? (
        <Button
          disabled={busyKey !== null}
          loading={busyKey === "clear-all"}
          onPress={confirmClearAll}
          variant="destructive"
        >
          Clear all memories
        </Button>
      ) : null}

      <Card className="overflow-hidden">
        <Pressable
          accessibilityRole="button"
          className="min-h-16 flex-row items-center gap-sp-3 px-sp-4 py-sp-3"
          onPress={() => router.push("/settings/memory/local" as never)}
          style={({ pressed }) => (pressed ? { opacity: 0.84 } : null)}
        >
          <View className="size-10 items-center justify-center rounded-xl bg-muted dark:bg-muted-dark">
            <FileText color={theme.text} size={19} />
          </View>
          <View className="min-w-0 flex-1">
            <Text className="font-sans text-base font-medium text-foreground dark:text-foreground-dark">
              Edit memory document
            </Text>
            <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
              memory.md
            </Text>
          </View>
          <ChevronRight color={theme.textSecondary} size={18} />
        </Pressable>
      </Card>

      {error ? (
        <Text className="font-sans text-sm text-destructive dark:text-destructive-dark">
          {error}
        </Text>
      ) : null}
    </Container>
  );
}
