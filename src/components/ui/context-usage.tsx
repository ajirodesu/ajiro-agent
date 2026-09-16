/**
 * OpenCode-style context usage indicator: a circular progress ring in the
 * main header plus a detail panel with token breakdown and a Compact action.
 *
 * The percentage is always computed against the real active model's context
 * window (never a hardcoded denominator); breakdowns come from the latest
 * completed turn plus a live estimate while streaming.
 *
 * Author: AjiroDesu
 */
import { useEffect, useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { Circle, Svg } from "react-native-svg";
import { SquarePen } from "lucide-react-native";

import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { useChat } from "@/hooks/use-chat";
import { useChatInfo } from "@/hooks/use-chat-info";
import { useTheme } from "@/hooks/use-theme";
import {
  cacheHitRatio,
  computeContextLoad,
  contextRingTone,
  estimateStreamingTokens,
  formatTokenNumber,
  RING_TONE_COLORS,
  sumNullable,
  type RingTone,
} from "@/modules/context/usage";
import type { CompactConversationResult } from "@/providers/app-state";

export function contextRingColorForTone(
  tone: RingTone,
  destructive: string,
): string | null {
  if (tone === "unknown") {
    return null;
  }

  if (tone === "critical") {
    return destructive;
  }

  return RING_TONE_COLORS[tone];
}

export function ContextRing({
  percent,
  size = 20,
  strokeWidth = 2.5,
}: {
  percent: number | null;
  size?: number;
  strokeWidth?: number;
}) {
  const theme = useTheme();
  const tone = contextRingTone(percent);
  const color = contextRingColorForTone(tone, theme.destructive);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = percent === null ? 0 : Math.min(100, Math.max(0, percent));

  return (
    <Svg height={size} width={size}>
      <Circle
        cx={size / 2}
        cy={size / 2}
        fill="none"
        r={radius}
        stroke={theme.border}
        strokeWidth={strokeWidth}
      />
      {color !== null ? (
        <Circle
          cx={size / 2}
          cy={size / 2}
          fill="none"
          r={radius}
          rotation="-90"
          origin={`${size / 2}, ${size / 2}`}
          stroke={color}
          strokeDasharray={`${circumference}`}
          strokeDashoffset={circumference * (1 - filled / 100)}
          strokeLinecap="round"
          strokeWidth={strokeWidth}
        />
      ) : null}
    </Svg>
  );
}

export type ContextUsageSummary = {
  busy: boolean;
  cacheHitRatio: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  contextWindow: number | null;
  costTotal: number | null;
  inputTokens: number | null;
  modelLabel: string | null;
  outputTextTokens: number | null;
  outputTokens: number | null;
  percent: number | null;
  providerLabel: string | null;
  reasoningTokens: number | null;
  sessionTotalTokens: number | null;
  streamingTokens: number;
  tone: RingTone;
  usedTokens: number | null;
};

export function useContextUsage(): ContextUsageSummary {
  const chatInfo = useChatInfo();
  const { currentConversationRunStatus, messages } = useChat();

  return useMemo(() => {
    const busy = currentConversationRunStatus !== null;
    const streamingMessage = busy
      ? [...messages]
          .reverse()
          .find(
            (message) =>
              message.role === "assistant" && message.status === "streaming",
          )
      : undefined;
    const streamingTokens = estimateStreamingTokens(
      streamingMessage?.content.length ?? 0,
    );
    const latestTurn = chatInfo.latestTurn;
    const totals = chatInfo.conversationTotals;
    const contextWindow =
      chatInfo.currentModel?.contextWindow ??
      latestTurn?.contextWindow ??
      null;
    const baseUsed =
      latestTurn?.totalTokens ??
      sumNullable([latestTurn?.inputTokens ?? null, latestTurn?.outputTokens ?? null]);
    const usedTokens =
      baseUsed === null
        ? streamingTokens > 0
          ? streamingTokens
          : null
        : baseUsed + streamingTokens;
    const percent = computeContextLoad({ contextWindow, usedTokens });

    const detailSource =
      latestTurn?.inputTokenDetails &&
      (latestTurn.inputTokenDetails.noCacheTokens !== null ||
        latestTurn.inputTokenDetails.cacheReadTokens !== null ||
        latestTurn.inputTokenDetails.cacheWriteTokens !== null)
        ? latestTurn
        : totals;

    return {
      busy,
      cacheHitRatio: detailSource
        ? cacheHitRatio({
            cacheReadTokens: detailSource.inputTokenDetails?.cacheReadTokens ?? null,
            noCacheTokens: detailSource.inputTokenDetails?.noCacheTokens ?? null,
          })
        : null,
      cacheReadTokens:
        detailSource?.inputTokenDetails?.cacheReadTokens ?? null,
      cacheWriteTokens:
        detailSource?.inputTokenDetails?.cacheWriteTokens ?? null,
      contextWindow,
      costTotal: latestTurn?.costTotal ?? totals?.costTotal ?? null,
      inputTokens: latestTurn?.inputTokens ?? totals?.inputTokens ?? null,
      modelLabel:
        chatInfo.currentModel?.modelLabel ??
        latestTurn?.modelLabel ??
        null,
      outputTextTokens:
        detailSource?.outputTokenDetails?.textTokens ?? null,
      outputTokens: latestTurn?.outputTokens ?? totals?.outputTokens ?? null,
      percent,
      providerLabel:
        chatInfo.currentModel?.providerLabel ??
        latestTurn?.providerLabel ??
        null,
      reasoningTokens:
        detailSource?.outputTokenDetails?.reasoningTokens ?? null,
      sessionTotalTokens: totals?.totalTokens ?? null,
      streamingTokens,
      tone: contextRingTone(percent),
      usedTokens,
    } satisfies ContextUsageSummary;
  }, [chatInfo, currentConversationRunStatus, messages]);
}

export function ContextRingButton({
  onPress,
  percent,
}: {
  onPress: () => void;
  percent: number | null;
}) {
  const label =
    percent === null
      ? "Context usage unavailable"
      : `Context usage ${percent}%`;

  return (
    <Pressable
      accessibilityHint="Shows context usage details"
      accessibilityLabel={label}
      accessibilityRole="button"
      className="h-10 w-10 items-center justify-center rounded-full border-0 bg-transparent"
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => (pressed ? { opacity: 0.7 } : null)}
    >
      <ContextRing percent={percent} />
    </Pressable>
  );
}

