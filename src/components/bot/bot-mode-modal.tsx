/**
 * BotModeModal — per-bot Bot Mode / Agent Mode selector.
 *
 * Fresh bottom-sheet design (icon tiles + radio rings), intentionally not
 * mirroring the command detail dialog's look. Radio group, Agent Mode
 * default. Persists as an enum ('bot' | 'agent') per bot.
 */
import { Bot, Sparkles } from "lucide-react-native";
import { useState } from "react";
import {
  ActivityIndicator,
  Modal as ReactNativeModal,
  Pressable,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/hooks/use-theme";

export function BotModeModal({
  visible,
  initial,
  saving,
  onClose,
  onSave,
}: {
  visible: boolean;
  initial: "bot" | "agent";
  saving: boolean;
  onClose: () => void;
  onSave: (mode: "bot" | "agent") => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState<"bot" | "agent">(initial);

  return (
    <ReactNativeModal
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
      transparent
      visible={visible}
    >
      <Pressable className="flex-1 justify-end bg-black/60" onPress={onClose}>
        <Pressable
          onPress={(e) => e.stopPropagation()}
          className="rounded-t-[28px] border-t border-border bg-card px-sp-5 pt-sp-3 dark:border-border-dark dark:bg-card-dark"
          style={{ paddingBottom: insets.bottom + 20 }}
        >
          <View className="mb-sp-3 h-1 w-12 self-center rounded-full bg-border dark:bg-border-dark" />
          <Text className="font-sans text-xl font-bold text-foreground dark:text-foreground-dark">
            Bot behavior
          </Text>
          <Text className="mt-sp-1 font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
            Choose how this bot answers messages that match no command.
          </Text>

          <View className="mt-sp-4 gap-sp-3">
            <ModeTile
              active={selected === "agent"}
              icon={<Sparkles color={theme.accent} size={22} strokeWidth={2} />}
              title="Agent Mode"
              badge="Default"
              body="Unmatched messages get a conversational AI reply. You also unlock conversational command authoring for this bot."
              onPress={() => setSelected("agent")}
            />
            <ModeTile
              active={selected === "bot"}
              icon={<Bot color={theme.textSecondary} size={22} strokeWidth={2} />}
              title="Bot Mode"
              body="The bot only answers matched commands, onChat patterns, and pending replies. Anything else gets no response."
              onPress={() => setSelected("bot")}
            />
          </View>

          <View className="mt-sp-5 flex-row gap-sp-2">
            <Pressable
              accessibilityRole="button"
              onPress={onClose}
              className="h-12 flex-1 items-center justify-center rounded-full border border-border dark:border-border-dark"
            >
              <Text className="font-sans text-base font-medium text-foreground dark:text-foreground-dark">
                Cancel
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={saving}
              onPress={() => onSave(selected)}
              className="h-12 flex-1 items-center justify-center rounded-full"
              style={{ backgroundColor: theme.accent, opacity: saving ? 0.6 : 1 }}
            >
              {saving ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text className="font-sans text-base font-semibold text-white">
                  Save mode
                </Text>
              )}
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </ReactNativeModal>
  );
}

function ModeTile({
  active,
  body,
  icon,
  onPress,
  title,
  badge,
}: {
  active: boolean;
  body: string;
  icon: React.ReactNode;
  onPress: () => void;
  title: string;
  badge?: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      className="flex-row items-start gap-sp-3 rounded-3xl border-2 p-sp-4"
      style={{
        borderColor: active ? theme.accent : theme.border,
        backgroundColor: active ? `${theme.accent}14` : "transparent",
      }}
    >
      <View
        className="h-11 w-11 items-center justify-center rounded-2xl"
        style={{ backgroundColor: `${theme.accent}1F` }}
      >
        {icon}
      </View>
      <View className="min-w-0 flex-1 gap-sp-1">
        <View className="flex-row items-center gap-sp-2">
          <Text className="font-sans text-base font-semibold text-foreground dark:text-foreground-dark">
            {title}
          </Text>
          {badge ? (
            <View
              className="rounded-full px-sp-2 py-0.5"
              style={{ backgroundColor: `${theme.accent}26` }}
            >
              <Text className="font-sans text-xs font-medium" style={{ color: theme.accent }}>
                {badge}
              </Text>
            </View>
          ) : null}
        </View>
        <Text className="font-sans text-sm leading-5 text-muted-foreground dark:text-muted-foreground-dark">
          {body}
        </Text>
      </View>
      <View
        className="mt-1 h-6 w-6 items-center justify-center rounded-full border-2"
        style={{ borderColor: active ? theme.accent : theme.border }}
      >
        {active ? (
          <View className="h-3 w-3 rounded-full" style={{ backgroundColor: theme.accent }} />
        ) : null}
      </View>
    </Pressable>
  );
}
