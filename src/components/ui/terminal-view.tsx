/**
 * Self-contained terminal view: React Native + TypeScript only.
 *
 * Renders whole lines as <Text> (runs grouped, never one component per
 * cell), batches output via session version ticks, and keeps an auto-scroll
 * retention threshold. Input goes through the session (history, echo,
 * control encoding); hardware keyboards and IME work via TextInput.
 */
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import type { TerminalSession } from "@/modules/terminal/session";
import { resolveTerminalTheme } from "@/modules/terminal/themes";
import type {
  TerminalLineRun,
  TerminalViewProps,
  TerminalViewRef,
} from "@/modules/terminal/types";

export type EmbeddedTerminalProps = TerminalViewProps & {
  session: TerminalSession;
  themeMode?: "dark" | "light" | "system";
  systemDark?: boolean;
  showInput?: boolean;
  onTitleChange?: (title: string) => void;
  /** Case-insensitive highlight query over scrollback + viewport. */
  searchQuery?: string;
  /** Zero-based index of the current match (cycles with next/prev). */
  currentMatchIndex?: number;
};

const AUTO_SCROLL_RETENTION_PX = 96;
const CURSOR_GLYPH = "▊";

type FlatCell = { text: string; run: TerminalLineRun };

function flattenRuns(runs: TerminalLineRun[]): FlatCell[] {
  const cells: FlatCell[] = [];
  for (const run of runs) {
    for (const char of run.text) {
      cells.push({ text: char, run });
    }
  }
  return cells;
}

function runStyle(
  run: TerminalLineRun,
  foreground: string,
  background: string,
): Record<string, string | number> {
  const fg = run.inverse ? (run.background ?? background) : (run.foreground ?? foreground);
  const bg = run.inverse ? (run.foreground ?? foreground) : (run.background ?? background);
  const style: Record<string, string | number> = { color: fg };
  if (bg !== background) style.backgroundColor = bg;
  if (run.bold) style.fontWeight = "bold";
  if (run.dim) style.opacity = 0.6;
  if (run.italic) style.fontStyle = "italic";
  const decorations: string[] = [];
  if (run.underline) decorations.push("underline");
  if (run.strikethrough) decorations.push("line-through");
  if (decorations.length > 0) style.textDecorationLine = decorations.join(" ");
  return style;
}

