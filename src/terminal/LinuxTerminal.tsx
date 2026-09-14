/**
 * Canonical terminal UI — the SOLE terminal component in production.
 *
 * Composition (replaces the old `TerminalView` + `InProcessAdapter` screen):
 *
 *   Ajiro AppTheme → useAppTheme → terminalThemeAdapter → TerminalTheme
 *     → TerminalWebView (local xterm) ⇄ useLinuxTerminal (native PTY)
 *
 * - Theme changes update xterm live via `postInbound({type:"theme"})` — the
 *   PTY/PRoot/Linux session is never restarted for visual updates.
 * - PTY output bypasses React state (DeviceEventEmitter → WebView postMessage)
 *   so large output stays responsive.
 * - Tapping the terminal focuses a hidden TextInput so the OS keyboard
 *   appears; keystrokes go straight to the PTY. A theme-aware toolbar
 *   provides ESC / Tab / Ctrl-C / arrows for mobile coding.
 * - Copy: WebView posts selected text → RN copies via expo-clipboard.
 *   Paste: toolbar button writes clipboard text to the PTY.
 */
import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from "react-native";
import * as Clipboard from "expo-clipboard";

import { useAppTheme } from "@/hooks/use-app-theme";
import { useConfig } from "@/hooks/use-config";
import { adaptAppThemeToTerminalTheme } from "@/terminal/terminalThemeAdapter";
import { TerminalWebView, type TerminalWebViewRef } from "@/terminal/TerminalWebView";
import type {
  LinuxTerminalProps,
  LinuxTerminalRef,
  TerminalDimensions,
  TerminalWebViewMessage,
} from "@/terminal/terminalTypes";
import { useLinuxTerminal } from "@/terminal/useLinuxTerminal";

const TOOLBAR_KEYS: { label: string; data: string }[] = [
  { label: "ESC", data: "\x1b" },
  { label: "TAB", data: "\t" },
  { label: "^C", data: "\x03" },
  { label: "←", data: "\x1b[D" },
  { label: "↑", data: "\x1b[A" },
  { label: "↓", data: "\x1b[B" },
  { label: "→", data: "\x1b[C" },
  { label: "|", data: "|" },
  { label: "~", data: "~" },
  { label: "/", data: "/" },
];

