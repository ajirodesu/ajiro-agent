/**
 * Editor problems panel — the real diagnostics list behind the footer's
 * document icon. Every row is a live diagnostic; tapping one jumps the
 * cursor to its line. Theme-aware, no hardcoded colors.
 */
import { Pressable, ScrollView, Text, View } from "react-native";

import type { EditorDiagnostic } from "@/editor/editorDiagnostics";
import { useTheme } from "@/hooks/use-theme";

export function EditorProblemsPanel({
  diagnostics,
  onJump,
}: {
  diagnostics: EditorDiagnostic[];
  onJump: (line: number, column: number) => void;
}): React.JSX.Element | null {
  const theme = useTheme();
  if (diagnostics.length === 0) return null;
  return (
    <View
      style={{
        maxHeight: 160,
        borderTopWidth: 1,
        borderTopColor: theme.border,
        backgroundColor: theme.background,
      }}
    >
      <ScrollView keyboardShouldPersistTaps="handled">
        {diagnostics.map((diagnostic, index) => (
          <Pressable
            key={`${diagnostic.line}:${diagnostic.column}:${index}`}
            accessibilityRole="button"
            accessibilityLabel={`Go to ${diagnostic.severity} at line ${diagnostic.line}`}
            onPress={() => onJump(diagnostic.line, diagnostic.column)}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              paddingHorizontal: 12,
              paddingVertical: 8,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor:
                  diagnostic.severity === "error"
                    ? theme.destructive
                    : theme.success,
              }}
            />
            <Text
              style={{
                color: theme.textSecondary,
                fontSize: 12,
                fontVariant: ["tabular-nums"],
              }}
            >
              {`${diagnostic.line}:${diagnostic.column}`}
            </Text>
            <Text
              numberOfLines={1}
              style={{ flex: 1, color: theme.text, fontSize: 12 }}
            >
              {diagnostic.message}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
