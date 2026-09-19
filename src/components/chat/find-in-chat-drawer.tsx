/**
 * Find-in-chat drawer for the Main/Chat ellipsis menu.
 */
import { Pressable, Text, TextInput, View } from "react-native";
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react-native";
import type { FindMatch } from "@/components/chat/chat-header-menu";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { useTheme } from "@/hooks/use-theme";

export function FindInChatDrawer({
  activeIndex,
  chatTitle,
  matches,
  onClear,
  onJump,
  onNext,
  onOpenChange,
  onPrev,
  onQueryChange,
  onSubmit,
  open,
  query,
  searched,
}: {
  activeIndex: number;
  chatTitle: string;
  matches: FindMatch[];
  onClear: () => void;
  onJump: (index: number) => void;
  onNext: () => void;
  onOpenChange: (open: boolean) => void;
  onPrev: () => void;
  onQueryChange: (query: string) => void;
  onSubmit: () => void;
  open: boolean;
  query: string;
  searched: boolean;
}) {
  const theme = useTheme();
  return (
    <Drawer onOpenChange={onOpenChange} open={open}>
      <DrawerContent showCloseButton showHandle size={520}>
        <DrawerHeader>
          <DrawerTitle>Find in chat</DrawerTitle>
          <DrawerDescription>{`Search messages in "${chatTitle}".`}</DrawerDescription>
        </DrawerHeader>
        <DrawerBody contentContainerClassName="gap-sp-3 pb-sp-4">
          <View className="flex-row items-center gap-sp-2 rounded-ui border border-border bg-card px-sp-3 py-sp-2 dark:border-border-dark dark:bg-card-dark">
            <Search color={theme.textSecondary} size={18} strokeWidth={2} />
            <TextInput
              accessibilityLabel="Search messages"
              autoCapitalize="none"
              autoCorrect={false}
              className="min-w-0 flex-1 font-sans text-base text-foreground dark:text-foreground-dark"
              onChangeText={onQueryChange}
              onSubmitEditing={onSubmit}
              placeholder="Search messages…"
              placeholderTextColor={theme.textSecondary}
              returnKeyType="search"
              value={query}
            />
            {query.length > 0 ? (
              <Pressable
                accessibilityLabel="Clear search"
                accessibilityRole="button"
                onPress={onClear}
                className="items-center justify-center rounded-full p-1"
              >
                <X color={theme.textSecondary} size={16} strokeWidth={2} />
              </Pressable>
            ) : null}
          </View>
          {!searched ? (
            <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
              Type to search across every message in this conversation.
            </Text>
          ) : matches.length === 0 ? (
            <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
              {`No matches for "${query}".`}
            </Text>
          ) : (
            <FindResults
              activeIndex={activeIndex}
              matches={matches}
              onJump={onJump}
              onNext={onNext}
              onPrev={onPrev}
            />
          )}
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}

function FindResults({
  activeIndex,
  matches,
  onJump,
  onNext,
  onPrev,
}: {
  activeIndex: number;
  matches: FindMatch[];
  onJump: (index: number) => void;
  onNext: () => void;
  onPrev: () => void;
}) {
  const theme = useTheme();
  return (
    <>
      <View className="flex-row items-center justify-between gap-sp-2">
        <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
          {`${matches.length} ${matches.length === 1 ? "match" : "matches"} · ${activeIndex + 1} of ${matches.length}`}
        </Text>
        <View className="flex-row gap-sp-2">
          <Pressable
            accessibilityLabel="Previous match"
            accessibilityRole="button"
            onPress={onPrev}
            className="items-center justify-center rounded-full border border-border px-sp-3 py-sp-1 dark:border-border-dark"
          >
            <ChevronLeft color={theme.text} size={16} strokeWidth={2} />
          </Pressable>
          <Pressable
            accessibilityLabel="Next match"
            accessibilityRole="button"
            onPress={onNext}
            className="items-center justify-center rounded-full border border-border px-sp-3 py-sp-1 dark:border-border-dark"
          >
            <ChevronRight color={theme.text} size={16} strokeWidth={2} />
          </Pressable>
        </View>
      </View>
      {matches.map((match, index) => (
        <Pressable
          key={`${match.messageId}-${index}`}
          accessibilityLabel={`Jump to match ${index + 1}`}
          accessibilityRole="button"
          onPress={() => onJump(index)}
          className="gap-1 rounded-ui border border-border bg-card px-sp-3 py-sp-2 dark:border-border-dark dark:bg-card-dark"
          style={
            index === activeIndex
              ? { borderColor: theme.accent, borderWidth: 1 }
              : undefined
          }
        >
          <Text
            numberOfLines={3}
            className="font-sans text-sm text-foreground dark:text-foreground-dark"
          >
            {match.excerpt}
          </Text>
          <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
            {index === activeIndex ? "Current match — tap to jump" : "Tap to jump"}
          </Text>
        </Pressable>
      ))}
    </>
  );
}
