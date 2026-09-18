/**
 * Memory settings: explicit enable toggle, memory summary, personalization
 * (nickname/occupation/about-me), and the local memory.md document.
 *
 * Nickname/occupation/about-me are live AI inputs, not inert strings:
 * updateUserProfile persists them to app_settings and agent-run injects
 * them into every turn through buildMemorySystemPrompt whenever memory is
 * enabled. When memory is OFF the rows below dim and go non-interactive,
 * matching the injection being skipped.
 */
import { useFocusEffect, useRouter } from "expo-router";
import {
  BookOpen,
  Briefcase,
  ChevronLeft,
  ChevronRight,
  Heart,
  ListChecks,
  User,
} from "lucide-react-native";
import { useCallback, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

import { Container } from "@/components/shared/container";
import { AppHeader, CircleIconButton } from "@/components/ui/chrome";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useConfig } from "@/hooks/use-config";
import { useTheme } from "@/hooks/use-theme";
import { cn } from "@/core/utils";

function MemoryToggleRow({
  busy,
  checked,
  onToggle,
}: {
  busy: boolean;
  checked: boolean;
  onToggle: (enabled: boolean) => void;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked, disabled: busy }}
      className={cn(
        "min-h-12 flex-row items-center justify-between gap-sp-3 px-sp-4 py-sp-3",
        busy && "opacity-50",
      )}
      disabled={busy}
      onPress={() => onToggle(!checked)}
      style={({ pressed }) => (pressed && !busy ? { opacity: 0.84 } : null)}
    >
      <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
        Enable Memory
      </Text>
      <View pointerEvents="none">
        <Checkbox checked={checked} onCheckedChange={() => {}} />
      </View>
    </Pressable>
  );
}

function NavRow({
  description,
  disabled,
  icon,
  onPress,
  title,
  value,
}: {
  description?: string;
  disabled?: boolean;
  icon: ReactNode;
  onPress: () => void;
  title: string;
  value?: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      className="min-h-16 flex-row items-center gap-sp-3 px-sp-4 py-sp-3"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => (pressed && !disabled ? { opacity: 0.84 } : null)}
    >
      <View className="size-10 items-center justify-center rounded-xl bg-muted dark:bg-muted-dark">
        {icon}
      </View>
      <View className="min-w-0 flex-1">
        <Text className="font-sans text-base font-medium text-foreground dark:text-foreground-dark">
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
        {value ? (
          <Text
            className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark"
            numberOfLines={1}
          >
            {value}
          </Text>
        ) : null}
      </View>
      <ChevronRight color={theme.textSecondary} size={18} />
    </Pressable>
  );
}

export default function SettingsMemoryScreen() {
  const router = useRouter();
  const theme = useTheme();
  const {
    memoryEnabled,
    updateMemoryEnabled,
    getUserProfile,
    updateUserProfile,
    listMemoryEntries,
  } = useConfig();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nickname, setNickname] = useState("");
  const [occupation, setOccupation] = useState("");
  const [aboutPreview, setAboutPreview] = useState<string | null>(null);
  const [memoryCount, setMemoryCount] = useState<number | null>(null);

  const loadProfile = useCallback(async () => {
    try {
      const profile = await getUserProfile();
      setNickname(profile.nickname ?? "");
      setOccupation(profile.occupation ?? "");
      setAboutPreview(profile.aboutMe?.trim() ? profile.aboutMe.trim() : null);
      const entries = await listMemoryEntries();
      setMemoryCount(entries.filter((entry) => !entry.archivedAt).length);
    } catch {
      // Profile stays blank; rows still render and save on blur.
    }
  }, [getUserProfile, listMemoryEntries]);

  useFocusEffect(
    useCallback(() => {
      void loadProfile();
    }, [loadProfile]),
  );

  const runAction = async (key: string, action: () => Promise<void>) => {
    setBusyKey(key);
    setError(null);
    try {
      await action();
    } catch (actionError) {
      setError(
        actionError instanceof Error ? actionError.message : "Memory action failed.",
      );
    } finally {
      setBusyKey(null);
    }
  };

  const saveNickname = () =>
    runAction("nickname", async () => {
      await updateUserProfile({ nickname: nickname.trim() || null });
    });

  const saveOccupation = () =>
    runAction("occupation", async () => {
      await updateUserProfile({ occupation: occupation.trim() || null });
    });

  const dimmed = !memoryEnabled;

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
                router.push("/settings");
              }
            }}
          >
            <ChevronLeft color={theme.text} size={20} strokeWidth={2} />
          </CircleIconButton>
        }
        title="Memory"
      />

      <Card className="overflow-hidden">
        <MemoryToggleRow
          busy={busyKey === "memory-enabled"}
          checked={memoryEnabled}
          onToggle={(enabled) => {
            void runAction("memory-enabled", async () => {
              await updateMemoryEnabled(enabled);
            });
          }}
        />
      </Card>

      <View style={dimmed ? { opacity: 0.5 } : null} pointerEvents={dimmed ? "none" : "auto"}>
        <View className="gap-sp-4">
          <Card className="overflow-hidden">
            <NavRow
              description="Individual saved memories"
              icon={<ListChecks color={theme.text} size={19} />}
              onPress={() => router.push("/settings/memory/summary" as never)}
              title="Memory Summary"
              value={
                memoryCount === null
                  ? undefined
                  : memoryCount === 0
                    ? "No saved memories"
                    : `${memoryCount} saved`
              }
            />
            <NavRow
              description="Freeform memory document"
              icon={<BookOpen color={theme.text} size={19} />}
              onPress={() => router.push("/settings/memory/local" as never)}
              title="Memory document"
              value="memory.md"
            />
          </Card>

          <Card className="gap-sp-3 px-sp-4 py-sp-4">
            <View className="flex-row items-center gap-sp-3">
              <User color={theme.text} size={19} />
              <Text className="font-sans text-base font-medium text-foreground dark:text-foreground-dark">
                Your Nickname
              </Text>
            </View>
            <Input
              autoCapitalize="words"
              autoCorrect={false}
              onBlur={() => {
                void saveNickname();
              }}
              onChangeText={setNickname}
              placeholder="What should Ajiro Agent call you?"
              value={nickname}
            />
            <View className="flex-row items-center gap-sp-3">
              <Briefcase color={theme.text} size={19} />
              <Text className="font-sans text-base font-medium text-foreground dark:text-foreground-dark">
                Your Occupation
              </Text>
            </View>
            <Input
              autoCapitalize="words"
              autoCorrect={false}
              onBlur={() => {
                void saveOccupation();
              }}
              onChangeText={setOccupation}
              placeholder="Engineer, student, designer, etc."
              value={occupation}
            />
          </Card>

          <Card className="overflow-hidden">
            <NavRow
              description="Interests, values, preferences"
              icon={<Heart color={theme.text} size={19} />}
              onPress={() => router.push("/settings/memory/about" as never)}
              title="More About You"
              value={aboutPreview ?? "Not set"}
            />
          </Card>
        </View>
      </View>

      {error ? (
        <Text className="font-sans text-sm text-destructive dark:text-destructive-dark">
          {error}
        </Text>
      ) : null}
      {busyKey ? (
        <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
          Saving…
        </Text>
      ) : null}
    </Container>
  );
}
