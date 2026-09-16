/**
 * Editor status footer — the single-row footer pinned to the bottom of the
 * editor. Icon set, left to right, exactly per spec:
 *
 * 1. AI Autocomplete toggle (gates the real completion provider).
 * 2. Format/validity indicator (real parser result; tap formats JSON).
 * 3. Error count (live, from the real buffer diagnostics).
 * 4. Warning count (live, same source).
 * 5. Problems/details toggle (lists every diagnostic, jumps the cursor).
 *
 * Right-aligned: live `Ln {line}, Col {col}`, a dirty-state dot wired to
 * real save state, and the Edit History clock icon.
 *
 * Every color resolves through the app theme — no hardcoded hex — so the
 * footer inverts correctly in light themes.
 */
import { Pressable, Text, View } from "react-native";
import {
  Braces,
  CircleX,
  Clock,
  FileWarning,
  Sparkles,
  TriangleAlert,
} from "lucide-react-native";

import type { FormatCheck } from "@/editor/editorDiagnostics";
import { useTheme } from "@/hooks/use-theme";

export type EditorFooterProblem = {
  severity: "error" | "warning";
  message: string;
  line: number;
  column: number;
};

export type EditorStatusFooterProps = {
  autocompleteEnabled: boolean;
  onToggleAutocomplete: () => void;
  format: FormatCheck;
  onFormatPress: () => void;
  errors: number;
  warnings: number;
  problemsOpen: boolean;
  onToggleProblems: () => void;
  line: number;
  column: number;
  dirty: boolean;
  onOpenHistory: () => void;
};

function FooterButton({
  label,
  onPress,
  active,
  children,
}: {
  label: string;
  onPress: () => void;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ selected: active ?? false }}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
    >
      {children}
    </Pressable>
  );
}

export function EditorStatusFooter({
  autocompleteEnabled,
  onToggleAutocomplete,
  format,
  onFormatPress,
  errors,
  warnings,
  problemsOpen,
  onToggleProblems,
  line,
  column,
  dirty,
  onOpenHistory,
}: EditorStatusFooterProps): React.JSX.Element {
  const theme = useTheme();
  const icon = theme.textSecondary;
  const accent = theme.accent;
  const glyph = 18;
  return (
    <View
      accessibilityRole="toolbar"
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 12,
        height: 36,
        gap: 14,
        backgroundColor: theme.background,
        borderTopWidth: 1,
        borderTopColor: theme.border,
      }}
    >
      <FooterButton
        label={autocompleteEnabled ? "Disable AI autocomplete" : "Enable AI autocomplete"}
        onPress={onToggleAutocomplete}
        active={autocompleteEnabled}
      >
        <Sparkles
          size={glyph}
          color={autocompleteEnabled ? accent : icon}
          strokeWidth={2}
        />
      </FooterButton>
      <FooterButton
        label={format.valid ? "Buffer parses cleanly" : "Format document"}
        onPress={onFormatPress}
      >
        <Braces
          size={glyph}
          color={format.valid && !format.unsupported ? accent : icon}
          strokeWidth={2}
        />
      </FooterButton>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        <CircleX size={glyph} color={theme.destructive} strokeWidth={2} />
        <Text style={{ color: icon, fontSize: 12, fontVariant: ["tabular-nums"] }}>
          {errors}
        </Text>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        <TriangleAlert size={glyph} color={theme.warning} strokeWidth={2} />
        <Text style={{ color: icon, fontSize: 12, fontVariant: ["tabular-nums"] }}>
          {warnings}
        </Text>
      </View>
      <FooterButton
        label={problemsOpen ? "Hide problems" : "Show problems"}
        onPress={onToggleProblems}
        active={problemsOpen}
      >
        <FileWarning
          size={glyph}
          color={problemsOpen ? accent : icon}
          strokeWidth={2}
        />
      </FooterButton>
      <View style={{ flex: 1 }} />
      <Text style={{ color: icon, fontSize: 12, fontVariant: ["tabular-nums"] }}>
        {`Ln ${line}, Col ${column}`}
      </Text>
      <View
        accessibilityLabel={dirty ? "Unsaved changes" : "Saved"}
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: dirty ? accent : "transparent",
          borderWidth: dirty ? 0 : 1,
          borderColor: dirty ? "transparent" : icon,
        }}
      />
      <FooterButton label="Open edit history" onPress={onOpenHistory}>
        <Clock size={glyph} color={icon} strokeWidth={2} />
      </FooterButton>
    </View>
  );
}