/**
 * Usage capsule: the context ring's container. While no message has been
 * sent it is a single 48px circle holding the ring; once the conversation
 * has messages it smoothly expands to a capsule revealing a new-chat button
 * on the left of the ring. Width + reveal animate together so the
 * transition never snaps.
 */
const CAPSULE_COLLAPSED = 48;
const CAPSULE_EXPANDED = 96;
const CAPSULE_ICON = 40;

export function UsageCapsule({
  expanded,
  onNewChat,
  onPressRing,
  percent,
}: {
  expanded: boolean;
  onNewChat: () => void;
  onPressRing: () => void;
  percent: number | null;
}) {
  const theme = useTheme();
  const progress = useSharedValue(expanded ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(expanded ? 1 : 0, { duration: 260 });
  }, [expanded, progress]);

  const containerStyle = useAnimatedStyle(() => ({
    width: interpolate(
      progress.value,
      [0, 1],
      [CAPSULE_COLLAPSED, CAPSULE_EXPANDED],
    ),
  }));
  const newChatStyle = useAnimatedStyle(() => ({
    width: interpolate(progress.value, [0, 1], [0, CAPSULE_ICON]),
    opacity: progress.value,
  }));

  return (
    <Animated.View
      className="flex-row items-center overflow-hidden rounded-full"
      style={[
        containerStyle,
        {
          height: CAPSULE_COLLAPSED,
          backgroundColor: theme.backgroundElement,
          borderWidth: 1,
          borderColor: theme.border,
          paddingHorizontal: 4,
          gap: 8,
        },
      ]}
    >
      <Animated.View style={[{ alignItems: "center" }, newChatStyle]}>
        <Pressable
          accessibilityLabel="New chat"
          accessibilityRole="button"
          onPress={onNewChat}
          className="items-center justify-center rounded-full"
          style={({ pressed }) => ({
            width: CAPSULE_ICON,
            height: CAPSULE_ICON,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <SquarePen color={theme.text} size={20} strokeWidth={2} />
        </Pressable>
      </Animated.View>
      <Pressable
        accessibilityHint="Shows context usage details"
        accessibilityLabel={
          percent === null
            ? "Context usage unavailable"
            : `Context usage ${percent}%`
        }
        accessibilityRole="button"
        onPress={onPressRing}
        className="items-center justify-center rounded-full"
        hitSlop={8}
        style={({ pressed }) => ({
          width: CAPSULE_ICON,
          height: CAPSULE_ICON,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <ContextRing percent={percent} size={22} />
      </Pressable>
    </Animated.View>
  );
}

function UsageRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <View className="flex-row items-center justify-between gap-sp-3 py-sp-1">
      <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
        {label}
      </Text>
      <Text className="font-mono text-sm text-foreground dark:text-foreground-dark">
        {value}
      </Text>
    </View>
  );
}

export function ContextUsageDrawer({
  compactResult,
  compactState,
  onCompact,
  onOpenChange,
  open,
  usage,
}: {
  compactResult: CompactConversationResult | null;
  compactState: "idle" | "working" | "done" | "error";
  onCompact: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  usage: ContextUsageSummary;
}) {
  const headline =
    usage.usedTokens !== null && usage.contextWindow !== null
      ? `${formatTokenNumber(usage.usedTokens)} / ${formatTokenNumber(usage.contextWindow)} tokens`
      : "Usage unavailable";

  return (
    <Drawer onOpenChange={onOpenChange} open={open}>
      <DrawerContent showCloseButton showHandle>
        <DrawerHeader>
          <DrawerTitle>Context usage</DrawerTitle>
          <DrawerDescription>
            {[usage.providerLabel, usage.modelLabel]
              .filter(Boolean)
              .join(" · ") || "No model selected"}
          </DrawerDescription>
        </DrawerHeader>
        <DrawerBody contentContainerClassName="gap-sp-3 pb-sp-4">
          <View className="flex-row items-center gap-sp-4 rounded-ui border border-border px-sp-4 py-sp-3 dark:border-border-dark">
            <ContextRing
              percent={usage.percent}
              size={56}
              strokeWidth={5}
            />
            <View className="min-w-0 flex-1 gap-1">
              <Text className="font-mono text-base text-foreground dark:text-foreground-dark">
                {headline}
              </Text>
              <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                {usage.percent === null
                  ? "Send a message to measure usage."
                  : `${usage.percent}% of the context window used`}
                {usage.busy ? " · updating live" : ""}
              </Text>
            </View>
          </View>

          <View className="rounded-ui border border-border px-sp-4 py-sp-2 dark:border-border-dark">
            <UsageRow label="Input" value={formatTokenNumber(usage.inputTokens)} />
            <UsageRow
              label="Cache read"
              value={formatTokenNumber(usage.cacheReadTokens)}
            />
            <UsageRow
              label="Cache write"
              value={formatTokenNumber(usage.cacheWriteTokens)}
            />
            <UsageRow
              label="Output"
              value={formatTokenNumber(
                usage.outputTextTokens ?? usage.outputTokens,
              )}
            />
            <UsageRow
              label="Reasoning"
              value={formatTokenNumber(usage.reasoningTokens)}
            />
            <UsageRow
              label="Session total"
              value={formatTokenNumber(usage.sessionTotalTokens)}
            />
            {usage.cacheHitRatio !== null ? (
              <UsageRow
                label="Cache hit ratio"
                value={`${Math.round(usage.cacheHitRatio * 100)}%`}
              />
            ) : null}
            {usage.costTotal !== null ? (
              <UsageRow
                label="Est. cost"
                value={`$${usage.costTotal.toFixed(usage.costTotal < 0.01 ? 6 : 4)}`}
              />
            ) : null}
          </View>

          {compactState === "done" && compactResult?.compacted ? (
            <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
              Compacted {compactResult.compactedMessages} messages into a
              summary ({formatTokenNumber(compactResult.summaryChars)} chars),
              freeing ~{formatTokenNumber(compactResult.estimatedFreedTokens)}{" "}
              tokens (est.).
            </Text>
          ) : null}
          {compactState === "error" && compactResult && !compactResult.compacted ? (
            <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
              {compactResult.reason}
            </Text>
          ) : null}
        </DrawerBody>
        <DrawerFooter>
          <Button
            disabled={compactState === "working" || usage.busy}
            loading={compactState === "working"}
            onPress={onCompact}
          >
            Compact
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
