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
  runOnJS,
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
  COMPOSER_MARGIN_RATIO,
  COMPOSER_RADIUS_MAX,
  COMPOSER_RADIUS_MIN,
  POST_CHAT_BOTTOM_OFFSET,
  POST_CHAT_DURATION_MS,
  POST_CHAT_HEIGHT,
  POST_CHAT_MIC_CENTER_FROM_RIGHT,
  POST_CHAT_MIC_GLYPH,
  POST_CHAT_PH_IN_MS,
  POST_CHAT_PH_OUT_MS,
  POST_CHAT_PLACEHOLDER,
  POST_CHAT_PLUS_CENTER,
  POST_CHAT_PLUS_GLYPH,
  POST_CHAT_RADIUS,
  POST_CHAT_ROW_DELAY_MS,
  POST_CHAT_ROW_DURATION_MS,
  POST_CHAT_ROW_HEIGHT,
  POST_CHAT_ROW_SHIFT_DP,
  POST_CHAT_ROW1_BOTTOM_PAD,
  POST_CHAT_ROW1_TOP_PAD,
  POST_CHAT_SEND_CENTER_FROM_RIGHT,
  POST_CHAT_SEND_DIAMETER,
  POST_CHAT_TEXT_LEFT,
  composerLayoutFor,
  composerTextCap,
} from "@/modules/chat/composer-stages";
import { withAlpha } from "@/components/ui/chrome-spec";
import { useTheme } from "@/hooks/use-theme";

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
  /**
   * Post-chat form: true once the first message is sent (driven by the
   * screen on send-button press). The pre-chat form renders byte-identical
   * output to before; only the post branches below are new.
   */
  postChat?: boolean;
  /**
   * Resolved app accent for the active send state (locked to the theme
   * primary for aqua/burnt/indigo, user accent otherwise). Defaults to the
   * reference send blue.
   */
  accentColor?: string;
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
  flashColor,
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
  flashColor?: string;
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
            ? (flashColor ?? "transparent")
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

