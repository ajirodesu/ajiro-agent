/**
 * ChatGPT-style message capsule, converted from chat-ui.html (1260x2800
 * proportional spec) and calibrated to the reference photo.
 *
 * Horizontal metrics scale with screen width (canvas 1260 units):
 * plus/send circles 112, plus glyph 93, mic glyph 84, right gap 83,
 * capsule padding 26 left / 34 right, middle padding 24. Vertical metrics
 * stay at the validated 52 / 22 system (single-row pill, 11-line cap).
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
 */
import { useEffect, useRef, useState } from "react";
import type { ReactNode, Ref } from "react";
import {
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { Maximize2, Mic, Plus, StopCircle } from "lucide-react-native";
import { Path, Svg } from "react-native-svg";

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

/** Canvas unit: chat-ui.html is authored on a 1260-wide canvas. */
const CANVAS_WIDTH = 1260;

/**
 * Tabler arrow-up, exact geometry from the reference (shaft M12 5l0 14,
 * wings M18 11l-6-6 / M6 11l6-6), stroke 2 round caps/joins.
 */
export function TablerArrowUp({
  color,
  size,
}: {
  color: string;
  size: number;
}) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d="M0 0h24v24H0z" stroke="none" fill="none" />
      <Path d="M12 5l0 14" />
      <Path d="M18 11l-6 -6" />
      <Path d="M6 11l6 -6" />
    </Svg>
  );
}

function IconButton({
  accessibilityLabel,
  children,
  onPress,
  background,
  flashOnPress,
  size,
}: {
  accessibilityLabel: string;
  children: ReactNode;
  onPress: () => void;
  background?: string;
  /**
   * When true the container stays invisible until touched (pressed state
   * flashes the container). Used for the + control, which shares the send
   * button's circle container.
   */
  flashOnPress?: boolean;
  size: number;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      hitSlop={6}
      onPress={onPress}
      className="items-center justify-center rounded-full"
      style={({ pressed }) => ({
        backgroundColor:
          background ??
          (flashOnPress && pressed
            ? COMPOSER_COLORS.plusActive
            : "transparent"),
        height: size,
        opacity:
          !background && !flashOnPress && pressed ? 0.7 : 1,
        width: size,
      })}
    >
      {children}
    </Pressable>
  );
}

export function ComposerCapsule({
  value,
  onChangeText,
  placeholder = "Message Ajiro Agent",
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
  const { width: screenWidth } = useWindowDimensions();
  const scale = screenWidth / CANVAS_WIDTH;
  const px = (canvasPx: number) => Math.max(1, Math.round(canvasPx * scale));
  const controlSize = px(112);
  const glyphPlus = px(93);
  const glyphMic = px(84);
  const glyphSend = 24;
  const rightGap = px(83);
  const padLeft = px(26);
  const padRight = px(34);
  const padMiddle = px(24);

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
  // Single-row controls occupy +/mic/send plus gaps; the text budget is
  // whatever row width remains for the input.
  const textBudget = Math.max(
    0,
    rowWidth - controlSize * 3 - rightGap - padLeft - padRight,
  );
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

  const sendActive = hasText || loading;

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

  const plusButton = (
    <IconButton
      accessibilityLabel="Attachments and tools"
      onPress={onPlusPress}
      flashOnPress
      size={controlSize}
    >
      <Plus color={COMPOSER_COLORS.icon} size={glyphPlus} strokeWidth={2} />
    </IconButton>
  );

  const micButton = (
    <IconButton
      accessibilityLabel="Voice input"
      onPress={handleMic}
      size={controlSize}
    >
      <Mic color={COMPOSER_COLORS.icon} size={glyphMic} strokeWidth={2} />
    </IconButton>
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
        // Inside the capsule: grey circle + grey arrow while inactive,
        // accent circle + white arrow once active.
        backgroundColor: sendActive
          ? COMPOSER_COLORS.send
          : COMPOSER_COLORS.sendInactive,
        height: controlSize,
        opacity: pressed ? 0.85 : 1,
        width: controlSize,
      })}
    >
      {loading ? (
        <StopCircle color="#FFFFFF" size={20} />
      ) : (
        <TablerArrowUp
          color={sendActive ? "#FFFFFF" : COMPOSER_COLORS.sendArrowInactive}
          size={glyphSend}
        />
      )}
    </Pressable>
  );

  const expandButton = (
    <IconButton
      accessibilityLabel="Expand editor"
      onPress={() => {
        setExpandOpen(true);
      }}
      size={controlSize}
    >
      <Maximize2 color={COMPOSER_COLORS.icon} size={px(56)} strokeWidth={2} />
    </IconButton>
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
          <View
            className="flex-row items-center"
            style={{
              paddingLeft: padLeft,
              paddingRight: padRight,
              paddingVertical: 8,
            }}
          >
            {plusButton}
            <View
              className="min-w-0 flex-1"
              style={{ paddingHorizontal: padMiddle }}
            >
              {inputElement}
            </View>
            {micButton}
            <View style={{ width: rightGap }} />
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
            <View
              className="flex-row items-center"
              style={{
                paddingLeft: padLeft,
                paddingRight: padRight,
                paddingBottom: 8,
              }}
            >
              {plusButton}
              <View className="flex-1" />
              {layout.showExpand ? expandButton : null}
              {micButton}
              <View style={{ width: rightGap }} />
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
