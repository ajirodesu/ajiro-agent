/**
 * Inline tool-call trace: renders each tool execution as a compact card with
 * an icon, human-readable summary, and a state indicator (pending â†’ spinner â†’
 * check / cross). Cards stack in execution order; the detail body is
 * collapsible once the step is finished. Failed transient errors surface a
 * Retry action when a handler is provided.
 *
 * Author: AjiroDesu
 */
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

import {
  BookOpen,
  Check,
  ChevronDown,
  FileText,
  Loader,
  Pencil,
  Search,
  Terminal,
  Upload,
  X,
} from "lucide-react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import type { ToolExecutionRecord } from "@/core/types/app-state";
import { cn } from "@/core/utils";
import { useTheme } from "@/hooks/use-theme";

function describeToolCall(toolName: string, inputSummary: string): string {
  const detail = inputSummary.replace(/\s+/g, " ").trim();

  switch (toolName) {
    case "read":
    case "folderRead":
      return `Reading ${firstPath(detail)}`;
    case "write":
    case "folderWrite":
      return `Writing ${firstPath(detail)}`;
    case "edit":
    case "folderEdit":
      return `Editing ${firstPath(detail)}`;
    case "createFile":
    case "folderCreateFile":
      return `Creating ${firstPath(detail)}`;
    case "createDirectory":
      return `Creating folder ${firstPath(detail)}`;
    case "grep":
    case "folderGrep":
      return `Searching for ${firstQuoted(detail)}`;
    case "glob":
    case "folderGlob":
      return `Finding files ${firstQuoted(detail)}`;
    case "exec":
    case "run-command":
      return `Running ${firstQuoted(detail) ?? "command"}`;
    case "downloadFile":
      return "Downloading file";
    case "git-status":
      return "Checking git status";
    case "git-diff":
      return "Showing local diff";
    case "git-add":
      return "Staging changes";
    case "git-commit":
      return "Committing changes";
    case "git-branch":
      return "Working with branches";
    case "git-log":
      return "Showing commit history";
    case "deleteEntry":
    case "folderDeleteEntry":
      return "Deleting entry";
    case "renameEntry":
      return "Renaming entry";
    case "moveEntry":
      return "Moving entry";
    case "skill":
      return `Using skill ${firstQuoted(detail) ?? "skill"}`;
    case "skillReadFile":
      return `Reading skill file ${firstQuoted(detail) ?? "file"}`;
    case "skillRunScript":
      return `Running skill script ${firstQuoted(detail) ?? "script"}`;
    case "manageSkill":
      return "Managing skills";
    case "importSkillFromUrl":
      return "Importing skill";
    case "shell":
      return `Running ${firstQuoted(detail) ?? "command"}`;
    default:
      return toolName
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/[-_]+/g, " ")
        .replace(/\b\w/g, (match) => match.toUpperCase());
  }
}

function firstPath(summary: string) {
  const match = /"((?:[^"\\]|\\.))"/.exec(summary);

  return match?.[1] ?? firstQuoted(summary) ?? "file";
}

