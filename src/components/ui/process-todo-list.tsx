/**
 * Process todo list docked directly above the message bar.
 *
 * Data flow (accuracy by construction):
 * - Steps come from the live assistant message's `metadata.todoList`,
 *   replaced atomically by the agent's `todos` tool; run liveness comes
 *   from `currentConversationRunStatus`. Both are store state, so remounts
 *   and re-renders can never desync or reset the panel.
 * - `visible` is true only while the run is in a live phase AND the list
 *   is non-empty: nothing renders otherwise (no empty state, no
 *   placeholder). Terminal statuses (completed/failed/canceled) unmount
 *   the panel promptly; cancellation leaves no orphaned state because no
 *   step state is stored locally.
 * - The highlight mark (active) and checkmark (done) are derived per
 *   render by `deriveProcessSteps`: at most one active, checkmarks only
 *   from confirmed `completed` statuses, failures distinct.
 */
import { useMemo } from "react";
import { ScrollView, Text, View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { Check, X } from "lucide-react-native";

import { useAppTheme } from "@/hooks/use-app-theme";
import { useChat } from "@/hooks/use-chat";
import { useTheme } from "@/hooks/use-theme";
import {
  deriveProcessSteps,
  findLiveTodoList,
  isProcessActiveStatus,
  type ProcessStep,
} from "@/modules/chat/process-todos";
import { withAlpha } from "@/components/ui/chrome-spec";

const PANEL_MAX_HEIGHT = 208;

export function useProcessTodoList() {
  const { currentConversationRunStatus, messages } = useChat();
  return useMemo(() => {
    const running = isProcessActiveStatus(currentConversationRunStatus);
    const todos = running ? findLiveTodoList(messages) : [];
    const steps = deriveProcessSteps(todos, currentConversationRunStatus);
    return { steps, visible: running && steps.length > 0 };
  }, [currentConversationRunStatus, messages]);
}

function StepMarker({ step }: { step: ProcessStep }) {
  const theme = useTheme();
  const { accent } = useAppTheme();

  if (step.state === "done") {
    return <Check color={accent} size={15} strokeWidth={3} />;
  }
  if (step.state === "failed") {
    return <X color={theme.destructive} size={15} strokeWidth={3} />;
  }
  if (step.state === "active") {
    return (
      <View
        accessibilityLabel="In progress"
        style={{
          backgroundColor: accent,
          borderRadius: 5,
          height: 10,
          width: 10,
        }}
      />
    );
  }
  return (
    <View
      accessibilityLabel="Pending"
      style={{
        borderColor: theme.textSecondary,
        borderRadius: 6,
        borderWidth: 1.5,
        height: 12,
        width: 12,
      }}
    />
  );
}

export function ProcessTodoList() {
  const { accent } = useAppTheme();
  const { steps, visible } = useProcessTodoList();

  if (!visible) {
    return null;
  }

  const activeId = steps.find((step) => step.state === "active")?.id;

  return (
    <Animated.View
      entering={FadeIn.duration(150)}
      exiting={FadeOut.duration(120)}
      accessibilityLabel="Active process steps"
      className="overflow-hidden rounded-card border border-border bg-card dark:border-border-dark dark:bg-card-dark"
    >
      <ScrollView style={{ maxHeight: PANEL_MAX_HEIGHT }}>
        {steps.map((step) => {
          const isActive = step.id === activeId;
          return (
            <View
              key={step.id}
              accessibilityLabel={`${step.title}: ${step.state}`}
              className="flex-row items-center gap-sp-2 px-sp-3 py-sp-2"
              style={
                isActive
                  ? { backgroundColor: withAlpha(accent, 0.12) }
                  : undefined
              }
            >
              <StepMarker step={step} />
              <Text
                className="flex-1 font-sans text-sm text-foreground dark:text-foreground-dark"
                style={isActive ? { fontWeight: "700" } : undefined}
                numberOfLines={2}
              >
                {step.title}
              </Text>
              {step.state === "failed" ? (
                <Text className="font-sans text-xs text-destructive dark:text-destructive-dark">
                  Failed
                </Text>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
    </Animated.View>
  );
}