/** Ease-out-expo: fast start, soft settle. No springs, no overshoot. */
const POST_CHAT_EASING = Easing.bezier(0.22, 1, 0.36, 1);

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
  accentColor = COMPOSER_COLORS.send,
  postChat = false,
}: ComposerCapsuleProps) {
  const theme = useTheme();
  const { width: screenWidth } = useWindowDimensions();
  const colors = {
    capsule: theme.backgroundElement,
    border: theme.border,
    text: theme.text,
    placeholder: theme.textSecondary,
    cursor: theme.text,
    selection: withAlpha(theme.accent, 0.35),
    sendInactive: theme.backgroundSelected,
    sendArrowInactive: theme.textSecondary,
    icon: theme.text,
    plusActive: theme.backgroundSelected,
  };
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

  // Post-send transformation state. "pre" renders the untouched pre-chat
  // form; "animating" runs the one-shot 260 ms transition; "post" renders
  // the settled two-row form. Mounting directly in post skips animation.
  const [phase, setPhase] = useState<"pre" | "animating" | "post">(
    postChat ? "post" : "pre",
  );
  const [phPost, setPhPost] = useState(postChat);
  const [controlsLive, setControlsLive] = useState(postChat);
  const firedRef = useRef(postChat);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const progress = useSharedValue(postChat ? 1 : 0);
  const rowQ = useSharedValue(postChat ? 1 : 0);
  const inputFade = useSharedValue(1);
  const preRowFade = useSharedValue(1);
  const preHeightSV = useSharedValue(56);

  useEffect(() => {
    const timers = timersRef.current;
    if (!postChat) {
      // New conversation: snap everything back without animation.
      firedRef.current = false;
      progress.value = 0;
      rowQ.value = 0;
      inputFade.value = 1;
      preRowFade.value = 1;
      setPhPost(false);
      setControlsLive(false);
      setPhase("pre");
      return;
    }
    if (firedRef.current) {
      if (phase !== "post") {
        progress.value = 1;
        rowQ.value = 1;
        inputFade.value = 1;
        preRowFade.value = 0;
        setPhPost(true);
        setControlsLive(true);
        setPhase("post");
      }
      return;
    }
    firedRef.current = true;
    setPhase("animating");
    progress.value = withTiming(1, {
      duration: POST_CHAT_DURATION_MS,
      easing: POST_CHAT_EASING,
    });
    // Row 2 settles in after the capsule starts expanding (40 ms stagger).
    timers.push(
      setTimeout(() => {
        rowQ.value = withTiming(1, {
          duration: POST_CHAT_ROW_DURATION_MS,
          easing: POST_CHAT_EASING,
        });
      }, POST_CHAT_ROW_DELAY_MS),
    );
    timers.push(setTimeout(() => setControlsLive(true), 100));
    // Placeholder cross-fade: 120 ms out, swap, 120 ms in. The field is
    // never disabled — opacity alone never blocks touch or focus.
    inputFade.value = withTiming(
      0,
      { duration: POST_CHAT_PH_OUT_MS, easing: POST_CHAT_EASING },
      (finished) => {
        if (!finished) return;
        runOnJS(setPhPost)(true);
        inputFade.value = withTiming(1, {
          duration: POST_CHAT_PH_IN_MS,
          easing: POST_CHAT_EASING,
        });
      },
    );
    preRowFade.value = withTiming(0, {
      duration: POST_CHAT_PH_OUT_MS,
      easing: POST_CHAT_EASING,
    });
    // Completion lands on the settled form; the timeout is belt-and-braces
    // in case a worklet callback is ever dropped.
    const finish = () => setPhase("post");
    timers.push(setTimeout(finish, POST_CHAT_DURATION_MS + 150));
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timersRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postChat]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
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

  // Post-chat choreography (same math as postChatFrame in composer-stages:
  // height and radius share the eased driver, so they stay proportionate).
  // Width is never animated; the 16 dp post margins arrive via negative
  // margins against the wrapper's 9.45% margins.
  const postMarginCompensation = 16 - screenWidth * COMPOSER_MARGIN_RATIO;
  const postContainerStyle = useAnimatedStyle(() => ({
    minHeight: interpolate(
      progress.value,
      [0, 1],
      [preHeightSV.value, POST_CHAT_HEIGHT],
    ),
    borderRadius: interpolate(
      progress.value,
      [0, 1],
      [preHeightSV.value / 2, POST_CHAT_RADIUS],
    ),
    marginHorizontal: interpolate(progress.value, [0, 1], [0, postMarginCompensation]),
    marginBottom: interpolate(progress.value, [0, 1], [0, POST_CHAT_BOTTOM_OFFSET]),
  }));
  const postRow1Style = useAnimatedStyle(() => ({
    paddingTop: interpolate(
      progress.value,
      [0, 1],
      [8, POST_CHAT_ROW1_TOP_PAD],
    ),
    paddingBottom: interpolate(
      progress.value,
      [0, 1],
      [
        Math.max(8, preHeightSV.value - 8 - COMPOSER_LINE_HEIGHT),
        POST_CHAT_ROW1_BOTTOM_PAD,
      ],
    ),
  }));
  const preOverlayStyle = useAnimatedStyle(() => ({
    opacity: preRowFade.value,
  }));
  const postRow2Style = useAnimatedStyle(() => ({
    opacity: rowQ.value,
    transform: [
      {
        translateY: interpolate(
          rowQ.value,
          [0, 1],
          [POST_CHAT_ROW_SHIFT_DP, 0],
        ),
      },
    ],
  }));
  const postInputFadeStyle = useAnimatedStyle(() => ({
    opacity: inputFade.value,
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

  // Measured pre-chat height (drives the transition start point). Updated
  // only before the first transition; afterwards the post form owns sizing.
  const [preHeight, setPreHeight] = useState(56);
  const measurePreHeight = (height: number) => {
    if (firedRef.current) return;
    if (Math.abs(height - preHeight) >= 0.5) setPreHeight(height);
    preHeightSV.value = height;
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
          color: colors.text,
          fontSize: COMPOSER_FONT_SIZE,
          lineHeight: COMPOSER_LINE_HEIGHT,
        }}
        cursorColor={colors.cursor}
        selectionColor={colors.selection}
        placeholder={placeholder}
        placeholderTextColor={colors.placeholder}
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
      flashColor={colors.plusActive}
      flashOnPress
      size={controlSize}
    >
      <Plus color={colors.icon} size={glyphPlus} strokeWidth={2} />
    </IconButton>
  );

  const micButton = (
    <IconButton
      accessibilityLabel="Voice input"
      onPress={handleMic}
      size={controlSize}
    >
      <Mic color={colors.icon} size={glyphMic} strokeWidth={2} />
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
        // app accent circle + white arrow once active.
        backgroundColor: sendActive
          ? accentColor
          : colors.sendInactive,
        height: controlSize,
        opacity: pressed ? 0.85 : 1,
        width: controlSize,
      })}
    >
      {loading ? (
        <StopCircle color={theme.accentForeground} size={20} />
      ) : (
        <TablerArrowUp
          color={sendActive ? theme.accentForeground : colors.sendArrowInactive}
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
      <Maximize2 color={colors.icon} size={px(56)} strokeWidth={2} />
    </IconButton>
  );

  // Post-chat control row (fixed dp geometry, NOT canvas-scaled): 48 dp
  // touch targets with the + glyph (28) centered 25 dp from the left edge,
  // the mic glyph (24) centered 85 dp from the right edge, and the 36 dp
  // send circle centered 28 dp from the right edge — all sharing one
  // vertical center line inside the 46 dp bottom-anchored row.
  const postPlus = (
    <Pressable
      accessibilityLabel="Attachments and tools"
      accessibilityRole="button"
      onPress={onPlusPress}
      className="items-center justify-center"
      style={({ pressed }) => ({
        backgroundColor: pressed ? colors.plusActive : "transparent",
        borderRadius: 24,
        height: 48,
        width: 48,
      })}
    >
      <Plus color={colors.icon} size={POST_CHAT_PLUS_GLYPH} strokeWidth={2} />
    </Pressable>
  );

  const postMic = (
    <Pressable
      accessibilityLabel="Voice input"
      accessibilityRole="button"
      onPress={handleMic}
      className="items-center justify-center"
      style={({ pressed }) => ({
        height: 48,
        opacity: pressed ? 0.7 : 1,
        width: 48,
      })}
    >
      <Mic color={colors.icon} size={POST_CHAT_MIC_GLYPH} strokeWidth={2} />
    </Pressable>
  );

  const postSend = (
    <Pressable
      accessibilityLabel={loading ? "Stop generating" : "Send message"}
      accessibilityRole="button"
      accessibilityState={{ disabled: sendDisabled }}
      disabled={sendDisabled}
      onPress={onSendPress}
      className="items-center justify-center"
      style={({ pressed }) => ({
        height: 48,
        opacity: pressed ? 0.85 : 1,
        width: 48,
      })}
    >
      <View
        className="items-center justify-center rounded-full"
        style={{
          backgroundColor: sendActive ? accentColor : colors.sendInactive,
          height: POST_CHAT_SEND_DIAMETER,
          width: POST_CHAT_SEND_DIAMETER,
        }}
      >
        {loading ? (
          <StopCircle color={theme.accentForeground} size={20} />
        ) : (
          <TablerArrowUp
            color={
              sendActive ? theme.accentForeground : colors.sendArrowInactive
            }
            size={glyphSend}
          />
        )}
      </View>
    </Pressable>
  );

  // Post-chat input: same typography, colors, and handlers as the pre-chat
  // input; never disabled, so it stays interactive through the transition.
  const postInput = (
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
          color: colors.text,
          fontSize: COMPOSER_FONT_SIZE,
          lineHeight: COMPOSER_LINE_HEIGHT,
          maxHeight: maxTextHeight,
        }}
        cursorColor={colors.cursor}
        selectionColor={colors.selection}
        placeholder={phPost ? POST_CHAT_PLACEHOLDER : placeholder}
        placeholderTextColor={colors.placeholder}
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
        scrollEnabled={contentHeight > maxTextHeight}
        selection={selection}
        submitBehavior="newline"
        textAlignVertical="top"
        value={value}
      />
    </TextInputWrapper>
  );

  // Pre-chat rows, rendered verbatim in the pre phase and as a fading
  // absolute snapshot during the transition. Untouched behavior otherwise.
  const renderPreRows = () =>
    layout.singleRow ? (
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
        );

  return (
    <View>
      {phase === "pre" ? (
        <Animated.View
          onLayout={(event) => {
            setRowWidth(event.nativeEvent.layout.width);
            measurePreHeight(event.nativeEvent.layout.height);
          }}
          style={[
            capsuleStyle,
            {
              backgroundColor: colors.capsule,
              borderColor: colors.border,
              borderWidth: 1,
            },
          ]}
        >
          {renderPreRows()}
        </Animated.View>
      ) : (
        <Animated.View
          onLayout={(event) => {
            setRowWidth(event.nativeEvent.layout.width);
          }}
          style={[
            postContainerStyle,
            {
              backgroundColor: colors.capsule,
              borderColor: colors.border,
              borderWidth: 1,
              overflow: "hidden",
            },
          ]}
        >
          {phase === "animating" ? (
            <Animated.View
              key="pre-overlay"
              pointerEvents="none"
              style={[
                preOverlayStyle,
                {
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  height: preHeight,
                  borderRadius: preHeight / 2,
                  overflow: "hidden",
                  backgroundColor: colors.capsule,
                },
              ]}
            >
              {renderPreRows()}
            </Animated.View>
          ) : null}
          <Animated.View
            key="post-row1"
            style={[
              postRow1Style,
              { paddingHorizontal: POST_CHAT_TEXT_LEFT },
            ]}
          >
            <Animated.View key="post-input" style={postInputFadeStyle}>
              {postInput}
            </Animated.View>
          </Animated.View>
          <Animated.View
            key="post-row2"
            pointerEvents={controlsLive || phase === "post" ? "auto" : "none"}
            style={[
              postRow2Style,
              {
                position: "absolute",
                left: 0,
                right: 0,
                bottom: 0,
                height: POST_CHAT_ROW_HEIGHT,
              },
            ]}
          >
            {/* Touch targets are 48 dp; glyph centers land on spec:
                plus at 25 from the left, mic 85 and send 28 from the
                right (57 dp center-to-center). */}
            <View
              className="flex-row flex-1 items-center"
              style={{
                paddingLeft: POST_CHAT_PLUS_CENTER - 24,
                paddingRight: POST_CHAT_SEND_CENTER_FROM_RIGHT - 24,
              }}
            >
              {postPlus}
              <View className="flex-1" />
              {postMic}
              <View
                style={{
                  width:
                    POST_CHAT_MIC_CENTER_FROM_RIGHT -
                    POST_CHAT_SEND_CENTER_FROM_RIGHT -
                    48,
                }}
              />
              {postSend}
            </View>
          </Animated.View>
        </Animated.View>
      )}

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
            cursorColor={colors.cursor}
            selectionColor={colors.selection}
            placeholder={phPost ? POST_CHAT_PLACEHOLDER : placeholder}
            placeholderTextColor={colors.placeholder}
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
