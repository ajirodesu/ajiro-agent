/**
 * Shared screen chrome — the SOLE header/icon-container/tab system.
 *
 * Every page header uses `AppHeader` (64pt, settings placement pattern:
 * leading action pinned left, title centered, trailing actions right) with
 * `HeaderShadow` (the settings scroll-fade, theme-aware) instead of
 * hand-rolled Pressables and hardcoded hex.
 *
 * Icon containers come in two sizes only: `CircleIconButton` (48pt) and
 * `CapsuleContainer` (96x48, exactly double width for two merged icons).
 * All containers share one fill, one border color, and one border width;
 * all glyphs are icon-only (20pt, stroke 2). Footer icon buttons use
 * `FOOTER_ICON_SIZE`, matching the main page composer controls.
 */
import type { ReactNode } from "react";
import { Pressable, Text, View, ScrollView } from "react-native";

import {
  CAPSULE_HEIGHT,
  CAPSULE_WIDTH,
  CONTAINER_BORDER,
  HEADER_HEIGHT,
  ICON_CONTAINER,
  withAlpha,
} from "@/components/ui/chrome-spec";
import { useTheme } from "@/hooks/use-theme";

export {
  CAPSULE_HEIGHT,
  CAPSULE_WIDTH,
  CONTAINER_BORDER,
  FOOTER_ICON_SIZE,
  HEADER_HEIGHT,
  ICON_CONTAINER,
  ICON_GLYPH,
  ICON_INNER,
  ICON_STROKE,
  withAlpha,
} from "@/components/ui/chrome-spec";

/**
 * Settings-style header shadow: three-stop fade shown once the page
 * scrolls. Colors derive from the theme background so the shadow looks
 * identical on every theme.
 */
export function HeaderShadow({ visible }: { visible: boolean }) {
  const theme = useTheme();
  if (!visible) return null;
  return (
    <View
      pointerEvents="none"
      className="absolute inset-x-0 top-0"
      style={{ height: 96 }}
    >
      <View
        style={{ flex: 26, backgroundColor: withAlpha(theme.background, 0.55) }}
      />
      <View
        style={{ flex: 35, backgroundColor: withAlpha(theme.background, 0.25) }}
      />
      <View
        style={{ flex: 35, backgroundColor: withAlpha(theme.background, 0) }}
      />
    </View>
  );
}

export function CircleIconButton({
  accessibilityLabel,
  children,
  onPress,
  size = ICON_CONTAINER,
}: {
  accessibilityLabel: string;
  children: ReactNode;
  onPress: () => void;
  size?: number;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      className="items-center justify-center rounded-full"
      style={({ pressed }) => ({
        width: size,
        height: size,
        backgroundColor: theme.backgroundElement,
        borderWidth: CONTAINER_BORDER,
        borderColor: theme.border,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      {children}
    </Pressable>
  );
}

export function CapsuleContainer({
  accessibilityLabel,
  children,
}: {
  accessibilityLabel: string;
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View
      accessibilityLabel={accessibilityLabel}
      className="flex-row items-center overflow-hidden rounded-full"
      style={{
        width: CAPSULE_WIDTH,
        height: CAPSULE_HEIGHT,
        backgroundColor: theme.backgroundElement,
        borderWidth: CONTAINER_BORDER,
        borderColor: theme.border,
        paddingHorizontal: 4,
        gap: 8,
      }}
    >
      {children}
    </View>
  );
}

export type AppHeaderProps = {
  left?: ReactNode;
  title?: string;
  subtitle?: string;
  right?: ReactNode;
};

export function AppHeader({ left, title, subtitle, right }: AppHeaderProps) {
  return (
    <View
      className="relative flex-row items-center px-sp-4"
      style={{ height: HEADER_HEIGHT, gap: 12 }}
    >
      {left}
      {title ? (
        <View
          pointerEvents="box-none"
          className="absolute inset-x-0 items-center justify-center"
          style={{ height: HEADER_HEIGHT }}
        >
          <Text className="font-sans text-lg font-semibold text-foreground dark:text-foreground-dark">
            {title}
          </Text>
          {subtitle ? (
            <Text
              numberOfLines={1}
              className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark"
            >
              {subtitle}
            </Text>
          ) : null}
        </View>
      ) : null}
      <View className="flex-1" />
      {right}
    </View>
  );
}

export type AppTab = {
  key: string;
  label: string;
};

export function AppTabs({
  tabs,
  activeKey,
  onChange,
}: {
  tabs: AppTab[];
  activeKey: string;
  onChange: (key: string) => void;
}) {
  const theme = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      className="flex-none"
      contentContainerClassName="items-center gap-sp-2 pr-sp-1"
    >
      {tabs.map((tab) => {
        const active = tab.key === activeKey;
        return (
          <Pressable
            key={tab.key}
            accessibilityLabel={tab.label}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => {
              onChange(tab.key);
            }}
            className="rounded-full px-sp-3 py-sp-2"
            style={({ pressed }) => ({
              borderWidth: active ? CONTAINER_BORDER : 0,
              borderColor: active ? theme.accent : "transparent",
              backgroundColor: active
                ? withAlpha(theme.accent, 0.18)
                : "transparent",
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text
              className={
                active
                  ? "font-sans text-sm font-medium text-foreground dark:text-foreground-dark"
                  : "font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark"
              }
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