function firstQuoted(summary: string) {
  const match = /["'`]([^"'`]+)["'`]/.exec(summary);

  return match?.[1] ?? null;
}

function ToolGlyph({ toolName }: { toolName: string }) {
  const theme = useTheme();
  const color = theme.textSecondary;
  const size = 14;

  if (toolName === "read" || toolName === "folderRead") {
    return <FileText color={color} size={size} />;
  }

  if (
    toolName === "write" ||
    toolName === "edit" ||
    toolName === "folderEdit" ||
    toolName === "folderWrite" ||
    toolName === "createFile" ||
    toolName === "folderCreateFile" ||
    toolName === "createDirectory"
  ) {
    return <Pencil color={color} size={size} />;
  }

  if (
    toolName === "grep" ||
    toolName === "folderGrep" ||
    toolName === "glob" ||
    toolName === "folderGlob"
  ) {
    return <Search color={color} size={size} />;
  }

  if (toolName === "exec" || toolName === "run-command") {
    return <Terminal color={color} size={size} />;
  }

  if (
    toolName === "skill" ||
    toolName === "skillReadFile" ||
    toolName === "skillRunScript" ||
    toolName === "manageSkill" ||
    toolName === "importSkillFromUrl"
  ) {
    return <BookOpen color={color} size={size} />;
  }

  if (toolName === "shell") {
    return <Terminal color={color} size={size} />;
  }

  if (toolName === "downloadFile" || toolName === "upload") {
    return <Upload color={color} size={size} />;
  }

  return <FileText color={color} size={size} />;
}

function SpinningLoaderIcon({ color, size }: { color: string; size: number }) {
  const reduceMotion = useReducedMotion();
  const rotation = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) {
      return;
    }

    rotation.value = withRepeat(
      withTiming(360, { duration: 1000, easing: Easing.linear }),
      -1,
      false,
    );

    return () => {
      cancelAnimation(rotation);
    };
  }, [rotation, reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  return (
    <Animated.View style={animatedStyle}>
      <Loader color={color} size={size} />
    </Animated.View>
  );
}

export function ToolTrace({
  onRetry,
  records,
}: {
  onRetry?: () => void;
  records: ToolExecutionRecord[];
}) {
  if (records.length === 0) {
    return null;
  }

  return (
    <View className="gap-sp-1.5">
      {records.map((record, index) => (
        <ToolTraceRow
          isLast={index === records.length - 1}
          key={`${record.toolName}-${record.createdAt}-${index}`}
          onRetry={onRetry}
          record={record}
        />
      ))}
    </View>
  );
}

function ToolTraceRow({
  isLast,
  onRetry,
  record,
}: {
  isLast: boolean;
  onRetry?: () => void;
  record: ToolExecutionRecord;
}) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const isPending = record.status === "pending";
  const isFailed = record.status === "failed";
  const detail =
    record.error ?? record.outputSummary ?? record.inputSummary ?? null;

  return (
    <View
      className={cn(
        "rounded-ui border px-sp-3 py-sp-2",
        isFailed
          ? "border-destructive/60 dark:border-destructive/60"
          : "border-border dark:border-border-dark",
      )}
    >
      <View className="flex-row items-center gap-sp-2">
        <View className="w-5 items-center">
          {isPending ? (
            <SpinningLoaderIcon color={theme.textSecondary} size={14} />
          ) : isFailed ? (
            <X color={theme.destructive} size={14} />
          ) : (
            <Check color={theme.textSecondary} size={14} />
          )}
        </View>
        <ToolGlyph toolName={record.toolName} />
        <Text
          className="min-w-0 flex-1 font-sans text-sm text-foreground dark:text-foreground-dark"
          numberOfLines={1}
        >
          {describeToolCall(record.toolName, record.inputSummary)}
        </Text>
        {detail && !isPending ? (
          <Pressable
            accessibilityLabel={expanded ? "Hide details" : "Show details"}
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => {
              setExpanded((current) => !current);
            }}
          >
            <ChevronDown
              color={theme.textSecondary}
              size={14}
              style={{
                transform: [{ rotate: expanded ? "180deg" : "0deg" }],
              }}
            />
          </Pressable>
        ) : null}
      </View>
      {expanded && detail ? (
        <View className="mt-sp-2 gap-1 border-t border-border pt-sp-2 dark:border-border-dark">
          <Text
            className="font-mono text-xs text-muted-foreground dark:text-muted-foreground-dark"
            selectable
          >
            {detail}
          </Text>
          {isFailed && onRetry && isLast ? (
            <Pressable
              accessibilityRole="button"
              className="mt-1 self-start rounded-pill border border-border px-sp-3 py-1 dark:border-border-dark"
              onPress={onRetry}
              style={({ pressed }) => (pressed ? { opacity: 0.7 } : null)}
            >
              <Text className="font-sans text-xs font-medium text-foreground dark:text-foreground-dark">
                Retry
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {isFailed && !expanded && onRetry && isLast ? (
        <Pressable
          accessibilityRole="button"
          className="mt-sp-2 self-start"
          onPress={onRetry}
          style={({ pressed }) => (pressed ? { opacity: 0.7 } : null)}
        >
          <Text
            className="font-sans text-xs font-semibold"
            style={{ color: theme.text }}
          >
            Retry
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export { describeToolCall };
