/**
 * More About You: freeform personalization (1500 chars) with a live
 * counter. Saved through updateUserProfile and injected into every turn
 * via buildMemorySystemPrompt while memory is enabled.
 */
import { useFocusEffect, useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { useCallback, useState } from "react";
import { Text, View } from "react-native";

import { Container } from "@/components/shared/container";
import { Button } from "@/components/ui/button";
import { AppHeader, CircleIconButton } from "@/components/ui/chrome";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useConfig } from "@/hooks/use-config";
import { useTheme } from "@/hooks/use-theme";

const ABOUT_ME_MAX_LENGTH = 1500;

export default function MemoryAboutScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { getUserProfile, updateUserProfile } = useConfig();
  const [about, setAbout] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      const profile = await getUserProfile();
      setAbout(profile.aboutMe ?? "");
    } catch {
      // Blank editor on failure; saving surfaces the error.
    }
  }, [getUserProfile]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await updateUserProfile({ aboutMe: about.trim() || null });
      setSaved(true);
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Could not save.",
      );
    } finally {
      setBusy(false);
    }
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
        title="More About You"
      />

      <Card className="gap-sp-2 px-sp-4 py-sp-4">
        <Textarea
          accessibilityLabel="About you"
          maxLength={ABOUT_ME_MAX_LENGTH}
          numberOfLines={8}
          onChangeText={(next) => {
            setAbout(next);
            setSaved(false);
          }}
          placeholder="Interests, values, or preferences to keep in mind."
          value={about}
        />
        <View className="flex-row items-center justify-between">
          <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
            {about.length} / {ABOUT_ME_MAX_LENGTH}
          </Text>
          {saved ? (
            <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
              Saved
            </Text>
          ) : null}
        </View>
        <Button disabled={busy} loading={busy} onPress={() => void save()}>
          Save
        </Button>
        {error ? (
          <Text className="font-sans text-sm text-destructive dark:text-destructive-dark">
            {error}
          </Text>
        ) : null}
      </Card>
    </Container>
  );
}
