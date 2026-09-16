/**
 * Mobile code editor (§16): CodeMirror 6 editing surface with Acode-class
 * behavior — 100+ language grammars, autocomplete (any-word + emmet),
 * multi-cursor (rectangular selection, Alt-click, add-next), find/replace
 * with exact match counts, bracket autoclosing, folding, undo/redo,
 * indent controls, Ln/Col caret readout, save, and external-change
 * conflict handling.
 *
 * The heavy lifting runs in the offline `CodeMirrorWebView`; this wrapper
 * owns the RN toolbar, the find/replace bar, theme adaptation, and the
 * message routing between the provider buffer (`value`/`onChangeText`)
 * and the WebView document (echo-suppressed via `webTextRef`, with all
 * pre-ready messages queued and flushed on `ready`).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import {
  CodeMirrorWebView,
  type CodeMirrorWebViewRef,
} from "@/editor/CodeMirrorWebView";
import { adaptAppThemeToEditorTheme } from "@/editor/editorThemeAdapter";
import {
  checkFormat,
  computeDiagnostics,
  countBySeverity,
  formatBuffer,
  type EditorDiagnostic,
  type FormatCheck,
} from "@/editor/editorDiagnostics";
import { grammarKeyForPath } from "@/editor/editorLanguages";
import type {
  EditorWebViewInbound,
  EditorWebViewOutbound,
} from "@/editor/editorTypes";
import { EditorProblemsPanel } from "@/editor/EditorProblemsPanel";
import { EditorStatusFooter } from "@/editor/EditorStatusFooter";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useConfig } from "@/hooks/use-config";
import { useTheme } from "@/hooks/use-theme";

export type CodeMirrorEditorProps = {
  path: string;
  value: string;
  onChangeText: (text: string) => void;
  autoFocus?: boolean;
  onSave?: () => void;
  /** True when the in-memory buffer differs from the saved file. */
  dirty?: boolean;
  externalChanged?: boolean;
  onKeepMine?: () => void;
  onReloadExternal?: () => void;
  onCompareExternal?: () => void;
  onOpenHistory?: () => void;
};

