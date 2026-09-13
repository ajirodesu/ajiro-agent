/**
 * ChatGPT-style message capsule, reverse-engineered from the 13 reference
 * screenshots (see modules/chat/composer-stages.ts for the measured spec).
 *
 * ONE layout system:
 * - single row (+, text, mic, send) while text is short and narrow;
 * - column (full-width text over a bottom control row) once text fills the
 *   row width or wraps;
 * - text area grows by measured content height up to the responsive cap,
 *   then scrolls internally while the capsule and controls freeze;
 * - expand affordance appears at 5+ lines and opens a fullscreen editor;
 * - corner radius interpolates pill (26) -> rounded rect (28) with growth.
 *
 * Real editable TextInput throughout (cursor, selection, IME, paste).
 * Colors/typography are reference-sampled; see COMPOSER_COLORS.
 */
import { useEffect, useRef, useState } from "react";
import type { ReactNode, Ref } from "react";
import {
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { ArrowUp, Maximize2, Mic, Plus, StopCircle } from "lucide-react-native";

import { TextInputWrapper, type PasteEventPayload } from "expo-paste-input";

import {
  COMPOSER_COLORS,
  COMPOSER_FONT_SIZE,
  COMPOSER_LINE_HEIGHT,
  COMPOSER_RADIUS_MAX,
  COMPOSER_RADIUS_MIN,
  composerLayoutFor,
  composerTextCap,
} from "@/modules/chat/composer-stages";

export type ComposerCapsuleProps = {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  inputRef?: Ref<TextInput>;
  selection?: { end: number; start: number };
  onSelectionChange?: (event: {
    nativeEvent: { selection: { end: number; start: number } };
  }) => void;
  onPaste?: (payload: PasteEventPayload) => void;
  sendDisabled: boolean;
  loading: boolean;
  onSendPress: () => void;
  onPlusPress: () => void;
  screenHeight: number;
  keyboardHeight: number;
};

const CONTROL_SIZE = 40;
const GLYPH_PLUS = 24;
const GLYPH_MIC = 22;
const GLYPH_SEND = 22;
const GLYPH_EXPAND = 20;

function IconButton({
  accessibilityLabel,
  children,
  onPress,
  background,
}: {
  accessibilityLabel: string;
  children: ReactNode;
  onPress: () => void;
  background?: string;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      hitSlop={6}
      onPress={onPress}
      className="items-center justify-center rounded-full"
      style={({ pressed }) => ({
        backgroundColor: background ?? "transparent",
        height: CONTROL_SIZE,
        opacity: pressed ? 0.7 : 1,
        width: CONTROL_SIZE,
      })}
    >
      {children}
    </Pressable>
  );
}

export function ComposerCapsule({
  value,
  onChangeText,
  placeholder = "Message",
  inputRef,
  selection,
  onSelectionChange,
  onPaste,
  sendDisabled,
  loading,
  onSendPress,
  onPlusPress,
  screenHeight,
  keyboardHeight,
}: ComposerCapsuleProps) {
  const [contentWidth, setContentWidth] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const [rowWidth, setRowWidth] = useState(0);
  const [micNotice, setMicNotice] = useState(false);
  const [expandOpen, setExpandOpen] = useState(false);
  const micTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (micTimer.current) clearTimeout(micTimer.current);
    };
  }, []);

  const hasText = value.trim().length > 0;
  const maxTextHeight = composerTextCap(screenHeight, keyboardHeight);
  // Single-row controls occupy +/mic/send plus gaps (~152dp); the text
  // budget is whatever row width remains for the input.
  const textBudget = Math.max(0, rowWidth - 152);
  const layout = composerLayoutFor(
    contentHeight,
    contentWidth,
    textBudget,
    maxTextHeight,
    hasText,
  );

  const animatedTextHeight = useSharedValue(COMPOSER_LINE_HEIGHT);
  useEffect(() => {
    animatedTextHeight.value = withTiming(layout.textHeight, {
      duration: 130,
      easing: Easing.inOut(Easing.quad),
    });
  }, [animatedTextHeight, layout.textHeight]);

  const animatedTextStyle = useAnimatedStyle(() => ({
    height: animatedTextHeight.value,
  }));
  const capsuleStyle = useAnimatedStyle(() => ({
    borderRadius: interpolate(
      animatedTextHeight.value,
      [COMPOSER_LINE_HEIGHT, maxTextHeight],
      [COMPOSER_RADIUS_MIN, COMPOSER_RADIUS_MAX],
      Extrapolation.CLAMP,
    ),
  }));

  const handleMic = () => {
    // No on-device speech engine is bundled: say so instead of faking it.
    setMicNotice(true);
    if (micTimer.current) clearTimeout(micTimer.current);
    micTimer.current = setTimeout(() => {
      setMicNotice(false);
    }, 2500);
  };

  const inputElement = (
    <TextInputWrapper
      className="min-w-0 flex-1"
      style={{ width: "100%" }}
      onPaste={(payload) => {
        onPaste?.(payload);
      }}
    >
      <TextInput
        ref={inputRef}
        className="h-full w-full min-h-0 border-0 bg-transparent px-0 py-0 font-sans dark:bg-transparent"
        style={{
          color: COMPOSER_COLORS.text,
          fontSize: COMPOSER_FONT_SIZE,
          lineHeight: COMPOSER_LINE_HEIGHT,
        }}
        cursorColor={COMPOSER_COLORS.cursor}
        selectionColor={COMPOSER_COLORS.selection}
        placeholder={placeholder}
        placeholderTextColor={COMPOSER_COLORS.placeholder}
        multiline
        onChangeText={onChangeText}
        onContentSizeChange={(event) => {
          const next = event.nativeEvent.contentSize;
          setContentHeight((current) =>
            current === next.height ? current : next.height,
          );
          setContentWidth((current) =>
            current === next.width ? current : next.width,
          );
        }}
        onSelectionChange={onSelectionChange}
        returnKeyType="default"
        scrollEnabled={layout.scrollable}
        selection={selection}
        submitBehavior="newline"
        textAlignVertical={layout.singleRow ? "center" : "top"}
        value={value}
      />
    </TextInputWrapper>
  );

  const sendButton = (
    <Pressable
      accessibilityLabel={loading ? "Stop generating" : "Send message"}
      accessibilityRole="button"
      accessibilityState={{ disabled: sendDisabled }}
      disabled={sendDisabled}
      hitSlop={8}
      onPress={onSendPress}
      className="items-center justify-center rounded-full"
      style={({ pressed }) => ({
        backgroundColor: COMPOSER_COLORS.send,
        height: CONTROL_SIZE,
        opacity: sendDisabled ? 0.45 : pressed ? 0.85 : 1,
        width: CONTROL_SIZE,
      })}
    >
      {loading ? (
        <StopCircle color="#FFFFFF" size={20} />
      ) : (
        <ArrowUp color="#FFFFFF" size={GLYPH_SEND} strokeWidth={2.5} />
      )}
    </Pressable>
  );

  return (
    <View>
      <Animated.View
        onLayout={(event) => {
          setRowWidth(event.nativeEvent.layout.width);
        }}
        style={[
          capsuleStyle,
          {
            backgroundColor: COMPOSER_COLORS.capsule,
            borderColor: COMPOSER_COLORS.border,
            borderWidth: 1,
          },
        ]}
      >
        {layout.singleRow ? (
          <View className="flex-row items-center px-2 py-1.5">
            <IconButton accessibilityLabel="Attachments and tools" onPress={onPlusPress}>
              <Plus color={COMPOSER_COLORS.icon} size={GLYPH_PLUS} strokeWidth={2} />
            </IconButton>
            <View className="min-w-0 flex-1 px-2">{inputElement}</View>
            <IconButton accessibilityLabel="Voice input" onPress={handleMic}>
              <Mic color={COMPOSER_COLORS.icon} size={GLYPH_MIC} strokeWidth={2} />
            </IconButton>
            <View className="w-2" />
            {sendButton}
          </View>
        ) : (
          <View>
            <View
              style={{
                paddingBottom: 6,
                paddingHorizontal: 16,
                paddingTop: 14,
              }}
            >
              <Animated.View style={[animatedTextStyle]}>
                {inputElement}
              </Animated.View>
            </View>
            <View className="flex-row items-center px-2 pb-2">
              <IconButton accessibilityLabel="Attachments and tools" onPress={onPlusPress}>
                <Plus color={COMPOSER_COLORS.icon} size={GLYPH_PLUS} strokeWidth={2} />
              </IconButton>
              <View className="flex-1" />
              {layout.showExpand ? (
                <IconButton
                  accessibilityLabel="Expand editor"
                  onPress={() => {
                    setExpandOpen(true);
                  }}
                >
                  <Maximize2
                    color={COMPOSER_COLORS.icon}
                    size={GLYPH_EXPAND}
                    strokeWidth={2}
                  />
                </IconButton>
              ) : null}
              <IconButton accessibilityLabel="Voice input" onPress={handleMic}>
                <Mic color={COMPOSER_COLORS.icon} size={GLYPH_MIC} strokeWidth={2} />
              </IconButton>
              <View className="w-2" />
              {sendButton}
            </View>
          </View>
        )}
      </Animated.View>

      {micNotice ? (
        <Text className="mt-1 px-4 font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
          Voice input is not available on this device yet.
        </Text>
      ) : null}

      <Modal
        animationType="slide"
        onRequestClose={() => {
          setExpandOpen(false);
        }}
        transparent={false}
        visible={expandOpen}
      >
        <View className="flex-1 bg-background px-sp-4 pb-sp-4 pt-sp-12 dark:bg-background-dark">
          <View className="flex-row items-center justify-between pb-sp-2">
            <Text className="font-sans text-base font-semibold text-foreground dark:text-foreground-dark">
              Message
            </Text>
            <Pressable
              accessibilityLabel="Close expanded editor"
              accessibilityRole="button"
              onPress={() => {
                setExpandOpen(false);
              }}
              hitSlop={8}
              className="rounded-full bg-secondary px-sp-4 py-sp-2 dark:bg-secondary-dark"
            >
              <Text className="font-sans text-sm font-medium text-foreground dark:text-foreground-dark">
                Done
              </Text>
            </Pressable>
          </View>
          <TextInput
            autoFocus
            className="flex-1 font-sans text-foreground dark:text-foreground-dark"
            style={{
              fontSize: COMPOSER_FONT_SIZE,
              lineHeight: 26,
              textAlignVertical: "top",
            }}
            cursorColor={COMPOSER_COLORS.cursor}
            selectionColor={COMPOSER_COLORS.selection}
            placeholder={placeholder}
            placeholderTextColor={COMPOSER_COLORS.placeholder}
            multiline
            onChangeText={onChangeText}
            scrollEnabled
            value={value}
          />
        </View>
      </Modal>
    </View>
  );
}
