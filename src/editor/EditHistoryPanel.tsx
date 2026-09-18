/**
 * Edit History panel — a sheet that slides up over the bottom of the editor.
 * Backed by the real revision list: scrubber + play/prev/next +
 * `{current}/{total}` + relative time + avatar, compare toggle with a
 * dual-gutter diff, inline character spans, Cancel / Reset actions.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Switch, Text, View } from "react-native";
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Pause,
  Play,
} from "lucide-react-native";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { withAlpha } from "@/components/ui/chrome-spec";
import { diffLines, type CharSpan, type DiffRow } from "@/editor/editorDiff";
import { formatRelativeTime } from "@/editor/editorDiagnostics";
import type { EditorRevision } from "@/editor/editorRevisions";
import { useTheme } from "@/hooks/use-theme";

export type EditHistoryPanelProps = {
  open: boolean;
  path: string;
  revisions: EditorRevision[];
  liveText: string;
  onClose: () => void;
  onResetToRevision: (content: string) => void;
};

function HistoryBody({
  current,
  compare,
  rows,
  liveMode,
  addedTint,
  removedTint,
}: {
  current: EditorRevision | null;
  compare: boolean;
  rows: DiffRow[];
  liveMode: boolean;
  addedTint: string;
  removedTint: string;
}) {
  const theme = useTheme();
  return (
    <ScrollView style={{ maxHeight: 260 }} showsVerticalScrollIndicator={false}>
      {current && !compare ? (
        <View style={{ flexDirection: "row" }}>
          <View style={{ width: 44, alignItems: "center" }}>
            {current.content.split("\n").map((_, lineIdx) => (
              // line numbers are positional; the list never reorders
              <Text
                key={`rev-line-${lineIdx}`}
                style={{
                  color: theme.textSecondary,
                  fontSize: 11,
                  fontFamily: "monospace",
                  lineHeight: 18,
                  fontVariant: ["tabular-nums"],
                }}
              >
                {lineIdx + 1}
              </Text>
            ))}
          </View>
          <Text
            style={{
              flex: 1,
              color: theme.text,
              fontSize: 12,
              fontFamily: "monospace",
              lineHeight: 18,
              paddingLeft: 10,
              paddingRight: 12,
            }}
          >
            {current.content}
          </Text>
        </View>
      ) : null}
      {current && compare ? (
        <HistoryDiff
          rows={rows}
          liveMode={liveMode}
          addedTint={addedTint}
          removedTint={removedTint}
          addedBar={theme.success}
          removedBar={theme.destructive}
          inlineAdded={withAlpha(liveMode ? theme.accent : theme.success, 0.4)}
          inlineRemoved={withAlpha(theme.destructive, 0.4)}
          gutterText={theme.textSecondary}
          gutterBorder={theme.border}
          codeText={theme.text}
        />
      ) : null}
      {!current ? (
        <Text
          style={{
            color: theme.textSecondary,
            fontSize: 12,
            paddingHorizontal: 16,
            paddingVertical: 12,
          }}
        >
          No revisions yet — edit the file to create the first snapshot.
        </Text>
      ) : null}
    </ScrollView>
  );
}

function HistoryActions({
  compare,
  setCompare,
  disabled,
  onClose,
  onReset,
}: {
  compare: boolean;
  setCompare: (value: boolean) => void;
  disabled: boolean;
  onClose: () => void;
  onReset: () => void;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderTopWidth: 1,
        borderTopColor: theme.border,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Switch value={compare} onValueChange={setCompare} />
        <Text style={{ color: theme.text, fontSize: 13 }}>Compare</Text>
      </View>
      <View style={{ flex: 1 }} />
      <Button variant="ghost" size="sm" onPress={onClose}>
        Cancel
      </Button>
      <Button size="sm" disabled={disabled} onPress={onReset}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Clock size={16} color={theme.accentForeground} />
          <Text style={{ color: theme.accentForeground, fontSize: 13 }}>
            Reset editor to here
          </Text>
        </View>
      </Button>
    </View>
  );
}

export function EditHistoryPanel({
  open,
  path,
  revisions,
  liveText,
  onClose,
  onResetToRevision,
}: EditHistoryPanelProps): React.JSX.Element | null {
  const theme = useTheme();
  const total = revisions.length;
  const [index, setIndex] = useState(total - 1);
  const [compare, setCompare] = useState(false);
  const [playing, setPlaying] = useState(false);
  const playRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (open) {
      setIndex(Math.max(0, revisions.length - 1));
      setCompare(false);
      setPlaying(false);
    }
  }, [open, revisions.length, path]);

  useEffect(() => {
    if (!playing || total === 0) return;
    playRef.current = setInterval(() => {
      setIndex((current) => {
        if (current + 1 >= total) {
          setPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, 900);
    return () => {
      if (playRef.current) clearInterval(playRef.current);
      playRef.current = null;
    };
  }, [playing, total]);

  const current = total === 0 ? null : revisions[Math.min(index, total - 1)];
  const compareTarget = useMemo(() => {
    if (!current) return liveText;
    if (index + 1 < total) return revisions[index + 1].content;
    return liveText;
  }, [current, index, revisions, total, liveText]);
  const liveMode = compareTarget === liveText;
  const rows = useMemo(
    () => (current && compare ? diffLines(current.content, compareTarget) : []),
    [current, compare, compareTarget],
  );
  if (!open) return null;
  const glyph = 20;
  const icon = theme.textSecondary;
  const addedTint = withAlpha(theme.success, 0.16);
  const removedTint = withAlpha(theme.destructive, 0.14);
  const progress = total <= 1 ? 1 : Math.max(0, Math.min(1, index / (total - 1)));
  return (
    <View
      style={{
        borderTopWidth: 1,
        borderTopColor: theme.border,
        backgroundColor: theme.background,
        maxHeight: "62%",
      }}
    >
      <View style={{ paddingHorizontal: 16, paddingTop: 10 }}>
        <View
          style={{
            height: 4,
            borderRadius: 2,
            backgroundColor: withAlpha(icon, 0.25),
            overflow: "hidden",
          }}
        >
          <View
            style={{
              width: `${Math.round(progress * 100)}%`,
              height: 4,
              backgroundColor: theme.accent,
            }}
          />
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Pressable
            accessibilityLabel={playing ? "Pause playback" : "Play revisions"}
            accessibilityRole="button"
            onPress={() => {
              if (index >= total - 1) setIndex(0);
              setPlaying((p) => !p);
            }}
            hitSlop={8}
          >
            {playing ? (
              <Pause size={glyph} color={icon} />
            ) : (
              <Play size={glyph} color={icon} />
            )}
          </Pressable>
          <Pressable
            accessibilityLabel="Previous revision"
            accessibilityRole="button"
            onPress={() => setIndex((i) => Math.max(0, i - 1))}
            hitSlop={8}
          >
            <ChevronLeft size={glyph} color={icon} />
          </Pressable>
          <Text
            style={{
              color: icon,
              fontSize: 13,
              fontVariant: ["tabular-nums"],
              minWidth: 44,
              textAlign: "center",
            }}
          >
            {total === 0 ? "0 / 0" : `${index + 1} / ${total}`}
          </Text>
          <Pressable
            accessibilityLabel="Next revision"
            accessibilityRole="button"
            onPress={() => setIndex((i) => Math.min(total - 1, i + 1))}
            hitSlop={8}
          >
            <ChevronRight size={glyph} color={icon} />
          </Pressable>
          <View style={{ flex: 1 }} />
          <Text style={{ color: icon, fontSize: 12 }}>
            {current ? formatRelativeTime(current.createdAt) : ""}
          </Text>
          <Avatar size="sm">
            {current?.authorAvatarUri ? (
              <AvatarImage src={current.authorAvatarUri} />
            ) : null}
            <AvatarFallback>
              {initialsFor(current?.authorName ?? null)}
            </AvatarFallback>
          </Avatar>
        </View>
        <View
          style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 }}
        >
          <Text style={{ color: icon, fontSize: 12 }}>Compare</Text>
          <Switch value={compare} onValueChange={setCompare} />
        </View>
      </View>
      <HistoryBody
        current={current}
        compare={compare}
        rows={rows}
        liveMode={liveMode}
        addedTint={addedTint}
        removedTint={removedTint}
      />
      <HistoryActions
        compare={compare}
        setCompare={setCompare}
        disabled={!current}
        onClose={onClose}
        onReset={() => {
          if (current) onResetToRevision(current.content);
        }}
      />
    </View>
  );
}


function initialsFor(name: string | null): string {
  if (!name?.trim()) return "?";
  const parts = name.trim().split(/\s+/);
  return (parts[0][0] + (parts[parts.length - 1][0] ?? "")).toUpperCase();
}

function SpanText({
  text,
  span,
  baseColor,
  spanBackground,
}: {
  text: string;
  span: CharSpan | null;
  baseColor: string;
  spanBackground: string;
}) {
  if (!span || span.end <= span.start) {
    return <Text style={{ color: baseColor }}>{text || " "}</Text>;
  }
  return (
    <Text style={{ color: baseColor }}>
      {span.start > 0 ? text.slice(0, span.start) : null}
      <Text style={{ backgroundColor: spanBackground }}>
        {text.slice(span.start, Math.max(span.start, span.end)) || " "}
      </Text>
      {span.end < text.length ? text.slice(Math.max(span.start, span.end)) : null}
    </Text>
  );
}

function HistoryDiff({
  rows,
  liveMode,
  addedTint,
  removedTint,
  addedBar,
  removedBar,
  inlineAdded,
  inlineRemoved,
  gutterText,
  gutterBorder,
  codeText,
}: {
  rows: DiffRow[];
  liveMode: boolean;
  addedTint: string;
  removedTint: string;
  addedBar: string;
  removedBar: string;
  inlineAdded: string;
  inlineRemoved: string;
  gutterText: string;
  gutterBorder: string;
  codeText: string;
}) {
  return (
    <View>
      {rows.map((row, index) => {
        const tint =
          row.kind === "context"
            ? "transparent"
            : row.kind === "add"
              ? addedTint
              : removedTint;
        const bar =
          row.kind === "context"
            ? "transparent"
            : row.kind === "add"
              ? addedBar
              : removedBar;
        const leftLabel = row.kind === "add" ? "" : String(row.leftNo);
        const rightLabel = row.kind === "remove" ? "" : String(row.rightNo);
        return (
          <View
            key={`diff-${index}`}
            style={{ flexDirection: "row", backgroundColor: tint }}
          >
            <View style={{ width: 3, backgroundColor: bar }} />
            <View
              style={{
                width: 38,
                alignItems: "center",
                borderRightWidth: 1,
                borderRightColor: gutterBorder,
              }}
            >
              <Text
                style={{
                  color: gutterText,
                  fontSize: 11,
                  fontFamily: "monospace",
                  fontVariant: ["tabular-nums"],
                }}
              >
                {leftLabel}
              </Text>
            </View>
            <View
              style={{
                width: 38,
                alignItems: "center",
                borderRightWidth: 1,
                borderRightColor: gutterBorder,
              }}
            >
              <Text
                style={{
                  color: gutterText,
                  fontSize: 11,
                  fontFamily: "monospace",
                  fontVariant: ["tabular-nums"],
                }}
              >
                {rightLabel}
              </Text>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ flex: 1 }}
              contentContainerStyle={{ paddingLeft: 10, paddingRight: 12 }}
            >
              {row.kind === "context" ? (
                <Text
                  style={{ color: codeText, fontSize: 12, fontFamily: "monospace" }}
                >
                  {row.text || " "}
                </Text>
              ) : row.kind === "add" ? (
                <SpanText
                  text={row.text}
                  span={{ start: 0, end: row.text.length }}
                  baseColor={codeText}
                  spanBackground={liveMode ? inlineAdded : addedTint}
                />
              ) : row.kind === "remove" ? (
                <SpanText
                  text={row.text}
                  span={{ start: 0, end: row.text.length }}
                  baseColor={codeText}
                  spanBackground={inlineRemoved}
                />
              ) : (
                <View style={{ gap: 2 }}>
                  <SpanText
                    text={row.leftText}
                    span={row.leftSpan}
                    baseColor={codeText}
                    spanBackground={inlineRemoved}
                  />
                  <SpanText
                    text={row.rightText}
                    span={row.rightSpan}
                    baseColor={codeText}
                    spanBackground={liveMode ? inlineAdded : addedTint}
                  />
                </View>
              )}
            </ScrollView>
          </View>
        );
      })}
    </View>
  );
}
