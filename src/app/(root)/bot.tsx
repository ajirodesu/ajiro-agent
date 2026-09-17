/**
 * Bot console (`/bot`) — home for bot-level actions: Bot Mode / Agent Mode
 * selector (modal trigger), command counts, and entry to the command list.
 */
import { useRouter } from "expo-router";
import { Bot, ChevronLeft, ChevronRight, ListOrdered, Sparkles } from "lucide-react-native";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppHeader, CircleIconButton } from "@/components/ui/chrome";
import { BotModeModal } from "@/components/bot/bot-mode-modal";
import { useBotCommands } from "@/hooks/use-bot-commands";
import { useTheme } from "@/hooks/use-theme";

export default function BotConsoleScreen() {
  const router = useRouter();
  const theme = useTheme();
  const bot = useBotCommands();
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const manualCount = bot.items.filter((i) => i.source === "manual").length;
  const importedCount = bot.items.filter((i) => i.source === "imported").length;

  return (
    <SafeAreaView
      className="flex-1 bg-background dark:bg-background-dark"
      edges={["top", "left", "right", "bottom"]}
    >
      <View className="flex-1 gap-sp-3 px-sp-4" style={{ paddingTop: 12 }}>
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
          title="Bot"
          subtitle="Built-in bot console"
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
            {/* Mode card */}
            <Pressable
              accessibilityRole="button"
              onPress={() => setModalOpen(true)}
              className="gap-sp-2 rounded-3xl border border-border p-sp-4 dark:border-border-dark"
              style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
            >
              <View className="flex-row items-center gap-sp-3">
                <View
                  className="h-12 w-12 items-center justify-center rounded-2xl"
                  style={{ backgroundColor: `${theme.accent}1F` }}
                >
                  {bot.mode === "agent" ? (
                    <Sparkles color={theme.accent} size={24} strokeWidth={2} />
                  ) : (
                    <Bot color={theme.textSecondary} size={24} strokeWidth={2} />
                  )}
                </View>
                <View className="min-w-0 flex-1">
                  <Text className="font-sans text-lg font-semibold text-foreground dark:text-foreground-dark">
                    {bot.mode === "agent" ? "Agent Mode" : "Bot Mode"}
                  </Text>
                  <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                    {bot.mode === "agent"
                      ? "Talks back conversationally + conversational command authoring"
                      : "Only responds to matched commands"}
                  </Text>
                </View>
                <ChevronRight color={theme.textSecondary} size={20} />
              </View>
            </Pressable>

            {/* Stats */}
            <View className="flex-row gap-sp-3">
              <StatCard label="Manual" value={manualCount} />
              <StatCard label="Imported" value={importedCount} />
              <StatCard label="Repos" value={bot.repositories.length} />
            </View>

            {/* Commands entry */}
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                router.push("/bot/commands" as never);
              }}
              className="flex-row items-center gap-sp-3 rounded-3xl bg-card p-sp-4 dark:bg-card-dark"
              style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
            >
              <ListOrdered color={theme.text} size={22} strokeWidth={2} />
              <View className="min-w-0 flex-1">
                <Text className="font-sans text-base font-semibold text-foreground dark:text-foreground-dark">
                  Commands
                </Text>
                <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                  Build, import, enable, and manage bot commands
                </Text>
              </View>
              <ChevronRight color={theme.textSecondary} size={20} />
            </Pressable>

            {bot.mode === "agent" ? (
              <Text className="px-sp-1 font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                Agent Mode also exposes conversational command authoring
                (generate / add / edit / remove) to this bot&apos;s owner,
                alongside the builder form and repository import.
              </Text>
            ) : null}

            {bot.error ? (
              <Text className="font-sans text-sm text-destructive dark:text-destructive-dark">
                {bot.error}
              </Text>
            ) : null}
          </ScrollView>
        )}
      </View>

      <BotModeModal
        visible={modalOpen}
        initial={bot.mode}
        saving={saving}
        onClose={() => setModalOpen(false)}
        onSave={(next) => {
          setSaving(true);
          bot
            .setMode(next)
            .then(() => setModalOpen(false))
            .catch(() => {})
            .finally(() => setSaving(false));
        }}
      />
    </SafeAreaView>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <View className="flex-1 items-center gap-sp-1 rounded-3xl bg-card py-sp-4 dark:bg-card-dark">
      <Text className="font-sans text-2xl font-bold text-foreground dark:text-foreground-dark">
        {value}
      </Text>
      <Text className="font-sans text-xs uppercase tracking-wider text-muted-foreground dark:text-muted-foreground-dark">
        {label}
      </Text>
    </View>
  );
}
