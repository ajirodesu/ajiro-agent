/**
 * Mobile code editor (§16): line numbers, syntax highlighting, active-line
 * highlight, caret Ln/Col, undo/redo, indent controls, find/replace, save,
 * dirty tracking, read-only mode, and external-change conflicts.
 *
 * RN has no DOM overlay tricks, so highlighting renders as a spans layer
 * under a transparent TextInput with identical font metrics; both live in
 * one bidirectional ScrollView (inner scroll disabled) so they move as one.
 * Persian-Bot parity (overlay editor, Tab indent, Ln/Col, active line)
 * adapted to touch: toolbar buttons replace Tab/Ctrl+S chords.
 */
import { useMemo, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import { useTheme } from "@/hooks/use-theme";
import {
  findAllMatches,
  offsetToLineCol,
  pushUndo,
  redoEdit,
  replaceAllOccurrences,
  undoEdit,
  type TextMatch,
  type UndoState,
} from "@/modules/editor/text-ops";
import {
  highlightToRuns,
  type SyntaxPalette,
} from "@/modules/editor/syntax";

export type CodeEditorProps = {
  value: string;
  onChangeText: (text: string) => void;
  language: string | null;
  readOnly?: boolean;
  autoFocus?: boolean;
  onSave?: () => void;
  externalChanged?: boolean;
  onKeepMine?: () => void;
  onReloadExternal?: () => void;
  onCompareExternal?: () => void;
};

const FONT_SIZE = 13;
const LINE_HEIGHT = 20;
const PAD = 12;
const MIN_GUTTER = 44;

function paletteForTheme(theme: ReturnType<typeof useTheme>): SyntaxPalette {
  return {
    base: theme.text,
    keyword: theme.syntaxKeyword,
    string: theme.syntaxString,
    comment: theme.syntaxComment,
    number: theme.syntaxNumber,
    function: theme.syntaxFunction,
    type: theme.syntaxConstant,
    property: theme.syntaxOperator,
    tag: theme.syntaxKeyword,
    punctuation: theme.textSecondary,
  };
}

export function CodeEditor({
  value,
  onChangeText,
  language,
  readOnly = false,
  autoFocus = false,
  onSave,
  externalChanged = false,
  onKeepMine,
  onReloadExternal,
  onCompareExternal,
}: CodeEditorProps) {
  const theme = useTheme();
  const palette = useMemo(() => paletteForTheme(theme), [theme]);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [scrollY, setScrollY] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const undoRef = useRef<UndoState>({ past: [], future: [] });
  const vScrollRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);

  const lineCount = useMemo(() => value.split("\n").length, [value]);
  const gutterWidth = useMemo(
    () => Math.max(MIN_GUTTER, String(lineCount).length * 9 + 18),
    [lineCount],
  );
  const caret = useMemo(
    () => offsetToLineCol(value, selection.start),
    [value, selection.start],
  );

  const runs = useMemo(
    () => highlightToRuns(value, language, palette),
    [value, language, palette],
  );

  const matches = useMemo<TextMatch[]>(
    () => findAllMatches(value, query, false),
    [value, query],
  );

  const scrollToOffset = (offset: number) => {
    const { line } = offsetToLineCol(value, offset);
    vScrollRef.current?.scrollTo({
      y: Math.max(0, (line - 2) * LINE_HEIGHT),
      animated: true,
    });
  };

  const commitText = (next: string, cursor?: number) => {
    undoRef.current = pushUndo(undoRef.current, value);
    onChangeText(next);
    if (cursor !== undefined) {
      const clamped = Math.min(Math.max(0, cursor), next.length);
      // Apply after the value commits so the caret lands correctly.
      requestAnimationFrame(() => {
        inputRef.current?.setNativeProps?.({
          selection: { start: clamped, end: clamped },
        });
        setSelection({ start: clamped, end: clamped });
      });
    }
  };

  const handleUndo = () => {
    const result = undoEdit(undoRef.current, value);
    undoRef.current = result.state;
    if (result.text !== value) onChangeText(result.text);
  };

  const handleRedo = () => {
    const result = redoEdit(undoRef.current, value);
    undoRef.current = result.state;
    if (result.text !== value) onChangeText(result.text);
  };

  const insertIndent = (outdent: boolean) => {
    if (readOnly) return;
    const { start, end } = selection;
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    if (outdent) {
      if (value.slice(lineStart, lineStart + 2) === "  ") {
        commitText(
          value.slice(0, lineStart) + value.slice(lineStart + 2),
          Math.max(lineStart, start - 2),
        );
      }
      return;
    }
    commitText(
      value.slice(0, start) + "  " + value.slice(end),
      start + 2,
    );
  };

  const stepMatch = (direction: 1 | -1) => {
    if (matches.length === 0) return;
    const next =
      (matchIndex + direction + matches.length) % matches.length;
    setMatchIndex(next);
    scrollToOffset(matches[next]!.start);
  };

  const doReplace = (all: boolean) => {
    if (readOnly || !query) return;
    if (all) {
      const result = replaceAllOccurrences(value, query, replaceText, false);
      if (result.count > 0) commitText(result.text);
      return;
    }
    const match = matches[matchIndex];
    if (!match) return;
    commitText(
      value.slice(0, match.start) + replaceText + value.slice(match.end),
      match.start + replaceText.length,
    );
  };

  const renderHighlighted = () => {
    if (!runs) {
      return (
        <Text
          style={{
            fontFamily: "monospace",
            fontSize: FONT_SIZE,
            lineHeight: LINE_HEIGHT,
            color: palette.base,
          }}
        >
          {value || " "}
        </Text>
      );
    }
    if (!query.trim()) {
      return (
        <Text
          style={{
            fontFamily: "monospace",
            fontSize: FONT_SIZE,
            lineHeight: LINE_HEIGHT,
          }}
        >
          {runs.map((run, index) => (
            <Text
              key={index}
              style={{
                color: run.color ?? palette.base,
                fontWeight: run.bold ? "700" : "400",
                fontStyle: run.italic ? "italic" : "normal",
              }}
            >
              {run.text}
            </Text>
          ))}
        </Text>
      );
    }
    // Split runs on matches so hits highlight over syntax colors.
    const full = runs.map((run) => run.text).join("");
    const hits = findAllMatches(full, query.trim(), false);
    const parts: { text: string; match: boolean; color: string | null }[] = [];
    // Map run boundaries to absolute offsets.
    const boundaries: { end: number; color: string | null }[] = [];
    let cursor = 0;
    for (const run of runs) {
      cursor += run.text.length;
      boundaries.push({ end: cursor, color: run.color });
    }
    const colorAt = (offset: number): string | null => {
      for (const boundary of boundaries) {
        if (offset < boundary.end) return boundary.color;
      }
      return null;
    };
    let at = 0;
    for (const hit of hits) {
      if (hit.start > at) {
        parts.push({
          text: full.slice(at, hit.start),
          match: false,
          color: colorAt(at),
        });
      }
      parts.push({
        text: full.slice(hit.start, hit.end),
        match: true,
        color: colorAt(hit.start),
      });
      at = hit.end;
    }
    if (at < full.length) {
      parts.push({ text: full.slice(at), match: false, color: colorAt(at) });
    }
    return (
      <Text
        style={{
          fontFamily: "monospace",
          fontSize: FONT_SIZE,
          lineHeight: LINE_HEIGHT,
        }}
      >
        {parts.map((part, index) => (
          <Text
            key={index}
            style={{
              color: part.match ? "#000000" : (part.color ?? palette.base),
              backgroundColor: part.match ? "#FFD54A" : undefined,
            }}
          >
            {part.text}
          </Text>
        ))}
      </Text>
    );
  };

  return (
    <View className="flex-1 bg-background dark:bg-background-dark">
      {/* Toolbar: dirty, Ln/Col, undo/redo, indent, search, save */}
      <View className="flex-row items-center gap-sp-1 border-b border-border px-sp-2 py-sp-1 dark:border-border-dark">
        <View
          className="rounded-full"
          style={{
            width: 8,
            height: 8,
            backgroundColor: "#3B82F6",
            opacity: 1,
          }}
        />
        <Text className="font-mono text-xs text-muted-foreground dark:text-muted-foreground-dark">
          Ln {caret.line}, Col {caret.column}
        </Text>
        <View className="flex-1" />
        {!readOnly ? (
          <>
            <EditorToolButton label="Undo" onPress={handleUndo} />
            <EditorToolButton label="Redo" onPress={handleRedo} />
            <EditorToolButton label="⇥" onPress={() => insertIndent(false)} />
            <EditorToolButton label="⇤" onPress={() => insertIndent(true)} />
          </>
        ) : null}
        <EditorToolButton
          label="Find"
          active={searchOpen}
          onPress={() => setSearchOpen((open) => !open)}
        />
        {onSave && !readOnly ? (
          <EditorToolButton label="Save" primary onPress={onSave} />
        ) : null}
      </View>

      {searchOpen ? (
        <View className="gap-sp-1 border-b border-border px-sp-2 py-sp-1 dark:border-border-dark">
          <View className="flex-row items-center gap-sp-1">
            <TextInput
              value={query}
              onChangeText={(text) => {
                setQuery(text);
                setMatchIndex(0);
              }}
              placeholder="Find"
              placeholderTextColor={theme.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              className="h-9 min-w-0 flex-1 rounded-ui border border-border bg-input px-sp-2 font-mono text-sm text-foreground dark:border-border-dark dark:bg-input-dark dark:text-foreground-dark"
            />
            <Text className="font-mono text-xs text-muted-foreground dark:text-muted-foreground-dark">
              {matches.length === 0
                ? "0"
                : `${Math.min(matchIndex + 1, matches.length)}/${matches.length}`}
            </Text>
            <EditorToolButton label="↑" onPress={() => stepMatch(-1)} />
            <EditorToolButton label="↓" onPress={() => stepMatch(1)} />
          </View>
          {!readOnly ? (
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
              <EditorToolButton label="Replace" onPress={() => doReplace(false)} />
              <EditorToolButton label="All" onPress={() => doReplace(true)} />
            </View>
          ) : null}
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

      {/* Body: gutter + bidirectional scroll area */}
      <View className="min-h-0 flex-1 flex-row">
        <View
          style={{ width: gutterWidth }}
          className="border-r border-border bg-card dark:border-border-dark dark:bg-card-dark"
        >
          <Text
            className="text-right font-mono text-muted-foreground dark:text-muted-foreground-dark"
            style={{
              fontSize: FONT_SIZE,
              lineHeight: LINE_HEIGHT,
              paddingTop: PAD,
              paddingRight: 10,
              transform: [{ translateY: -scrollY }],
            }}
          >
            {Array.from({ length: lineCount }, (_, index) => index + 1).join(
              "\n",
            )}
          </Text>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator
          className="min-w-0 flex-1"
        >
          <ScrollView
            ref={vScrollRef}
            nestedScrollEnabled
            showsVerticalScrollIndicator
            className="min-h-full"
            scrollEventThrottle={16}
            onScroll={(event) => {
              setScrollY(event.nativeEvent.contentOffset.y);
            }}
          >
            <View style={{ minWidth: "100%", minHeight: "100%" }}>
              {/* Active line */}
              <View
                pointerEvents="none"
                className="absolute inset-x-0 bg-secondary dark:bg-secondary-dark"
                style={{
                  top: PAD + (caret.line - 1) * LINE_HEIGHT - scrollY,
                  height: LINE_HEIGHT,
                  opacity: 0.5,
                }}
              />
              <View
                style={{
                  padding: PAD,
                  paddingRight: PAD + 24,
                }}
              >
                {renderHighlighted()}
              </View>
              <TextInput
                ref={inputRef}
                value={value}
                onChangeText={(text) => {
                  undoRef.current = pushUndo(undoRef.current, value);
                  onChangeText(text);
                }}
                onSelectionChange={(event) => {
                  setSelection(event.nativeEvent.selection);
                }}
                multiline
                scrollEnabled={false}
                editable={!readOnly}
                autoFocus={autoFocus}
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                textAlignVertical="top"
                keyboardType="ascii-capable"
                className="absolute inset-0"
                style={{
                  fontFamily: "monospace",
                  fontSize: FONT_SIZE,
                  lineHeight: LINE_HEIGHT,
                  padding: PAD,
                  paddingRight: PAD + 24,
                  color: "transparent",
                }}
                cursorColor={theme.text}
                selectionColor={theme.textSecondary}
              />
            </View>
          </ScrollView>
        </ScrollView>
      </View>
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
