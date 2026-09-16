/**
 * Collapsible code accordion: a labeled code container whose body expands
 * and collapses immediately on header press.
 *
 * - Collapsed → `chevron-right`; expanded → `chevron-down` (lucide icons,
 *   swapped synchronously with the body — no animation delay).
 * - The optional `trailing` slot (e.g. a copy button) sits outside the
 *   toggle pressable so its taps never collapse the body.
 */
import { useState, type ReactNode } from "react";
import { Pressable, View, Text } from "react-native";
import { ChevronDown, ChevronRight } from "lucide-react-native";

import { useTheme } from "@/hooks/use-theme";

export function CodeAccordion({
  label,
  trailing,
  defaultExpanded = true,
  children,
}: {
  label: string;
  trailing?: ReactNode;
  defaultExpanded?: boolean;
  children: ReactNode;
}): React.JSX.Element {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <View className="my-1.5 max-w-full overflow-hidden rounded-2xl border border-border bg-secondary dark:border-border-dark dark:bg-secondary-dark">
      <View className="h-10 flex-row items-center border-b border-border pl-sp-1 pr-sp-3 dark:border-border-dark">
        <Pressable
          accessibilityLabel={expanded ? `Collapse ${label}` : `Expand ${label}`}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          onPress={() => {
            setExpanded((value) => !value);
          }}
          className="min-w-0 flex-1 flex-row items-center gap-sp-1 self-stretch"
          style={({ pressed }) => (pressed ? { opacity: 0.65 } : null)}
        >
          {expanded ? (
            <ChevronDown color={theme.textSecondary} size={17} strokeWidth={2} />
          ) : (
            <ChevronRight color={theme.textSecondary} size={17} strokeWidth={2} />
          )}
          <Text
            numberOfLines={1}
            className="font-mono text-xs text-muted-foreground dark:text-muted-foreground-dark"
          >
            {label}
          </Text>
        </Pressable>
        {trailing}
      </View>
      {expanded ? children : null}
    </View>
  );
}
