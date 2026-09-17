/**
 * Touch-friendly intel panels (§41, §51): symbol outline, references,
 * rename with preview, code actions, refactoring picker, command palette,
 * intel settings, breadcrumbs, and the entry menu.
 *
 * Built on the app's Modal system + theme — no desktop UI copies, no
 * popups that can't scroll or dismiss. Every panel degrades to an honest
 * empty/error state; AI and terminal entries only appear when a real
 * handler exists (never placeholder buttons, §56).
 */
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Modal, ModalContent } from "@/components/ui/modal";
import { useTheme } from "@/hooks/use-theme";
import { searchIntelCommands, type IntelCommand } from "@/modules/intel/commands";
import { containingSymbolPath, groupReferences } from "@/modules/intel/navigation";
import type { IntelDocumentSymbol } from "@/modules/intel/types";
import type { IntelBridgeRange } from "@/editor/editorTypes";
import type { IntelBridge } from "@/editor/useIntelBridge";

function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal open={open} onOpenChange={(next) => !next && onClose()}>
      <ModalContent presentation="bottom" scrollable showCloseButton={false}>
        <View style={{ paddingBottom: insets.bottom }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 8,
            }}
          >
            <Text style={{ color: theme.text, fontSize: 17, fontWeight: "600" }}>{title}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Close ${title}`}
              onPress={onClose}
              hitSlop={12}
              style={{ padding: 6 }}
            >
              <Text style={{ color: theme.textSecondary, fontSize: 16 }}>✕</Text>
            </Pressable>
          </View>
          {children}
        </View>
      </ModalContent>
    </Modal>
  );
}

function StatusLine({ text }: { text: string }) {
  const theme = useTheme();
  return (
    <Text style={{ color: theme.textSecondary, fontSize: 13, paddingVertical: 12, textAlign: "center" }}>
      {text}
    </Text>
  );
}

function ThemedRefreshLabel() {
  const theme = useTheme();
  return <Text style={{ color: theme.accent, fontSize: 13 }}>↻ Refresh</Text>;
}

function MenuRow({
  label,
  hint,
  onPress,
}: {
  label: string;
  hint?: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        paddingVertical: 13,
        paddingHorizontal: 4,
        borderBottomWidth: 1,
        borderBottomColor: theme.border,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Text style={{ color: theme.text, fontSize: 15 }}>{label}</Text>
      {hint ? (
        <Text style={{ color: theme.textSecondary, fontSize: 12, marginTop: 2 }}>{hint}</Text>
      ) : null}
    </Pressable>
  );
}

export function BreadcrumbBar({
  path,
  intel,
  caretLine,
  onNavigate,
}: {
  path: string;
  intel: IntelBridge;
  caretLine: number;
  onNavigate: (line: number, column: number) => void;
}) {
  const theme = useTheme();
  const [chain, setChain] = useState<IntelDocumentSymbol[]>([]);
  useEffect(() => {
    if (!intel.intelActive) {
      setChain([]);
      return;
    }
    let cancelled = false;
    const timeout = setTimeout(() => {
      void intel
        .getOutline()
        .then((symbols) => {
          if (!cancelled) setChain(containingSymbolPath(symbols, caretLine));
        })
        .catch(() => {});
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [intel, caretLine]);

  const segments = path.split("/").filter(Boolean);
  const crumbs: { label: string; onPress?: () => void }[] = [
    ...segments.slice(0, -1).map((segment) => ({ label: segment })),
    { label: segments[segments.length - 1] ?? path },
    ...chain.map((symbol) => ({
      label: symbol.name,
      onPress: () => onNavigate(symbol.selectionRange.start.line, symbol.selectionRange.start.column),
    })),
  ];
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ alignItems: "center", paddingHorizontal: 8, gap: 4 }}
      style={{ maxHeight: 32 }}
    >
      {crumbs.map((crumb, index) => (
        <View key={`${crumb.label}-${index}`} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          {index > 0 ? (
            <Text style={{ color: theme.textSecondary, fontSize: 12 }}>›</Text>
          ) : null}
          <Pressable disabled={!crumb.onPress} onPress={crumb.onPress} hitSlop={8}>
            <Text
              style={{
                color: crumb.onPress ? theme.accent : theme.textSecondary,
                fontSize: 12,
                fontWeight: crumb.onPress ? "600" : "400",
              }}
            >
              {crumb.label}
            </Text>
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
}

function flattenOutline(
  symbols: IntelDocumentSymbol[],
  depth = 0,
): { symbol: IntelDocumentSymbol; depth: number }[] {
  const out: { symbol: IntelDocumentSymbol; depth: number }[] = [];
  for (const symbol of symbols) {
    out.push({ symbol, depth });
    out.push(...flattenOutline(symbol.children, depth + 1));
  }
  return out;
}

export function SymbolOutlinePanel({
  open,
  onClose,
  intel,
  onNavigate,
}: {
  open: boolean;
  onClose: () => void;
  intel: IntelBridge;
  onNavigate: (line: number, column: number) => void;
}) {
  const theme = useTheme();
  const [symbols, setSymbols] = useState<IntelDocumentSymbol[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  useEffect(() => {
    if (!open) return;
    setSymbols(null);
    setError(null);
    void intel
      .getOutline()
      .then(setSymbols)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [open, intel]);
  const rows = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return flattenOutline(symbols ?? []).filter(
      ({ symbol }) => !needle || symbol.name.toLowerCase().includes(needle),
    );
  }, [symbols, filter]);
  return (
    <Sheet open={open} onClose={onClose} title="Outline">
      <TextInput
        value={filter}
        onChangeText={setFilter}
        placeholder="Filter symbols"
        placeholderTextColor={theme.textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
        style={{
          borderWidth: 1,
          borderColor: theme.border,
          borderRadius: 10,
          paddingHorizontal: 12,
          paddingVertical: 9,
          color: theme.text,
          fontSize: 14,
          marginBottom: 4,
        }}
      />
      {symbols === null && !error ? (
        <ActivityIndicator style={{ marginVertical: 20 }} />
      ) : error ? (
        <StatusLine text={error} />
      ) : rows.length === 0 ? (
        <StatusLine text="No symbols found." />
      ) : (
        rows.map(({ symbol, depth }, index) => (
          <Pressable
            key={`${symbol.name}-${index}`}
            accessibilityRole="button"
            onPress={() => {
              onNavigate(symbol.selectionRange.start.line, symbol.selectionRange.start.column);
              onClose();
            }}
            style={({ pressed }) => ({
              paddingVertical: 11,
              paddingLeft: 4 + depth * 16,
              borderBottomWidth: 1,
              borderBottomColor: theme.border,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Text style={{ color: theme.textSecondary, fontSize: 11 }}>{symbol.kind}</Text>
            <Text style={{ color: theme.text, fontSize: 15, fontFamily: "monospace" }}>
              {symbol.name}
            </Text>
          </Pressable>
        ))
      )}
    </Sheet>
  );
}

export function ReferencesPanel({
  open,
  onClose,
  intel,
  fileText,
  onNavigateFile,
}: {
  open: boolean;
  onClose: () => void;
  intel: IntelBridge;
  fileText: (uri: string) => string | null;
  onNavigateFile: (uri: string, line: number, column: number) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [groups, setGroups] = useState<
    { uri: string; fileName: string; references: { line: number; column: number; preview: string; isWrite: boolean; isDefinition: boolean }[] }[]
  >([]);
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    void intel
      .getReferences()
      .then((locations) =>
        setGroups(
          groupReferences(locations, (uri, line) => {
            const text = fileText(uri);
            return text?.split("\n")[line - 1] ?? null;
          }),
        ),
      )
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [open, intel, fileText, nonce]);
  const total = groups.reduce((count, group) => count + group.references.length, 0);
  return (
    <Sheet open={open} onClose={onClose} title={`References (${total})`}>
      {!loading && !error && groups.length > 0 ? (
        <View style={{ alignItems: "flex-end", marginBottom: 2 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Refresh references"
            hitSlop={10}
            onPress={() => setNonce((value) => value + 1)}
          >
            <ThemedRefreshLabel />
          </Pressable>
        </View>
      ) : null}
      {loading ? (
        <ActivityIndicator style={{ marginVertical: 20 }} />
      ) : error ? (
        <StatusLine text={error} />
      ) : groups.length === 0 ? (
        <StatusLine text="No references found." />
      ) : (
        groups.map((group) => (
          <ReferencesGroup key={group.uri} group={group} onNavigateFile={onNavigateFile} onClose={onClose} />
        ))
      )}
    </Sheet>
  );
}

function ReferencesGroup({
  group,
  onNavigateFile,
  onClose,
}: {
  group: {
    uri: string;
    fileName: string;
    references: { line: number; column: number; preview: string; isWrite: boolean; isDefinition: boolean }[];
  };
  onNavigateFile: (uri: string, line: number, column: number) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={{ marginBottom: 8 }}>
      <Text style={{ color: theme.textSecondary, fontSize: 12, fontWeight: "600", marginBottom: 2 }}>
        {group.fileName} · {group.references.length}
      </Text>
      {group.references.map((reference, index) => (
        <Pressable
          key={`${reference.line}:${reference.column}:${index}`}
          accessibilityRole="button"
          onPress={() => {
            onNavigateFile(group.uri, reference.line, reference.column);
            onClose();
          }}
          style={({ pressed }) => ({
            paddingVertical: 9,
            paddingHorizontal: 4,
            borderBottomWidth: 1,
            borderBottomColor: theme.border,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Text style={{ color: theme.textSecondary, fontSize: 11 }}>
            {reference.line}:{reference.column}
            {reference.isDefinition ? " · definition" : ""}
            {reference.isWrite ? " · write" : ""}
          </Text>
          <Text numberOfLines={1} style={{ color: theme.text, fontSize: 13, fontFamily: "monospace" }}>
            {reference.preview || "(no preview)"}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export function RenameDialog({
  open,
  onClose,
  intel,
  caret,
  onApplied,
}: {
  open: boolean;
  onClose: () => void;
  intel: IntelBridge;
  caret: { line: number; column: number };
  onApplied: (summary: string) => void;
}) {
  const theme = useTheme();
  const [placeholder, setPlaceholder] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [preview, setPreview] = useState<{ summary: string; files: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setPlaceholder(null);
    setName("");
    setPreview(null);
    setError(null);
    void intel
      .prepareRename()
      .then((result) => {
        if (!result) {
          setError("No renameable symbol at the cursor.");
          return;
        }
        setPlaceholder(result.placeholder);
        setName(result.placeholder);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [open, intel]);
  const valid = /^[A-Za-z_$][\w$]*$/.test(name);
  return (
    <Sheet open={open} onClose={onClose} title="Rename symbol">
      {placeholder === null && !error ? (
        <ActivityIndicator style={{ marginVertical: 16 }} />
      ) : error ? (
        <StatusLine text={error} />
      ) : (
        <View style={{ gap: 10 }}>
          <TextInput
            value={name}
            onChangeText={(text) => {
              setName(text);
              setPreview(null);
            }}
            autoCapitalize="none"
            autoCorrect={false}
            style={{
              borderWidth: 1,
              borderColor: valid ? theme.border : theme.destructive,
              borderRadius: 10,
              paddingHorizontal: 12,
              paddingVertical: 10,
              color: theme.text,
              fontSize: 15,
              fontFamily: "monospace",
            }}
          />
          {!valid ? (
            <Text style={{ color: theme.destructive, fontSize: 12 }}>Not a valid identifier.</Text>
          ) : null}
          {preview ? (
            <View style={{ gap: 2 }}>
              <Text style={{ color: theme.text, fontSize: 13, fontWeight: "600" }}>
                {preview.summary}
              </Text>
              {preview.files.map((file) => (
                <Text key={file} style={{ color: theme.textSecondary, fontSize: 12 }} numberOfLines={1}>
                  · {file.split("/").pop() ?? file}
                </Text>
              ))}
            </View>
          ) : null}
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable
              accessibilityRole="button"
              disabled={!valid || busy}
              onPress={() => {
                setBusy(true);
                void intel
                  .query<{ edits: { uri: string }[]; summary: string }>("rename-apply", {
                    line: caret.line,
                    column: caret.column,
                    newName: name,
                  })
                  .then((result) =>
                    setPreview({
                      summary: result.summary,
                      files: [...new Set(result.edits.map((edit) => edit.uri))].sort(),
                    }),
                  )
                  .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
                  .finally(() => setBusy(false));
              }}
              style={{ flex: 1, padding: 12, borderRadius: 10, backgroundColor: theme.backgroundSelected, opacity: !valid || busy ? 0.5 : 1 }}
            >
              <Text style={{ color: theme.text, textAlign: "center", fontWeight: "600" }}>
                {busy ? "…" : "Preview"}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={!valid || busy}
              onPress={() => {
                setBusy(true);
                void intel
                  .applyRename(caret.line, caret.column, name)
                  .then((summary) => {
                    if (summary) {
                      onApplied(summary);
                      onClose();
                    } else {
                      setError("Rename produced no edits.");
                    }
                  })
                  .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
                  .finally(() => setBusy(false));
              }}
              style={{ flex: 1, padding: 12, borderRadius: 10, backgroundColor: theme.accent, opacity: !valid || busy ? 0.5 : 1 }}
            >
              <Text style={{ color: "#FFFFFF", textAlign: "center", fontWeight: "600" }}>
                {busy ? "…" : "Apply"}
              </Text>
            </Pressable>
          </View>
        </View>
      )}
    </Sheet>
  );
}

function lineRange(caret: { line: number; column: number }): {
  start: { line: number; column: number };
  end: { line: number; column: number };
} {
  return { start: { line: caret.line, column: 1 }, end: { line: caret.line, column: 1 } };
}

export function CodeActionsSheet({
  open,
  onClose,
  intel,
  caret,
  onApplied,
}: {
  open: boolean;
  onClose: () => void;
  intel: IntelBridge;
  caret: { line: number; column: number };
  onApplied: (summary: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actions, setActions] = useState<
    {
      title: string;
      kind: string;
      actionId: string | null;
      edit: {
        edits: { uri: string; range: IntelBridgeRange; newText: string }[];
        summary: string;
      } | null;
    }[]
  >([]);
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    void intel
      .getCodeActions(lineRange(caret))
      .then(setActions)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [open, intel, caret]);
  return (
    <Sheet open={open} onClose={onClose} title="Code actions">
      {loading ? (
        <ActivityIndicator style={{ marginVertical: 20 }} />
      ) : error ? (
        <StatusLine text={error} />
      ) : actions.length === 0 ? (
        <StatusLine text="No actions available here." />
      ) : (
        actions.map((action, index) => (
          <ActionRow
            key={`${action.title}-${index}`}
            title={action.title}
            hint={action.kind}
            onPress={() => {
              if (!action.edit) {
                setError("This action needs a second step, which is not supported here.");
                return;
              }
              intel.applyEdits(action.edit.edits);
              onApplied(action.edit.summary);
              onClose();
            }}
          />
        ))
      )}
    </Sheet>
  );
}

function ActionRow({ title, hint, onPress }: { title: string; hint?: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: theme.border,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Text style={{ color: theme.text, fontSize: 15 }}>{title}</Text>
      {hint ? <Text style={{ color: theme.textSecondary, fontSize: 12 }}>{hint}</Text> : null}
    </Pressable>
  );
}

export function RefactorSheet({
  open,
  onClose,
  intel,
  caret,
  onApplied,
}: {
  open: boolean;
  onClose: () => void;
  intel: IntelBridge;
  caret: { line: number; column: number };
  onApplied: (summary: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refactors, setRefactors] = useState<
    { name: string; description: string; actions: { name: string; description: string }[] }[]
  >([]);
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    void intel
      .getRefactors(lineRange(caret))
      .then(setRefactors)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [open, intel, caret]);
  return (
    <Sheet open={open} onClose={onClose} title="Refactor">
      {loading ? (
        <ActivityIndicator style={{ marginVertical: 20 }} />
      ) : error ? (
        <StatusLine text={error} />
      ) : refactors.length === 0 ? (
        <StatusLine text="No refactorings available here." />
      ) : (
        refactors.flatMap((refactor) =>
          refactor.actions.map((action) => (
            <ActionRow
              key={`${refactor.name}:${action.name}`}
              title={action.description}
              hint={refactor.description}
              onPress={() => {
                void intel
                  .applyRefactor(lineRange(caret), refactor.name, action.name)
                  .then((summary) => {
                    if (summary) {
                      onApplied(summary);
                      onClose();
                    } else {
                      setError("Refactoring produced no edits.");
                    }
                  })
                  .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
              }}
            />
          )),
        )
      )}
    </Sheet>
  );
}

export function WorkspaceSymbolsPanel({
  open,
  onClose,
  intel,
  onNavigateFile,
}: {
  open: boolean;
  onClose: () => void;
  intel: IntelBridge;
  onNavigateFile: (uri: string, line: number, column: number) => void;
}) {
  const theme = useTheme();
  const [queryText, setQueryText] = useState("");
  const [debounced, setDebounced] = useState("");
  const [results, setResults] = useState<
    { name: string; kind: string; uri: string; range: IntelBridgeRange }[] | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const timeout = setTimeout(() => setDebounced(queryText.trim()), 300);
    return () => clearTimeout(timeout);
  }, [queryText]);
  useEffect(() => {
    if (!open) return;
    if (!debounced) {
      setResults(null);
      return;
    }
    setError(null);
    void intel
      .query<{ name: string; kind: string; uri: string; range: IntelBridgeRange }[]>("symbols", {
        query: debounced,
      })
      .then(setResults)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [open, debounced, intel]);
  return (
    <Sheet open={open} onClose={onClose} title="Workspace symbols">
      <TextInput
        value={queryText}
        onChangeText={setQueryText}
        placeholder="Search all project symbols"
        placeholderTextColor={theme.textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus
        style={{
          borderWidth: 1,
          borderColor: theme.border,
          borderRadius: 10,
          paddingHorizontal: 12,
          paddingVertical: 9,
          color: theme.text,
          fontSize: 14,
          marginBottom: 4,
        }}
      />
      {error ? (
        <StatusLine text={error} />
      ) : results === null ? (
        <StatusLine text={debounced ? "Searching…" : "Type to search every indexed project file."} />
      ) : results.length === 0 ? (
        <StatusLine text="No symbols match." />
      ) : (
        results.slice(0, 60).map((symbol, index) => (
          <Pressable
            key={`${symbol.uri}:${symbol.name}:${index}`}
            accessibilityRole="button"
            onPress={() => {
              onNavigateFile(symbol.uri, symbol.range.start.line, symbol.range.start.column);
              onClose();
            }}
            style={({ pressed }) => ({
              paddingVertical: 10,
              borderBottomWidth: 1,
              borderBottomColor: theme.border,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Text style={{ color: theme.textSecondary, fontSize: 11 }}>
              {symbol.kind} · {(symbol.uri.split("/").pop() ?? symbol.uri)}
            </Text>
            <Text style={{ color: theme.text, fontSize: 15, fontFamily: "monospace" }}>
              {symbol.name}
            </Text>
          </Pressable>
        ))
      )}
    </Sheet>
  );
}

export function CommandPalette({
  open,
  onClose,
  commands,
  onRun,
}: {
  open: boolean;
  onClose: () => void;
  commands: IntelCommand[];
  onRun: (id: string) => void;
}) {
  const theme = useTheme();
  const [filter, setFilter] = useState("");
  useEffect(() => {
    if (open) setFilter("");
  }, [open]);
  const results = searchIntelCommands(filter).filter((command) =>
    commands.some((enabled) => enabled.id === command.id),
  );
  return (
    <Sheet open={open} onClose={onClose} title="Commands">
      <TextInput
        value={filter}
        onChangeText={setFilter}
        placeholder="Type a command"
        placeholderTextColor={theme.textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus
        style={{
          borderWidth: 1,
          borderColor: theme.border,
          borderRadius: 10,
          paddingHorizontal: 12,
          paddingVertical: 9,
          color: theme.text,
          fontSize: 14,
          marginBottom: 4,
        }}
      />
      {results.length === 0 ? (
        <StatusLine text="No matching commands." />
      ) : (
        results.map((command) => (
          <ActionRow
            key={command.id}
            title={command.title}
            hint={command.group}
            onPress={() => {
              onClose();
              onRun(command.id);
            }}
          />
        ))
      )}
    </Sheet>
  );
}

type BooleanIntelKey = {
  [K in keyof import("@/modules/intel/settings").IntelSettings]: import("@/modules/intel/settings").IntelSettings[K] extends boolean
    ? K
    : never;
}[keyof import("@/modules/intel/settings").IntelSettings];

const SETTING_ROWS: { key: BooleanIntelKey; label: string; hint?: string }[] = [
  { key: "semanticCompletionEnabled", label: "Semantic completion", hint: "Type-aware suggestions from the language engine" },
  { key: "parameterHintsEnabled", label: "Parameter hints", hint: "Signature help while typing calls" },
  { key: "hoverEnabled", label: "Hover information", hint: "Long-press to inspect types" },
  { key: "inlayHintsEnabled", label: "Inlay hints", hint: "Inferred types inline (capped for mobile)" },
  { key: "semanticHighlightingEnabled", label: "Semantic highlighting", hint: "Type-aware token colors" },
  { key: "diagnosticsEnabled", label: "Diagnostics", hint: "Errors, warnings, hints" },
  { key: "quickFixesEnabled", label: "Quick fixes", hint: "Offer fixes for diagnostics" },
  { key: "formatOnSave", label: "Format on save", hint: "Format supported files before saving" },
  { key: "autoImportEnabled", label: "Auto-import", hint: "Suggest and apply missing imports" },
  { key: "codeActionsEnabled", label: "Code actions", hint: "Refactor and fix actions" },
  { key: "snippetCompletionEnabled", label: "Snippets", hint: "Snippet completions" },
  { key: "emmetCompletionEnabled", label: "Emmet", hint: "Emmet abbreviations (HTML family)" },
  { key: "inlineCompletionEnabled", label: "Inline ghost text", hint: "Tap to accept, Tab accepts" },
  { key: "aiCompletionEnabled", label: "AI completion", hint: "Requires a configured AI provider" },
  { key: "wordWrap", label: "Word wrap" },
  { key: "bracketMatching", label: "Bracket matching" },
  { key: "codeFolding", label: "Code folding" },
];

export function IntelSettingsSheet({
  open,
  onClose,
  intel,
}: {
  open: boolean;
  onClose: () => void;
  intel: IntelBridge;
}) {
  const theme = useTheme();
  const [perfOpen, setPerfOpen] = useState(false);
  const perf = perfOpen ? intel.getPerfSnapshot() : null;
  return (
    <Sheet open={open} onClose={onClose} title="Intel settings">
      {SETTING_ROWS.map((row) => (
        <View
          key={row.key}
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingVertical: 10,
            borderBottomWidth: 1,
            borderBottomColor: theme.border,
            gap: 12,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.text, fontSize: 15 }}>{row.label}</Text>
            {row.hint ? (
              <Text style={{ color: theme.textSecondary, fontSize: 12 }}>{row.hint}</Text>
            ) : null}
          </View>
          <Switch
            value={intel.settings[row.key]}
            onValueChange={(next) =>
              intel.updateSettings({ [row.key]: next } as Partial<typeof intel.settings>)
            }
          />
        </View>
      ))}
      <Pressable
        accessibilityRole="button"
        onPress={() => setPerfOpen((value) => !value)}
        style={{ paddingVertical: 10 }}
      >
        <Text style={{ color: theme.accent, fontSize: 13 }}>
          {perfOpen ? "▾ Hide performance" : "▸ Performance (local instrumentation)"}
        </Text>
      </Pressable>
      {perfOpen ? (
        <View style={{ gap: 2, marginBottom: 6 }}>
          {Object.keys(perf ?? {}).length === 0 ? (
            <Text style={{ color: theme.textSecondary, fontSize: 12 }}>No requests yet.</Text>
          ) : (
            Object.entries(perf ?? {}).map(([op, stats]) => (
              <Text key={op} style={{ color: theme.textSecondary, fontSize: 12, fontFamily: "monospace" }}>
                {op}: {stats.count}× avg {stats.avgMs}ms max {stats.maxMs}ms
              </Text>
            ))
          )}
        </View>
      ) : null}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10 }}>
        <Text style={{ color: theme.text, fontSize: 15 }}>Tab size: {intel.settings.tabSize}</Text>
        <View style={{ flexDirection: "row", gap: 12 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Decrease tab size"
            hitSlop={10}
            onPress={() => intel.updateSettings({ tabSize: Math.max(1, intel.settings.tabSize - 1) })}
          >
            <Text style={{ color: theme.accent, fontSize: 20 }}>−</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Increase tab size"
            hitSlop={10}
            onPress={() => intel.updateSettings({ tabSize: Math.min(8, intel.settings.tabSize + 1) })}
          >
            <Text style={{ color: theme.accent, fontSize: 20 }}>+</Text>
          </Pressable>
        </View>
      </View>
    </Sheet>
  );
}

export type IntelPanelId =
  | "outline"
  | "references"
  | "symbols"
  | "rename"
  | "actions"
  | "refactor"
  | "palette"
  | "settings";

export function IntelMenu({
  open,
  onClose,
  intel,
  onOpenPanel,
  onFormat,
  onOrganize,
  onInspect,
  statusText,
}: {
  open: boolean;
  onClose: () => void;
  intel: IntelBridge;
  onOpenPanel: (panel: IntelPanelId) => void;
  onFormat: () => void;
  onOrganize: () => void;
  onInspect: () => void;
  statusText: string;
}) {
  const theme = useTheme();
  const go = (panel: IntelPanelId) => {
    onClose();
    onOpenPanel(panel);
  };
  return (
    <Sheet open={open} onClose={onClose} title="Intel">
      <Text style={{ color: theme.textSecondary, fontSize: 12, marginBottom: 4 }}>{statusText}</Text>
      <MenuRow label="Outline" hint="Symbols in this file" onPress={() => go("outline")} />
      <MenuRow label="Find references" hint="Project-wide, grouped by file" onPress={() => go("references")} />
      <MenuRow label="Workspace symbols" hint="Search every indexed file" onPress={() => go("symbols")} />
      <MenuRow label="Rename symbol" hint="Scoped, with preview" onPress={() => go("rename")} />
      <MenuRow label="Code actions" hint="Quick fixes for this line" onPress={() => go("actions")} />
      <MenuRow label="Refactor" hint="Extract, inline, convert" onPress={() => go("refactor")} />
      <MenuRow label="Inspect at cursor" hint="Hover types in a tooltip" onPress={() => { onClose(); onInspect(); }} />
      <MenuRow label="Format document" hint="Language formatter" onPress={() => { onClose(); onFormat(); }} />
      <MenuRow label="Organize imports" hint="Sort and prune" onPress={() => { onClose(); onOrganize(); }} />
      <MenuRow label="Commands" hint="Palette: editor, navigation, AI, terminal" onPress={() => go("palette")} />
      <MenuRow label="Settings" hint="Toggles for every category" onPress={() => go("settings")} />
    </Sheet>
  );
}
