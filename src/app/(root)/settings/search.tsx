/**
 * Search Settings: one flattened, live-filtered list of every settings
 * destination (no categories). Page entries push real routes; drawer
 * entries deep-link into /settings with a drawer param the Settings screen
 * opens directly.
 */
import { useRouter } from "expo-router";
import {
  Bell,
  Bot,
  Brain,
  Briefcase,
  ChevronLeft,
  ChevronRight,
  Clock,
  Code,
  Contrast,
  Cpu,
  Database,
  FileText,
  Info,
  KeyRound,
  Palette,
  Play,
  Plus,
  RefreshCw,
  Search,
  Server,
  Share2,
  Sparkles,
  Upload,
} from "lucide-react-native";
import { useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  AppHeader,
  CircleIconButton,
  HeaderShadow,
} from "@/components/ui/chrome";
import { useTheme } from "@/hooks/use-theme";
import {
  searchSettingsEntries,
  type SettingsSearchEntry,
} from "@/modules/settings/search-index";

const ICONS: Record<string, typeof Info> = {
  bell: Bell,
  bot: Bot,
  brain: Brain,
  briefcase: Briefcase,
  clock: Clock,
  code: Code,
  contrast: Contrast,
  cpu: Cpu,
  database: Database,
  file: FileText,
  info: Info,
  key: KeyRound,
  palette: Palette,
  play: Play,
  plus: Plus,
  refresh: RefreshCw,
  server: Server,
  share: Share2,
  sparkles: Sparkles,
  upload: Upload,
};

function SearchResultRow({
  entry,
  onPress,
}: {
  entry: SettingsSearchEntry;
  onPress: () => void;
}) {
  const theme = useTheme();
  const Icon = ICONS[entry.icon] ?? Info;
  return (
    <Pressable
      accessibilityLabel={entry.label}
      accessibilityRole="button"
      className="min-h-[52px] flex-row items-center"
      onPress={onPress}
      style={({ pressed }) => ({
        gap: 12,
        padding: 16,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <Icon color={theme.text} size={22} strokeWidth={2} />
      <View className="min-w-0 flex-1">
        <Text
          numberOfLines={1}
          className="font-sans text-foreground dark:text-foreground-dark"
          style={{ fontSize: 16, fontWeight: "500" }}
        >
          {entry.label}
        </Text>
        {entry.description ? (
          <Text
            numberOfLines={1}
            className="font-sans text-muted-foreground dark:text-muted-foreground-dark"
            style={{ fontSize: 13 }}
          >
            {entry.description}
          </Text>
        ) : null}
      </View>
      <ChevronRight color={theme.textSecondary} size={18} style={{ opacity: 0.5 }} />
    </Pressable>
  );
}

export default function SearchSettingsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const [query, setQuery] = useState("");
  const [scrolled, setScrolled] = useState(false);

  // Live filtering on every keystroke; clearing restores the full list.
  const results = useMemo(() => searchSettingsEntries(query), [query]);

  const openEntry = (entry: SettingsSearchEntry) => {
    if (entry.target.kind === "route") {
      router.push(entry.target.route as never);
    } else {
      router.push(`/settings?drawer=${entry.target.drawer}` as never);
    }
  };

  return (
    <SafeAreaView
      className="flex-1 bg-background dark:bg-background-dark"
      edges={["top", "left", "right"]}
    >
      <View className="relative flex-1">
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
          title="Search Settings"
        />
        <ScrollView
          className="flex-1"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingTop: 12, paddingBottom: 24 }}
          scrollEventThrottle={32}
          keyboardShouldPersistTaps="handled"
          onScroll={(event) => {
            setScrolled(event.nativeEvent.contentOffset.y > 4);
          }}
        >
          <View style={{ marginHorizontal: 16, marginBottom: 12 }}>
            <View className="flex-row items-center gap-sp-2 rounded-ui border border-border bg-card px-sp-3 dark:border-border-dark dark:bg-card-dark">
              <Search color={theme.textSecondary} size={18} strokeWidth={2} />
              <TextInput
                accessibilityLabel="Search settings"
                autoCapitalize="none"
                autoCorrect={false}
                className="min-w-0 flex-1 font-sans text-foreground dark:text-foreground-dark"
                clearButtonMode="while-editing"
                onChangeText={setQuery}
                placeholder="Search settings…"
                placeholderTextColor={theme.textSecondary}
                returnKeyType="search"
                style={{ fontSize: 16, height: 48 }}
                value={query}
              />
            </View>
          </View>

          {results.length === 0 ? (
            <View style={{ marginHorizontal: 16 }}>
              <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                {query ? "No settings match your search." : "No settings found."}
              </Text>
            </View>
          ) : (
            <View
              className="bg-card dark:bg-card-dark"
              style={{ gap: 2, marginHorizontal: 16, marginBottom: 28 }}
            >
              {results.map((entry, index) => (
                <View
                  key={entry.id}
                  className="overflow-hidden"
                  style={{
                    borderTopLeftRadius: index === 0 ? 24 : 4,
                    borderTopRightRadius: index === 0 ? 24 : 4,
                    borderBottomLeftRadius:
                      index === results.length - 1 ? 24 : 4,
                    borderBottomRightRadius:
                      index === results.length - 1 ? 24 : 4,
                  }}
                >
                  <SearchResultRow
                    entry={entry}
                    onPress={() => openEntry(entry)}
                  />
                </View>
              ))}
            </View>
          )}
        </ScrollView>

        <HeaderShadow visible={scrolled} />
      </View>
    </SafeAreaView>
  );
}