export function CodeMirrorEditor({
  path,
  value,
  onChangeText,
  autoFocus = false,
  onSave,
  dirty = false,
  externalChanged = false,
  onKeepMine,
  onReloadExternal,
  onCompareExternal,
  onOpenHistory,
}: CodeMirrorEditorProps): React.JSX.Element {
  const { theme: appTheme } = useAppTheme();
  const { accentColor } = useConfig();
  const theme = useTheme();
  const editorTheme = useMemo(
    () => adaptAppThemeToEditorTheme(appTheme, accentColor),
    [appTheme, accentColor],
  );
  const grammarKey = useMemo(() => grammarKeyForPath(path), [path]);

  const webViewRef = useRef<CodeMirrorWebViewRef>(null);
  const readyRef = useRef(false);
  const queueRef = useRef<EditorWebViewInbound[]>([]);
  // Last text known to be inside the WebView document (echo suppression).
  const webTextRef = useRef(value);
  const [caret, setCaret] = useState({ line: 1, column: 1 });
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [matchCount, setMatchCount] = useState(0);
  const [autocompleteEnabled, setAutocompleteEnabled] = useState(true);
  const [diagnostics, setDiagnostics] = useState<EditorDiagnostic[]>([]);
  const [format, setFormat] = useState<FormatCheck>({
    valid: true,
    unsupported: true,
    message: null,
  });
  const [problemsOpen, setProblemsOpen] = useState(false);

  const changeRef = useRef(onChangeText);
  changeRef.current = onChangeText;

  const send = (message: EditorWebViewInbound): void => {
    if (!readyRef.current) {
      queueRef.current.push(message);
      return;
    }
    webViewRef.current?.postInbound(message);
  };

  const handleReady = (): void => {
    readyRef.current = true;
    const queued = queueRef.current;
    queueRef.current = [];
    for (const message of queued) {
      webViewRef.current?.postInbound(message);
    }
    if (autoFocus) {
      webViewRef.current?.postInbound({ type: "focus" });
    }
  };

  const handleMessage = (message: EditorWebViewOutbound): void => {
    switch (message.type) {
      case "ready":
        break;
      case "change":
        webTextRef.current = message.text;
        changeRef.current(message.text);
        break;
      case "cursor":
        setCaret({ line: message.line, column: message.column });
        break;
      case "find-count":
        setMatchCount(message.count);
        break;
      case "error":
        console.warn(`CodeMirror editor error: ${message.message}`);
        break;
    }
  };

  // Document sync: tab switches, external reloads, and any other
  // out-of-band buffer change converge into the WebView. Keystroke echoes
  // are skipped (the bootstrap also ignores identical text).
  useEffect(() => {
    if (value !== webTextRef.current) {
      webTextRef.current = value;
      send({ type: "set-doc", text: value });
    }
  }, [path, value]);

  // Grammar follows the active path (reconfigured live, no reload).
  useEffect(() => {
    send({ type: "grammar", key: grammarKey });
  }, [grammarKey]);

  // Theme follows the active AppTheme (reconfigured live, no reload,
  // history preserved).
  const themeKey = JSON.stringify(editorTheme);
  useEffect(() => {
    send({ type: "theme", theme: editorTheme });
    // Serialized key above keeps this effect stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeKey]);

  // Live match counts while typing in the find bar.
  useEffect(() => {
    if (!searchOpen) return;
    const timeout = setTimeout(() => {
      send({ type: "count", query });
    }, 250);
    return () => {
      clearTimeout(timeout);
    };
  }, [query, searchOpen]);

  // The AI-autocomplete footer toggle gates the real provider: when off,
  // the WebView compartment drops autocompletion (any-word + emmet) so no
  // suggestion fires; when on, it is restored live without a reload.
  const toggleAutocomplete = (): void => {
    setAutocompleteEnabled((enabled) => {
      send({ type: "autocomplete", enabled: !enabled });
      return !enabled;
    });
  };

  // Sync the compartment on ready-flush and doc swaps (initial HTML embeds
  // the default-on state; queued toggles flush through `send` already).
  useEffect(() => {
    send({ type: "autocomplete", enabled: autocompleteEnabled });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // Live diagnostics + format validity from the real buffer (debounced).
  useEffect(() => {
    let cancelled = false;
    const timeout = setTimeout(() => {
      void computeDiagnostics(path, value).then((next) => {
        if (!cancelled) setDiagnostics(next);
      });
      void checkFormat(path, value).then((next) => {
        if (!cancelled) setFormat(next);
      });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [path, value]);

  const { errors, warnings } = countBySeverity(diagnostics);

  const runFormat = (): void => {
    const formatted = formatBuffer(path, value);
    if (formatted !== null && formatted !== value) {
      webTextRef.current = formatted;
      changeRef.current(formatted);
      send({ type: "set-doc", text: formatted });
    }
  };

  const runSearch = (
    action: "next" | "prev" | "replace-one" | "replace-all" | "select-next",
  ): void => {
    if (!query) return;
    send({ type: "search", action, query, replace: replaceText });
  };

  return (
    <View className="flex-1 bg-background dark:bg-background-dark">
      {/* Toolbar: Ln/Col, undo/redo, indent, search, save */}
      <View className="flex-row items-center gap-sp-1 border-b border-border px-sp-2 py-sp-1 dark:border-border-dark">
        <Text className="font-mono text-xs text-muted-foreground dark:text-muted-foreground-dark">
          Ln {caret.line}, Col {caret.column}
        </Text>
        <View className="flex-1" />
        <EditorToolButton
          label="Undo"
          onPress={() => {
            send({ type: "undo" });
          }}
        />
        <EditorToolButton
          label="Redo"
          onPress={() => {
            send({ type: "redo" });
          }}
        />
        <EditorToolButton
          label="⇥"
          onPress={() => {
            send({ type: "indent", outdent: false });
          }}
        />
        <EditorToolButton
          label="⇤"
          onPress={() => {
            send({ type: "indent", outdent: true });
          }}
        />
        <EditorToolButton
          label="Find"
          active={searchOpen}
          onPress={() => setSearchOpen((open) => !open)}
        />
        {onSave ? (
          <EditorToolButton label="Save" primary onPress={onSave} />
        ) : null}
      </View>

      {searchOpen ? (
        <View className="gap-sp-1 border-b border-border px-sp-2 py-sp-1 dark:border-border-dark">
          <View className="flex-row items-center gap-sp-1">
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Find"
              placeholderTextColor={theme.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              className="h-9 min-w-0 flex-1 rounded-ui border border-border bg-input px-sp-2 font-mono text-sm text-foreground dark:border-border-dark dark:bg-input-dark dark:text-foreground-dark"
            />
            <Text className="font-mono text-xs text-muted-foreground dark:text-muted-foreground-dark">
              {query ? `${matchCount}` : "0"}
            </Text>
            <EditorToolButton label="↑" onPress={() => runSearch("prev")} />
            <EditorToolButton label="↓" onPress={() => runSearch("next")} />
            <EditorToolButton
              label="+Cursor"
              onPress={() => runSearch("select-next")}
            />
          </View>
          <View className="flex-row items-center gap-sp-1">
            <TextInput
              value={replaceText}
              onChangeText={setReplaceText}
              placeholder="Replace"
              placeholderTextColor={theme.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              className="h-9 min-w-0 flex-1 rounded-ui border border-border bg-input px-sp-2 font-mono text-sm text-foreground dark:border-border-dark dark:bg-input-dark dark:text-foreground-dark"
            />
            <EditorToolButton
              label="Replace"
              onPress={() => runSearch("replace-one")}
            />
            <EditorToolButton label="All" onPress={() => runSearch("replace-all")} />
          </View>
        </View>
      ) : null}

      {externalChanged ? (
        <View className="gap-sp-1 border-b border-border bg-card px-sp-3 py-sp-2 dark:border-border-dark dark:bg-card-dark">
          <Text className="font-sans text-sm font-medium text-foreground dark:text-foreground-dark">
            File changed externally.
          </Text>
          <View className="flex-row gap-sp-2">
            {onKeepMine ? (
              <EditorToolButton label="Keep mine" onPress={onKeepMine} />
            ) : null}
            {onReloadExternal ? (
              <EditorToolButton label="Reload" onPress={onReloadExternal} />
            ) : null}
            {onCompareExternal ? (
              <EditorToolButton label="Compare" onPress={onCompareExternal} />
            ) : null}
          </View>
        </View>
      ) : null}

      <View className="min-h-0 flex-1">
        <CodeMirrorWebView
          ref={webViewRef}
          theme={editorTheme}
          grammarKey={grammarKey}
          initialDoc={value}
          onMessage={handleMessage}
          onReady={handleReady}
        />
      </View>

      {problemsOpen ? (
        <EditorProblemsPanel
          diagnostics={diagnostics}
          onJump={(targetLine, targetColumn) => {
            setCaret({ line: targetLine, column: targetColumn });
            // Real cursor move: the gutter highlights the jumped line and
            // `Ln, Col` reflects it via the cursor outbound message.
            send({ type: "goto-line", line: targetLine, column: targetColumn });
            setProblemsOpen(false);
          }}
        />
      ) : null}

      <EditorStatusFooter
        autocompleteEnabled={autocompleteEnabled}
        onToggleAutocomplete={toggleAutocomplete}
        format={format}
        onFormatPress={runFormat}
        errors={errors}
        warnings={warnings}
        problemsOpen={problemsOpen}
        onToggleProblems={() => setProblemsOpen((open) => !open)}
        line={caret.line}
        column={caret.column}
        dirty={dirty}
        onOpenHistory={() => onOpenHistory?.()}
      />
    </View>
  );
}

function EditorToolButton({
  label,
  onPress,
  active,
  primary,
}: {
  label: string;
  onPress: () => void;
  active?: boolean;
  primary?: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      className="items-center justify-center rounded-ui px-sp-2 py-sp-1"
      style={({ pressed }) => ({
        backgroundColor: primary
          ? "#3B82F6"
          : active
            ? "rgba(59,130,246,0.25)"
            : "transparent",
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text
        className={
          primary
            ? "font-mono text-xs text-white"
            : "font-mono text-xs text-foreground dark:text-foreground-dark"
        }
      >
        {label}
      </Text>
    </Pressable>
  );
}
