import { useRouter } from "expo-router";
import { ChevronLeft, ChevronRight, HardDrive } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

import { Container } from "@/components/shared/container";
import { AppHeader, CircleIconButton } from "@/components/ui/chrome";
import { Card } from "@/components/ui/card";
import { useConfig } from "@/hooks/use-config";
import { useTheme } from "@/hooks/use-theme";

export default function SettingsMemoryScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { memoryEnabled } = useConfig();

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
        <Pressable
          accessibilityRole="button"
          className="min-h-16 flex-row items-center gap-sp-3 px-sp-4 py-sp-3"
          onPress={() => router.push("/settings/memory/local")}
          style={({ pressed }) => (pressed ? { opacity: 0.84 } : null)}
        >
          <View className="size-10 items-center justify-center rounded-xl bg-muted dark:bg-muted-dark">
            <HardDrive color={theme.text} size={19} />
          </View>
          <View className="min-w-0 flex-1">
            <Text className="font-sans text-base font-medium text-foreground dark:text-foreground-dark">
              Local
            </Text>
            <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
              {memoryEnabled ? "Selected" : "Disabled"}
            </Text>
          </View>
          <ChevronRight color={theme.textSecondary} size={18} />
        </Pressable>
      </Card>
    </Container>
  );
}
