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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import {
  CodeMirrorWebView,
  type CodeMirrorWebViewRef,
} from "@/editor/CodeMirrorWebView";
import { adaptAppThemeToEditorTheme } from "@/editor/editorThemeAdapter";
import {
  countBySeverity,
  formatBuffer,
} from "@/editor/editorDiagnostics";
import { grammarKeyForPath } from "@/editor/editorLanguages";
import type {
  EditorWebViewInbound,
  EditorWebViewOutbound,
} from "@/editor/editorTypes";
import { EditorProblemsPanel } from "@/editor/EditorProblemsPanel";
import { EditorStatusFooter } from "@/editor/EditorStatusFooter";
import {
  BreadcrumbBar,
  CodeActionsSheet,
  CommandPalette,
  IntelMenu,
  IntelSettingsSheet,
  ReferencesPanel,
  RefactorSheet,
  RenameDialog,
  SymbolOutlinePanel,
  WorkspaceSymbolsPanel,
  type IntelPanelId,
} from "@/editor/IntelPanels";
import { useIntelBridge, type IntelBridge } from "@/editor/useIntelBridge";
import { urisMatch } from "@/editor/intel-helpers";
import { INTEL_COMMANDS } from "@/modules/intel/commands";
import { createNavigationHistory } from "@/modules/intel/navigation";
import type { IntelTextEdit } from "@/modules/intel/types";
import type { IntelSettings } from "@/modules/intel/settings";
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
  /**
   * Canonical chord ids owned by plugin commands (§45). The document claims
   * exactly these; everything else stays the editor's own keymap.
   */
  commandChords?: readonly string[];
  /** Returns true when the chord was dispatched to a plugin command. */
  onCommandKey?: (chord: string) => boolean;
  /** Master switch for the offline semantic engine (default on). */
  intelEnabled?: boolean;
  initialIntelSettings?: Partial<IntelSettings>;
  /** Project file reader for cross-file intelligence (optional). */
  readFile?: (uri: string) => Promise<{ version: number; text: string } | null>;
  /** Open another file (definition in another file, references). */
  onOpenFile?: (uri: string, line: number, column: number) => void;
  /** Cross-file edits the editor cannot apply itself (rename, refactor). */
  onWorkspaceEdit?: (edits: IntelTextEdit[]) => void;
  /** Terminal workflows (run/build/test); absent hides terminal commands. */
  onTerminalCommand?: (kind: "run-file" | "run-tests" | "build" | "lint") => void;
  /** AI coding actions; absent hides AI commands (never faked). */
  onAiAction?: (id: string, context: { path: string; line: number; column: number }) => void;
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
  commandChords,
  onCommandKey,
  intelEnabled = true,
  initialIntelSettings,
  readFile,
  onOpenFile,
  onWorkspaceEdit,
  onTerminalCommand,
  onAiAction,
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
  const [webReady, setWebReady] = useState(false);
  const queueRef = useRef<EditorWebViewInbound[]>([]);
  // Last text known to be inside the WebView document (echo suppression).
  const webTextRef = useRef(value);
  const [caret, setCaret] = useState({ line: 1, column: 1 });
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [matchCount, setMatchCount] = useState(0);
  const [autocompleteEnabled, setAutocompleteEnabled] = useState(true);
  const [problemsOpen, setProblemsOpen] = useState(false);
  const [intelMenuOpen, setIntelMenuOpen] = useState(false);
  const [intelPanel, setIntelPanel] = useState<IntelPanelId | null>(null);
  const [intelNotice, setIntelNotice] = useState<string | null>(null);

  const changeRef = useRef(onChangeText);
  changeRef.current = onChangeText;
  const valueRef = useRef(value);
  valueRef.current = value;

  const commandKeyRef = useRef(onCommandKey);
  commandKeyRef.current = onCommandKey;

  // Stable: only refs are captured, so effects can depend on it safely.
  const send = useCallback((message: EditorWebViewInbound): void => {
    if (!readyRef.current) {
      queueRef.current.push(message);
      return;
    }
    webViewRef.current?.postInbound(message);
  }, []);

  const applyIntelText = (text: string): void => {
    webTextRef.current = text;
    changeRef.current(text);
    send({ type: "set-doc", text });
  };

  const intel: IntelBridge = useIntelBridge({
    path,
    value,
    grammarKey,
    intelEnabled,
    webViewReady: webReady,
    caret,
    postInbound: send,
    applyText: applyIntelText,
    readFile,
    onOpenFile,
    onWorkspaceEdit,
    initialSettings: initialIntelSettings,
  });
  const intelRef = useRef(intel);
  intelRef.current = intel;

  const navigationRef = useRef(createNavigationHistory());

  const gotoLine = (line: number, column: number): void => {
    navigationRef.current.push({ uri: path, line: caret.line, column: caret.column });
    setCaret({ line, column });
    send({ type: "goto-line", line, column });
  };

  const openIntelFile = (uri: string, line: number, column: number): void => {
    if (onOpenFile) {
      onOpenFile(uri, line, column);
      return;
    }
    setIntelNotice(`Definition lives in ${uri.split("/").pop() ?? uri} — no file opener is wired.`);
  };

  const handleReady = (): void => {
    readyRef.current = true;
    setWebReady(true);
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
    if (intelRef.current.handleOutbound(message)) return;
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
      case "command-key":
        // Unclaimed (e.g. the plugin unloaded mid-gesture) is not an error:
        // the chord is simply dropped rather than typing the key through.
        commandKeyRef.current?.(message.chord);
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
  }, [path, value, send]);

  // Grammar follows the active path (reconfigured live, no reload).
  useEffect(() => {
    send({ type: "grammar", key: grammarKey });
  }, [grammarKey, send]);

  // Theme follows the active AppTheme (reconfigured live, no reload,
  // history preserved).
  const themeKey = JSON.stringify(editorTheme);
  useEffect(() => {
    send({ type: "theme", theme: editorTheme });
    // Serialized key above keeps this effect stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeKey]);

  // Plugin command chords follow the live binding table; re-binding needs no
  // document reload (the bootstrap handler reads the set on each keydown).
  const chordsKey = (commandChords ?? []).join(",");
  useEffect(() => {
    send({ type: "keybindings", chords: chordsKey ? chordsKey.split(",") : [] });
  }, [chordsKey, path, send]);

  // Live match counts while typing in the find bar.
  useEffect(() => {
    if (!searchOpen) return;
    const timeout = setTimeout(() => {
      send({ type: "count", query });
    }, 250);
    return () => {
      clearTimeout(timeout);
    };
  }, [query, searchOpen, send]);

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
  }, [path, autocompleteEnabled, send]);

  // Keep the WebView identity (and its engine) on the open file.
  useEffect(() => {
    send({ type: "intel:reopen", uri: path, version: 0, text: valueRef.current });
  }, [path, send]);

  const { errors, warnings } = countBySeverity(intel.diagnostics);

  const runFormat = (): void => {
    // Semantic formatter first (real edits); legacy canonicalizer as fallback.
    if (intel.intelActive) {
      void intel
        .requestFormat()
        .then((applied) => {
          if (!applied) runLegacyFormat();
        })
        .catch(runLegacyFormat);
      return;
    }
    runLegacyFormat();
  };

  const runLegacyFormat = (): void => {
    const formatted = formatBuffer(path, value);
    if (formatted !== null && formatted !== value) {
      applyIntelText(formatted);
    }
  };

  const runOrganize = (): void => {
    if (!intel.intelActive) {
      setIntelNotice("Organize imports needs the semantic engine (TypeScript/JavaScript).");
      return;
    }
    void intel
      .requestOrganize()
      .then((applied) => {
        if (!applied) setIntelNotice("Nothing to organize.");
      })
      .catch((error: unknown) => {
        setIntelNotice(error instanceof Error ? error.message : String(error));
      });
  };

  const doSave = (): void => {
    if (intel.settings.formatOnSave && intel.intelActive) {
      void intel
        .requestFormat(4000)
        .catch(() => false)
        .then(() => {
          setTimeout(() => {
            onSave?.();
          }, 250);
        });
      return;
    }
    onSave?.();
  };

  const runSearch = (
    action: "next" | "prev" | "replace-one" | "replace-all" | "select-next",
  ): void => {
    if (!query) return;
    send({ type: "search", action, query, replace: replaceText });
  };

  const jumpToLocation = (line: number, column: number): void => {
    gotoLine(line, column);
  };

  const jumpToFirstLocation = (
    locations: { uri: string; range: { start: { line: number; column: number } } }[],
  ): void => {
    const first = locations[0];
    if (!first) {
      setIntelNotice("No target found.");
      return;
    }
    if (urisMatch(first.uri, path)) {
      jumpToLocation(first.range.start.line, first.range.start.column);
      return;
    }
    openIntelFile(first.uri, first.range.start.line, first.range.start.column);
  };

  const runIntelCommand = (id: string): void => {
    switch (id) {
      case "editor.format-document":
        runFormat();
        break;
      case "editor.organize-imports":
        runOrganize();
        break;
      case "editor.toggle-autocomplete":
        toggleAutocomplete();
        break;
      case "editor.toggle-inlay-hints":
        intel.updateSettings({ inlayHintsEnabled: !intel.settings.inlayHintsEnabled });
        break;
      case "editor.toggle-semantic-highlighting":
        intel.updateSettings({ semanticHighlightingEnabled: !intel.settings.semanticHighlightingEnabled });
        break;
      case "editor.fold-all":
        send({ type: "fold-all" });
        break;
      case "editor.unfold-all":
        send({ type: "unfold-all" });
        break;
      case "nav.definition":
        void intel
          .getDefinition()
          .then(jumpToFirstLocation)
          .catch((error: unknown) => setIntelNotice(error instanceof Error ? error.message : String(error)));
        break;
      case "nav.declaration":
        void intel
          .query<{ uri: string; range: { start: { line: number; column: number } } }[]>("declaration")
          .then(jumpToFirstLocation)
          .catch((error: unknown) => setIntelNotice(error instanceof Error ? error.message : String(error)));
        break;
      case "nav.type-definition":
        void intel
          .query<{ uri: string; range: { start: { line: number; column: number } } }[]>("type-definition")
          .then(jumpToFirstLocation)
          .catch((error: unknown) => setIntelNotice(error instanceof Error ? error.message : String(error)));
        break;
      case "nav.references":
        setIntelPanel("references");
        break;
      case "nav.symbol":
        setIntelPanel("outline");
        break;
      case "nav.workspace-symbols":
        setIntelPanel("symbols");
        break;
      case "nav.back": {
        const entry = navigationRef.current.back({ uri: path, line: caret.line, column: caret.column });
        if (entry) jumpToLocation(entry.line, entry.column);
        break;
      }
      case "nav.forward": {
        const entry = navigationRef.current.forward({ uri: path, line: caret.line, column: caret.column });
        if (entry) jumpToLocation(entry.line, entry.column);
        break;
      }
      case "refactor.rename":
        setIntelPanel("rename");
        break;
      case "refactor.quickfix":
        setIntelPanel("actions");
        break;
      case "refactor.action":
        setIntelPanel("actions");
        break;
      case "refactor.extract-variable":
      case "refactor.extract-function":
        setIntelPanel("refactor");
        break;
      case "terminal.run-file":
        onTerminalCommand?.("run-file");
        break;
      case "terminal.run-tests":
        onTerminalCommand?.("run-tests");
        break;
      case "terminal.build":
        onTerminalCommand?.("build");
        break;
      case "terminal.lint":
        onTerminalCommand?.("lint");
        break;
      default:
        if (id.startsWith("ai.") && onAiAction) {
          onAiAction(id, { path, line: caret.line, column: caret.column });
        }
        break;
    }
  };

  const paletteCommands = useMemo(() => {
    return INTEL_COMMANDS.filter((command) => {
      if (command.group === "ai" && !onAiAction) return false;
      if (command.group === "terminal" && !onTerminalCommand) return false;
      if ((command.group === "navigation" || command.group === "refactoring") && !intel.intelActive) {
        return command.id === "nav.back" || command.id === "nav.forward" || command.id === "nav.symbol";
      }
      return true;
    });
  }, [onAiAction, onTerminalCommand, intel.intelActive]);

  const intelStatus = intel.intelActive
    ? `Semantic engine on · ${intel.semanticCounts.errors} errors, ${intel.semanticCounts.warnings} warnings`
    : "Semantic engine off — syntax support only";

  return (
    <View className="flex-1 bg-background dark:bg-background-dark">
      {/* Toolbar: Ln/Col, undo/redo, indent, search, intel, save */}
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
        <EditorToolButton label="Intel" active={intelMenuOpen} onPress={() => setIntelMenuOpen(true)} />
        {onSave ? (
          <EditorToolButton label="Save" primary onPress={doSave} />
        ) : null}
      </View>
      {intel.intelActive ? (
        <View className="border-b border-border dark:border-border-dark">
          <BreadcrumbBar path={path} intel={intel} caretLine={caret.line} onNavigate={jumpToLocation} />
        </View>
      ) : null}
      {intelNotice ? (
        <View className="flex-row items-center gap-sp-2 border-b border-border px-sp-3 py-sp-1 dark:border-border-dark">
          <Text className="flex-1 font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
            {intelNotice}
          </Text>
          <EditorToolButton label="OK" onPress={() => setIntelNotice(null)} />
        </View>
      ) : null}

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
          uri={path}
          intelEnabled={intelEnabled}
        />
      </View>

      {problemsOpen ? (
        <EditorProblemsPanel
          diagnostics={intel.diagnostics}
          onJump={(targetLine, targetColumn) => {
            jumpToLocation(targetLine, targetColumn);
            setProblemsOpen(false);
          }}
        />
      ) : null}

      <IntelMenu
        open={intelMenuOpen}
        onClose={() => setIntelMenuOpen(false)}
        intel={intel}
        onOpenPanel={setIntelPanel}
        onFormat={runFormat}
        onOrganize={runOrganize}
        onInspect={() => send({ type: "intel:inspect" })}
        statusText={intelStatus}
      />
      <SymbolOutlinePanel
        open={intelPanel === "outline"}
        onClose={() => setIntelPanel(null)}
        intel={intel}
        onNavigate={jumpToLocation}
      />
      <ReferencesPanel
        open={intelPanel === "references"}
        onClose={() => setIntelPanel(null)}
        intel={intel}
        fileText={(uri) => (urisMatch(uri, path) ? value : null)}
        onNavigateFile={(uri, line, column) => {
          if (urisMatch(uri, path)) jumpToLocation(line, column);
          else openIntelFile(uri, line, column);
        }}
      />
      <WorkspaceSymbolsPanel
        open={intelPanel === "symbols"}
        onClose={() => setIntelPanel(null)}
        intel={intel}
        onNavigateFile={(uri, line, column) => {
          if (urisMatch(uri, path)) jumpToLocation(line, column);
          else openIntelFile(uri, line, column);
        }}
      />
      <RenameDialog
        open={intelPanel === "rename"}
        onClose={() => setIntelPanel(null)}
        intel={intel}
        caret={caret}
        onApplied={setIntelNotice}
      />
      <CodeActionsSheet
        open={intelPanel === "actions"}
        onClose={() => setIntelPanel(null)}
        intel={intel}
        caret={caret}
        onApplied={setIntelNotice}
      />
      <RefactorSheet
        open={intelPanel === "refactor"}
        onClose={() => setIntelPanel(null)}
        intel={intel}
        caret={caret}
        onApplied={setIntelNotice}
      />
      <CommandPalette
        open={intelPanel === "palette"}
        onClose={() => setIntelPanel(null)}
        commands={paletteCommands}
        onRun={runIntelCommand}
      />
      <IntelSettingsSheet
        open={intelPanel === "settings"}
        onClose={() => setIntelPanel(null)}
        intel={intel}
      />

      <EditorStatusFooter
        autocompleteEnabled={autocompleteEnabled}
        onToggleAutocomplete={toggleAutocomplete}
        format={intel.format}
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