export const LinuxTerminal = forwardRef<LinuxTerminalRef, LinuxTerminalProps>(
  function LinuxTerminal(
    { sessionId, autoFocus = false, showToolbar = true, options, onReady, onResize, onError, onFindResult },
    ref,
  ) {
    const { theme } = useAppTheme();
    const { accentColor } = useConfig();
    const terminalTheme = useMemo(
      () => adaptAppThemeToTerminalTheme(theme, accentColor),
      [theme, accentColor],
    );

    const webViewRef = useRef<TerminalWebViewRef>(null);
    const inputRef = useRef<TextInput>(null);
    const [selection, setSelection] = useState("");
    const [notice, setNotice] = useState<string | null>(null);
    // Controlled IME buffer, always reset to empty: soft keyboards commit
    // whole words via onChangeText (no per-key events), while Backspace/Enter
    // on an empty field arrive via onKeyPress/onSubmitEditing.
    const [imeBuffer, setImeBuffer] = useState("");

    const readyRef = useRef(onReady);
    readyRef.current = onReady;
    const resizeRef = useRef(onResize);
    resizeRef.current = onResize;
    const errorRef = useRef(onError);
    errorRef.current = onError;
    const findResultRef = useRef(onFindResult);
    findResultRef.current = onFindResult;

    const forwardPtyOutput = useCallback((data: string) => {
      webViewRef.current?.postInbound({ type: "input", data });
    }, []);
    const reportPtyExit = useCallback((exitCode: number) => {
      webViewRef.current?.postInbound({
        type: "input",
        data: `\r\n[process exited with code ${exitCode}]\r\n`,
      });
    }, []);
    const reportError = useCallback((message: string) => {
      setNotice(message);
      errorRef.current?.(message);
    }, []);

    const { write, resize, kill, isAlive, bridgeAvailable } = useLinuxTerminal(sessionId, {
      onData: forwardPtyOutput,
      onExit: reportPtyExit,
      onError: reportError,
    });

    const handleWebViewMessage = useCallback(
      (message: TerminalWebViewMessage) => {
        switch (message.type) {
          case "input":
            // Keystrokes produced inside the WebView (hardware keyboard while
            // the xterm textarea holds focus) go straight to the PTY.
            write(message.data);
            break;
          case "resize":
            resize({ cols: message.cols, rows: message.rows });
            break;
          case "focus":
            inputRef.current?.focus();
            break;
          case "selection":
            setSelection(message.text);
            break;
          case "findResult":
            findResultRef.current?.(message.found);
            break;
          case "error":
            setNotice(message.message);
            errorRef.current?.(message.message);
            break;
          case "ready":
          case "blur":
            break;
        }
      },
      [write, resize],
    );

    const handleReady = useCallback(
      (dimensions: TerminalDimensions) => {
        if (autoFocus) {
          setTimeout(() => inputRef.current?.focus(), 350);
        }
        readyRef.current?.(dimensions);
      },
      [autoFocus],
    );

    const handleResize = useCallback(
      (dimensions: TerminalDimensions) => {
        resizeRef.current?.(dimensions);
      },
      [],
    );

    useImperativeHandle(
      ref,
      () => ({
        focus: () => inputRef.current?.focus(),
        blur: () => inputRef.current?.blur(),
        clear: () => webViewRef.current?.postInbound({ type: "clear" }),
        paste: (text: string) => write(text),
        find: (query: string, direction: "next" | "prev" | "clear") => {
          webViewRef.current?.postInbound({ type: "find", query, direction });
        },
      }),
      [write],
    );

    const handleKeyPress = (event: NativeSyntheticEvent<TextInputKeyPressEventData>): void => {
      const { key } = event.nativeEvent;
      if (key === "Backspace") {
        write("\x7f");
      } else if (key === "Enter") {
        // Hardware keyboards report Enter here; soft keyboards go through
        // onSubmitEditing. A duplicate is harmless (empty shell line).
        write("\r");
      }
      // Printable keys travel via onChangeText (covers predictive commit).
    };

    const handleChangeText = (text: string): void => {
      if (text) {
        write(text);
        setImeBuffer("");
      }
    };

    const copySelection = async (): Promise<void> => {
      if (!selection) return;
      await Clipboard.setStringAsync(selection);
      setSelection("");
    };

    const pasteClipboard = async (): Promise<void> => {
      const text = await Clipboard.getStringAsync();
      if (text) write(text);
    };

    return (
      <View
        style={[styles.root, { backgroundColor: terminalTheme.background }]}
        accessibilityLabel={`Linux terminal ${sessionId}`}
      >
        <TerminalWebView
          ref={webViewRef}
          theme={terminalTheme}
          options={options}
          onMessage={handleWebViewMessage}
          onReady={handleReady}
          onResize={handleResize}
        />
        {/* Hidden IME input: tapping the terminal focuses this, the OS
            keyboard appears, and keystrokes route to the PTY. */}
        <TextInput
          ref={inputRef}
          style={styles.hiddenInput}
          value={imeBuffer}
          onChangeText={handleChangeText}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          blurOnSubmit={false}
          multiline={false}
          returnKeyType="go"
          onKeyPress={handleKeyPress}
          onSubmitEditing={() => write("\r")}
          showSoftInputOnFocus
        />
        {!bridgeAvailable || !isAlive || notice ? (
          <View
            style={[
              styles.banner,
              { borderColor: theme.colors.outlineVariant, backgroundColor: theme.colors.surfaceContainer },
            ]}
          >
            <Text style={[styles.bannerText, { color: theme.colors.onSurfaceVariant }]}>
              {!bridgeAvailable
                ? "On-device Linux needs an Android dev-client/APK build with the terminal-pty native module."
                : !isAlive
                  ? "Session ended."
                  : notice}
            </Text>
            {isAlive && notice ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Dismiss notice"
                onPress={() => {
                  setNotice(null);
                }}
                style={[styles.bannerButton, { borderColor: theme.colors.outline }]}
              >
                <Text style={[styles.bannerButtonText, { color: theme.colors.primary }]}>Dismiss</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {selection ? (
          <View
            style={[
              styles.banner,
              { borderColor: theme.colors.outlineVariant, backgroundColor: theme.colors.surfaceContainer },
            ]}
          >
            <Text
              style={[styles.bannerText, { color: theme.colors.onSurfaceVariant }]}
              numberOfLines={1}
            >
              {selection.slice(0, 80)}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Copy selection"
              onPress={copySelection}
              style={[styles.bannerButton, { borderColor: theme.colors.outline }]}
            >
              <Text style={[styles.bannerButtonText, { color: theme.colors.primary }]}>Copy</Text>
            </Pressable>
          </View>
        ) : null}
        {showToolbar ? (
          <View
            style={[
              styles.toolbar,
              {
                borderTopColor: theme.colors.outlineVariant,
                backgroundColor: theme.colors.surfaceContainerLow,
              },
            ]}
          >
            {TOOLBAR_KEYS.map((key) => (
              <Pressable
                key={key.label}
                accessibilityRole="button"
                accessibilityLabel={`Send ${key.label}`}
                onPress={() => write(key.data)}
                style={({ pressed }) => [
                  styles.toolbarKey,
                  { borderColor: theme.colors.outlineVariant },
                  pressed && { backgroundColor: theme.colors.surfaceContainerHigh },
                ]}
              >
                <Text style={[styles.toolbarLabel, { color: theme.colors.onSurface }]}>{key.label}</Text>
              </Pressable>
            ))}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Paste from clipboard"
              onPress={pasteClipboard}
              style={({ pressed }) => [
                styles.toolbarKey,
                { borderColor: theme.colors.outlineVariant },
                pressed && { backgroundColor: theme.colors.surfaceContainerHigh },
              ]}
            >
              <Text style={[styles.toolbarLabel, { color: theme.colors.onSurface }]}>Paste</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Kill session"
              onPress={kill}
              style={({ pressed }) => [
                styles.toolbarKey,
                { borderColor: theme.colors.outlineVariant },
                pressed && { backgroundColor: theme.colors.surfaceContainerHigh },
              ]}
            >
              <Text style={[styles.toolbarLabel, { color: theme.colors.error }]}>Kill</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    );
  },
);

const styles = StyleSheet.create({
  root: { flex: 1 },
  hiddenInput: {
    position: "absolute",
    width: 1,
    height: 1,
    opacity: 0,
  },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderTopWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  bannerText: { flex: 1, fontSize: 12, fontFamily: "monospace" },
  bannerButton: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  bannerButtonText: { fontSize: 12, fontWeight: "600" },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 6,
    gap: 4,
    flexWrap: "wrap",
  },
  toolbarKey: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minWidth: 44,
    alignItems: "center",
  },
  toolbarLabel: { fontSize: 12, fontFamily: "monospace", fontWeight: "600" },
});