export const TerminalView = forwardRef<TerminalViewRef, EmbeddedTerminalProps>(
  function TerminalView(
    {
      session,
      style,
      fontSize,
      fontFamily,
      backgroundColor,
      foregroundColor,
      themeMode = "dark",
      systemDark = true,
      showInput = true,
      onTitleChange,
      searchQuery = "",
      currentMatchIndex = -1,
    },
    ref,
  ) {
    const theme = resolveTerminalTheme(themeMode, systemDark);
    const bg = backgroundColor ?? theme.background;
    const fg = foregroundColor ?? theme.foreground;
    const [, setTick] = useState(0);
    const [input, setInput] = useState("");
    const scrollRef = useRef<ScrollView>(null);
    const nearBottomRef = useRef(true);
    const contentHeightRef = useRef(0);
    const viewportHeightRef = useRef(0);
    const titleCbRef = useRef(onTitleChange);
    titleCbRef.current = onTitleChange;

    useEffect(() => {
      session.setPalette(theme.palette);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [session, themeMode, systemDark]);

    useEffect(() => {
      const unsubscribe = session.onEvent((event) => {
        if (event.type === "title") titleCbRef.current?.(event.title);
        setTick((tick) => tick + 1);
      });
      return unsubscribe;
    }, [session]);

    useImperativeHandle(
      ref,
      () => ({
        write: (data: string) => {
          session.pushOutput(data);
        },
        resize: (columns: number, rows: number) => {
          session.resize(columns, rows);
        },
        clear: () => {
          session.clear();
        },
        scrollToLine: (lineIndex: number, totalLines: number) => {
          const contentHeight = contentHeightRef.current;
          if (contentHeight <= 0 || totalLines <= 0) return;
          const clamped = Math.min(Math.max(0, lineIndex), totalLines - 1);
          const estimatedY =
            ((clamped + 0.5) / totalLines) * contentHeight -
            viewportHeightRef.current / 2;
          scrollRef.current?.scrollTo({
            y: Math.max(0, estimatedY),
            animated: true,
          });
          nearBottomRef.current = false;
        },
      }),
      [session],
    );

    const snapshot = session.snapshot();
    const font = { fontFamily: fontFamily ?? "monospace", fontSize };

    // Keep terminal geometry synchronized with the rendered viewport.
    const handleLayout = (width: number, height: number) => {
      if (width <= 0 || height <= 0) return;
      const columns = Math.max(20, Math.floor(width / (fontSize * 0.6)));
      const rows = Math.max(
        8,
        Math.floor((height - 64) / (fontSize * 1.35)),
      );
      if (columns !== session.columns || rows !== session.rows) {
        session.resize(columns, rows);
      }
    };

    const submitInput = () => {
      const line = input;
      setInput("");
      session.submitLine(line).catch(() => {});
    };

    const renderRun = (
      run: TerminalLineRun,
      key: string,
      extra?: Record<string, string | number>,
    ) => (
      <Text key={key} style={[font, runStyle(run, fg, bg), extra]}>
        {run.text}
      </Text>
    );

    // Split runs on the search query so matches highlight. Match order
    // follows render order (scrollback first), matching the counter.
    let searchOrdinal = 0;
    const renderRunsWithSearch = (runs: TerminalLineRun[], keyPrefix: string) => {
      const query = searchQuery.trim().toLowerCase();
      if (!query) {
        return runs.map((run, i) => renderRun(run, `${keyPrefix}-${i}`));
      }
      const parts: React.ReactNode[] = [];
      runs.forEach((run, i) => {
        const lower = run.text.toLowerCase();
        let from = 0;
        let piece = 0;
        let matched = false;
        while (from <= lower.length - query.length) {
          const found = lower.indexOf(query, from);
          if (found < 0) break;
          matched = true;
          if (found > from) {
            parts.push(
              <Text
                key={`${keyPrefix}-${i}-${piece++}`}
                style={[font, runStyle(run, fg, bg)]}
              >
                {run.text.slice(from, found)}
              </Text>,
            );
          }
          const ordinal = searchOrdinal++;
          parts.push(
            <Text
              key={`${keyPrefix}-${i}-${piece++}`}
              style={[
                font,
                runStyle(run, fg, bg),
                {
                  backgroundColor:
                    ordinal === currentMatchIndex ? theme.cursor : theme.selection,
                  color: bg,
                },
              ]}
            >
              {run.text.slice(found, found + query.length)}
            </Text>,
          );
          from = found + Math.max(1, query.length);
        }
        if (!matched || from < run.text.length) {
          parts.push(
            <Text
              key={`${keyPrefix}-${i}-${piece++}`}
              style={[font, runStyle(run, fg, bg)]}
            >
              {run.text.slice(from)}
            </Text>,
          );
        }
      });
      return parts;
    };

    const renderViewportLine = (runs: TerminalLineRun[], y: number) => {
      const isCursorLine =
        y === snapshot.cursorY && snapshot.cursorVisible;
      if (!isCursorLine) {
        return (
          <Text key={`v-${y}`} style={font}>
            {renderRunsWithSearch(runs, `v-${y}`)}
          </Text>
        );
      }
      // Cursor line: flatten to cells so the block lands on the cursor cell.
      const cells = flattenRuns(runs);
      const parts: React.ReactNode[] = [];
      let key = 0;
      const pushRun = (text: string, run: TerminalLineRun, extra?: Record<string, string | number>) => {
        if (!text) return;
        parts.push(
          <Text key={`c-${y}-${key++}`} style={[font, runStyle(run, fg, bg), extra]}>
            {text}
          </Text>,
        );
      };
      let runText = "";
      let runRef: TerminalLineRun | null = null;
      const flush = () => {
        if (runRef) pushRun(runText, runRef);
        runText = "";
        runRef = null;
      };
      cells.forEach((cell, index) => {
        if (index === snapshot.cursorX) {
          flush();
          pushRun(cell.text === " " ? CURSOR_GLYPH : cell.text, cell.run, {
            backgroundColor: theme.cursor,
            color: bg,
          });
          return;
        }
        if (!runRef) {
          runRef = cell.run;
          runText = cell.text;
        } else if (
          runRef.foreground === cell.run.foreground &&
          runRef.background === cell.run.background &&
          runRef.bold === cell.run.bold &&
          runRef.italic === cell.run.italic &&
          runRef.underline === cell.run.underline
        ) {
          runText += cell.text;
        } else {
          flush();
          runRef = cell.run;
          runText = cell.text;
        }
      });
      if (snapshot.cursorX >= cells.length) {
        flush();
        pushRun(CURSOR_GLYPH, {
          text: "",
          foreground: null,
          background: null,
          bold: false,
          dim: false,
          italic: false,
          underline: false,
          inverse: false,
          strikethrough: false,
        }, { backgroundColor: theme.cursor, color: bg });
      } else {
        flush();
      }
      return (
        <Text key={`v-${y}`} style={font}>
          {parts}
        </Text>
      );
    };

    return (
      <View
        style={[{ flex: 1, backgroundColor: bg }, style]}
        onLayout={(e) => {
          handleLayout(
            e.nativeEvent.layout.width,
            e.nativeEvent.layout.height,
          );
        }}
      >
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 8 }}
          showsVerticalScrollIndicator={false}
          scrollEventThrottle={64}
          onLayout={(e) => {
            viewportHeightRef.current = e.nativeEvent.layout.height;
          }}
          onScroll={(e) => {
            const { contentSize, contentOffset, layoutMeasurement } =
              e.nativeEvent;
            viewportHeightRef.current = layoutMeasurement.height;
            nearBottomRef.current =
              contentSize.height -
                (contentOffset.y + layoutMeasurement.height) <=
              AUTO_SCROLL_RETENTION_PX;
          }}
          onContentSizeChange={(_width, height) => {
            contentHeightRef.current = height;
            if (nearBottomRef.current) {
              scrollRef.current?.scrollToEnd({ animated: false });
            }
          }}
        >
          {snapshot.scrollback.map((line, i) => (
            <Text key={`s-${i}`} style={font} selectable>
              {renderRunsWithSearch(line.runs, `s-${i}`)}
            </Text>
          ))}
          {snapshot.lines.map((runs, y) => renderViewportLine(runs, y))}
        </ScrollView>
        {showInput ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, padding: 8 }}>
            <Text style={[font, { color: fg }]}>$</Text>
            <TextInput
              style={[{ flex: 1, color: fg }, font]}
              value={input}
              onChangeText={setInput}
              onSubmitEditing={submitInput}
              autoCapitalize="none"
              autoCorrect={false}
              placeholderTextColor="#666666"
              returnKeyType="go"
              blurOnSubmit={false}
            />
            <Pressable
              accessibilityLabel="Send Ctrl+C"
              accessibilityRole="button"
              onPress={() => {
                session.sendControl("ctrl-c").catch(() => {});
              }}
              style={{ padding: 8 }}
            >
              <Text style={[font, { color: fg }]}>^C</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="Send Escape"
              accessibilityRole="button"
              onPress={() => {
                session.sendControl("escape").catch(() => {});
              }}
              style={{ padding: 8 }}
            >
              <Text style={[font, { color: fg }]}>ESC</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    );
  },
);
