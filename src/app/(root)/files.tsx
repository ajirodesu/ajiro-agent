import { useFocusEffect, useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { Image } from "expo-image";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  Plus,
  RefreshCw,
  Search,
  X,
} from "lucide-react-native";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { WebView } from "react-native-webview";
import Markdown from "react-native-markdown-display";

import { Container } from "@/components/shared/container";
import { Button } from "@/components/ui/button";
import {
  AppHeader,
  AppTabs,
  CapsuleContainer,
  CircleIconButton,
  HeaderShadow,
  ICON_INNER,
} from "@/components/ui/chrome";
import { withAlpha } from "@/components/ui/chrome-spec";
import { CodeMirrorEditor } from "@/editor/CodeMirrorEditor";
import { FileTypeIcon } from "@/file-icons/FileTypeIcon";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { useChat } from "@/hooks/use-chat";
import { useTheme } from "@/hooks/use-theme";
import { createExternalFolderService } from "@/core/services/external-folder/external-folder-service";
import type { ExternalFolderSession } from "@/core/types/app-state";
import { sessionForProject } from "@/modules/ide/workspace";
import { useIdeWorkspace } from "@/providers/ide-workspace";
import { detectRepo, getStatus } from "@/modules/ide/git-ops";
import {
  extensionOf,
  fingerprintForBytes,
  fingerprintKey,
  previewKindFor,
  readProjectText,
  searchProject,
  walkProjectTree,
  MAX_READ_BYTES,
  type SearchHit,
} from "@/modules/ide/project-files";
import {
  flattenTree,
  matchesTreeQuery,
  parentOfPath,
  type TreeEntry,
  type TreeRow,
} from "@/modules/ide/file-tree";

type PreviewMode = "code" | "preview" | "raw" | "formatted";

function entryGlyph(kind: "directory" | "file", expanded: boolean) {
  if (kind === "directory") {
    return expanded ? "chevron-down" : "chevron-right";
  }
  return "file";
}

const TreeRowView = memo(function TreeRowView({
  row,
  active,
  dirty,
  expanded,
  gitMark,
  onPress,
  onLongPress,
}: {
  row: TreeRow;
  active: boolean;
  dirty: boolean;
  expanded: boolean;
  gitMark: string | null;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const theme = useTheme();
  const glyph = entryGlyph(row.kind, expanded);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      onLongPress={onLongPress}
      className="flex-row items-center gap-sp-2 rounded-ui px-sp-2"
      style={({ pressed }) => ({
        paddingVertical: 9,
        paddingLeft: 8 + row.depth * 18,
        backgroundColor: pressed
          ? withAlpha(theme.text, 0.08)
          : active
            ? withAlpha(theme.accent, 0.18)
            : "transparent",
      })}
    >
      {glyph === "chevron-down" ? (
        <ChevronDown color={theme.textSecondary} size={17} strokeWidth={2} />
      ) : glyph === "chevron-right" ? (
        <ChevronRight color={theme.textSecondary} size={17} strokeWidth={2} />
      ) : (
        <FileTypeIcon fileName={row.name} size={17} />
      )}
      <Text
        numberOfLines={1}
        className="min-w-0 flex-1 font-mono text-sm text-foreground dark:text-foreground-dark"
      >
        {row.name}
      </Text>
      {dirty ? (
        <View
          className="rounded-full"
          style={{ width: 8, height: 8, backgroundColor: "#E0A23C" }}
        />
      ) : null}
      {gitMark ? (
        <Text
          className="font-mono text-xs"
          style={{
            color: gitMark === "?" ? "#3B82F6" : gitMark === "D" ? "#EF4444" : "#E0A23C",
          }}
        >
          {gitMark}
        </Text>
      ) : null}
    </Pressable>
  );
});

export default function FilesScreen() {
  const router = useRouter();
  const theme = useTheme();
  const ide = useIdeWorkspace();
  const { currentConversation, adoptExternalFolderSession } = useChat();

  const [tree, setTree] = useState<Record<string, TreeEntry[]>>({ "": [] });
  const [treeTruncated, setTreeTruncated] = useState(false);
  const [loadingTree, setLoadingTree] = useState(false);
  const [treeScrolled, setTreeScrolled] = useState(false);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchHits, setSearchHits] = useState<SearchHit[] | null>(null);
  const [searchContent, setSearchContent] = useState(false);
  const [menuTarget, setMenuTarget] = useState<TreeEntry | null>(null);
  const [createOpen, setCreateOpen] = useState<null | {
    kind: "file" | "folder";
    parent: string;
  }>(null);
  const [createName, setCreateName] = useState("");
  const [renameTarget, setRenameTarget] = useState<TreeEntry | null>(null);
  const [renameName, setRenameName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [gitBadge, setGitBadge] = useState<string | null>(null);
  const [gitMarks, setGitMarks] = useState<Record<string, string>>({});
  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneUrl, setCloneUrl] = useState("");
  const [cloneBranch, setCloneBranch] = useState("");
  const [cloneToken, setCloneToken] = useState("");
  const [cloneProgress, setCloneProgress] = useState<string | null>(null);
  const [cloneError, setCloneError] = useState<string | null>(null);
  const [tooLarge, setTooLarge] = useState<{
    entry: TreeEntry;
    size: number | null;
  } | null>(null);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("code");
  const [compareText, setCompareText] = useState<string | null>(null);
  const [imageUri, setImageUri] = useState<string | null>(null);

  const project = ide.activeProject;
  const session = ide.activeSession;
  const ui = project ? ide.getProjectUiState(project.id) : null;
  const expanded = useMemo(() => new Set(ui?.expanded ?? []), [ui]);
  const tabs = ui?.tabs ?? [];
  const activePath = ui?.activePath ?? null;
  const serviceRef = useRef(createExternalFolderService());
  const bufferKey = useRef(0);

  const refreshTree = useCallback(() => {
    if (!session) return;
    setLoadingTree(true);
    setTreeError(null);
    try {
      const snapshot = walkProjectTree(session);
      const mapped: Record<string, TreeEntry[]> = {};
      for (const [dir, entries] of Object.entries(snapshot.entries)) {
        mapped[dir] = entries;
      }
      setTree(mapped);
      setTreeTruncated(snapshot.truncated);
      // Re-expand restored folders that have not been loaded yet.
      for (const path of ui?.expanded ?? []) {
        if (mapped[path] === undefined && path) {
          try {
            const listed = serviceRef.current.listEntries(session, path);
            mapped[path] = listed.map((entry) => ({
              path: entry.path,
              name: entry.name,
              kind: entry.kind,
            }));
          } catch {
            // vanished folder — drop it on next persist
          }
        }
      }
      setTree(mapped);
    } catch (error) {
      setTreeError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingTree(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.uri]);

  const refreshGitBadge = useCallback(async () => {
    if (!session) {
      setGitBadge(null);
      setGitMarks({});
      return;
    }
    try {
      const detected = await detectRepo(session);
      if (!detected.isRepo) {
        setGitBadge(null);
        setGitMarks({});
        return;
      }
      const status = await getStatus(session);
      const changes = status.stagedCount + status.unstagedCount;
      setGitBadge(
        `${status.branch ?? "?"}${changes > 0 ? ` · ${changes}` : ""}`,
      );
      const marks: Record<string, string> = {};
      for (const file of status.files) {
        if (file.unstaged === "untracked") marks[file.path] = "?";
        else if (file.unstaged === "deleted" || file.staged === "deleted") {
          marks[file.path] = "D";
        } else if (file.unstaged || file.staged) {
          marks[file.path] = "M";
        }
      }
      setGitMarks(marks);
    } catch {
      setGitBadge(null);
    }
  }, [session]);

  const refreshAll = useCallback(() => {
    refreshTree();
    void refreshGitBadge();
  }, [refreshTree, refreshGitBadge]);

  useFocusEffect(
    useCallback(() => {
      refreshAll();
    }, [refreshAll]),
  );

  useEffect(() => {
    if (!project) return;
    return ide.subscribe((event) => {
      if (
        event.type.startsWith("FILE_") ||
        event.type.startsWith("GIT_") ||
        event.type.startsWith("PROJECT_") ||
        event.type.startsWith("TERMINAL_")
      ) {
        refreshAll();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  // Debounced project search.
  useEffect(() => {
    if (!session || !searchQuery.trim()) {
      setSearchHits(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const result = await searchProject(session, searchQuery, {
            content: searchContent,
          });
          setSearchHits(result.hits);
        } catch {
          setSearchHits([]);
        } finally {
          setSearching(false);
        }
      })();
    }, 300);
    return () => clearTimeout(timer);
  }, [session, searchQuery, searchContent]);

  const setExpanded = (path: string, open: boolean) => {
    if (!project) return;
    const next = new Set(expanded);
    if (open) {
      next.add(path);
      if (session && tree[path] === undefined) {
        try {
          const listed = serviceRef.current.listEntries(session, path);
          setTree((current) => ({
            ...current,
            [path]: listed.map((entry) => ({
              path: entry.path,
              name: entry.name,
              kind: entry.kind,
            })),
          }));
        } catch (error) {
          setNotice(error instanceof Error ? error.message : String(error));
          return;
        }
      }
    } else {
      next.delete(path);
    }
    ide.updateProjectUiState(project.id, { expanded: [...next] });
  };

  const activateProjectSession = async (
    folderSession: ExternalFolderSession,
    name: string,
  ) => {
    setBusy("open");
    setNotice(null);
    try {
      const opened = await ide.openProject({
        name,
        uri: folderSession.uri,
        displayName: folderSession.displayName,
      });
      // Single authority: adopt into the conversation when it has no folder,
      // so the agent shares the same project without a second pick.
      if (
        currentConversation &&
        !currentConversation.externalFolderSession
      ) {
        try {
          await adoptExternalFolderSession(
            sessionForProject(
              opened,
              Platform.OS === "ios" ? "ios" : "android",
            ),
          );
          setNotice(`Project "${name}" is active and linked to this chat.`);
        } catch {
          // chat link is best-effort; the workspace is authoritative
        }
      }
      ide.emit({ type: "PROJECT_SELECTED", projectId: opened.id });
      refreshAll();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const openLocalProject = async () => {
    try {
      const picked =
        await serviceRef.current.pickDirectory();
      await activateProjectSession(picked, picked.displayName);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/cancelled by the user/i.test(message)) {
        setNotice(message);
      }
    }
  };

  const runClone = async () => {
    if (!cloneUrl.trim() || busy) return;
    setBusy("clone");
    setCloneError(null);
    setCloneProgress("Validating…");
    try {
      const { validateCloneUrl } = await import(
        "@/modules/ide/git-validate"
      );
      const validated = validateCloneUrl(cloneUrl);
      if (!validated.ok) {
        setCloneError(validated.error);
        return;
      }
      // Destination: the user picks the (empty) folder that becomes the
      // project root — no child-URI juggling, no duplicate copies.
      const dest = await serviceRef.current.pickDirectory();
      const existing = serviceRef.current.listEntries(dest, "");
      if (existing.length > 0) {
        setCloneError("The destination folder is not empty.");
        return;
      }
      const { cloneRepository } = await import("@/modules/ide/git-ops");
      const { secureSecretStore } = await import(
        "@/core/services/secrets"
      );
      const token = cloneToken.trim()
        ? cloneToken.trim()
        : ((await secureSecretStore.getProviderApiKey(
            `git:${validated.host}`,
          )) ?? undefined);
      setCloneProgress("Cloning…");
      await cloneRepository({
        url: cloneUrl.trim(),
        branch: cloneBranch.trim() || undefined,
        destSession: dest,
        auth: token ? { token } : undefined,
        onProgress: (progress) => {
          setCloneProgress(
            `${progress.phase} ${progress.loaded}/${progress.total}`,
          );
        },
      });
      if (token && cloneToken.trim()) {
        await secureSecretStore
          .setProviderApiKey(`git:${validated.host}`, cloneToken.trim())
          .catch(() => {});
      }
      setCloneOpen(false);
      setCloneUrl("");
      setCloneBranch("");
      setCloneToken("");
      setCloneProgress(null);
      await activateProjectSession(dest, validated.repoName);
    } catch (error) {
      setCloneError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const openEntry = async (entry: TreeEntry) => {
    if (!project || !session) return;
    if (entry.kind === "directory") {
      setExpanded(entry.path, !expanded.has(entry.path));
      return;
    }
    const kind = previewKindFor(entry.name, null);
    if (kind === "binary") {
      openTab(entry);
      return;
    }
    // Size gate before reading.
    const size = await entrySize(entry.path);
    if (size !== null && size > MAX_READ_BYTES) {
      setTooLarge({ entry, size });
      return;
    }
    openTab(entry);
  };

  const entrySize = async (path: string): Promise<number | null> => {
    if (!session) return null;
    try {
      const parent = parentOfPath(path);
      const listed = serviceRef.current.listEntries(session, parent);
      return listed.find((entry) => entry.path === path)?.size ?? null;
    } catch {
      return null;
    }
  };

  const openTab = (entry: TreeEntry) => {
    if (!project) return;
    const nextTabs = tabs.includes(entry.path)
      ? tabs
      : [...tabs, entry.path].slice(-12);
    ide.updateProjectUiState(project.id, {
      tabs: nextTabs,
      activePath: entry.path,
    });
    setPreviewMode("code");
    setCompareText(null);
    setImageUri(null);
    bufferKey.current += 1;
  };

  const closeTab = (path: string) => {
    if (!project) return;
    const dirty = (ui?.dirtyPaths ?? []).includes(path);
    const remove = () => {
      const nextTabs = tabs.filter((entry) => entry !== path);
      ide.updateProjectUiState(project.id, {
        tabs: nextTabs,
        activePath:
          activePath === path
            ? (nextTabs[nextTabs.length - 1] ?? null)
            : activePath,
      });
      ide.clearBuffer(project.id, path);
      ide.setPathDirty(project.id, path, false);
    };
    if (dirty) {
      Alert.alert("Unsaved changes", `"${path}" has unsaved changes.`, [
        { text: "Keep editing", style: "cancel" },
        {
          text: "Discard",
          style: "destructive",
          onPress: remove,
        },
      ]);
      return;
    }
    remove();
  };

  const saveActiveFile = async () => {
    if (!project || !session || !activePath) return;
    const buffer = ide.getBuffer(project.id, activePath);
    if (buffer === undefined) return;
    setBusy("save");
    try {
      await serviceRef.current.writeTextFile(session, activePath, buffer);
      ide.setPathDirty(project.id, activePath, false);
      ide.emit({ type: "FILE_SAVED", projectId: project.id, path: activePath });
      refreshGitBadge().catch(() => {});
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const runMutation = async (
    key: string,
    action: () => Promise<void>,
    event?: { type: "FILE_CREATED" | "FILE_RENAMED" | "FILE_DELETED"; path: string; from?: string; to?: string },
  ) => {
    if (!project) return;
    setBusy(key);
    try {
      await action();
      if (event) {
        if (event.type === "FILE_RENAMED") {
          ide.emit({
            type: "FILE_RENAMED",
            projectId: project.id,
            from: event.from ?? "",
            to: event.to ?? "",
          });
        } else if (event.type === "FILE_CREATED") {
          ide.emit({ type: "FILE_CREATED", projectId: project.id, path: event.path });
        } else {
          ide.emit({ type: "FILE_DELETED", projectId: project.id, path: event.path });
        }
      }
      refreshAll();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const createEntry = async () => {
    if (!session || !createOpen) return;
    const name = createName.trim().replace(/[/\\]/g, "");
    if (!name) {
      setNotice("Enter a name.");
      return;
    }
    const base = createOpen.parent;
    const path = base ? `${base}/${name}` : name;
    await runMutation(
      "create",
      async () => {
        if (createOpen.kind === "folder") {
          await serviceRef.current.createDirectory(session, path);
        } else {
          await serviceRef.current.createTextFile(session, path, "");
        }
        setCreateOpen(null);
        setCreateName("");
        setExpanded(base, true);
      },
      { type: "FILE_CREATED", path },
    );
  };

  const renameEntry = async () => {
    if (!session || !renameTarget) return;
    const name = renameName.trim().replace(/[/\\]/g, "");
    if (!name) {
      setNotice("Enter a name.");
      return;
    }
    const parent = parentOfPath(renameTarget.path);
    const to = parent ? `${parent}/${name}` : name;
    const from = renameTarget.path;
    await runMutation(
      "rename",
      async () => {
        await serviceRef.current.renameEntry(session, from, name);
        setRenameTarget(null);
        // Keep tabs attached across the rename (§13).
        if (project && tabs.includes(from)) {
          const buffer = ide.getBuffer(project.id, from);
          ide.updateProjectUiState(project.id, {
            tabs: tabs.map((entry) => (entry === from ? to : entry)),
            activePath: activePath === from ? to : activePath,
          });
          if (buffer !== undefined) {
            ide.setBuffer(project.id, to, buffer);
            ide.clearBuffer(project.id, from);
          }
          const dirty = (ui?.dirtyPaths ?? []).includes(from);
          if (dirty) {
            ide.setPathDirty(project.id, from, false);
            ide.setPathDirty(project.id, to, true);
          }
        }
      },
      { type: "FILE_RENAMED", path: to, from, to },
    );
  };

  const deleteEntry = async (entry: TreeEntry) => {
    if (!session) return;
    await runMutation(
      "delete",
      async () => {
        await serviceRef.current.deleteEntry(
          session,
          entry.path,
          entry.kind === "directory",
        );
        setMenuTarget(null);
        if (project && tabs.includes(entry.path)) {
          closeTab(entry.path);
        }
      },
      { type: "FILE_DELETED", path: entry.path },
    );
  };

  const duplicateEntry = async (entry: TreeEntry) => {
    if (!session || entry.kind !== "file") return;
    const parent = parentOfPath(entry.path);
    const base = entry.name.replace(/(\.[^.]+)?$/, "-copy$1");
    const to = parent ? `${parent}/${base}` : base;
    await runMutation(
      "duplicate",
      async () => {
        const read = await readProjectText(session, entry.path);
        if (read.status !== "ok") {
          throw new Error(
            read.status === "too-large"
              ? "File is too large to duplicate."
              : read.message,
          );
        }
        await serviceRef.current.createTextFile(session, to, read.text);
        setMenuTarget(null);
      },
      { type: "FILE_CREATED", path: to },
    );
  };

  const copyPath = async (entry: TreeEntry, relative: boolean) => {
    const value = relative
      ? entry.path
      : `${project?.displayName ?? ""}/${entry.path}`;
    await Clipboard.setStringAsync(value);
    setMenuTarget(null);
    setNotice("Path copied.");
  };

  const revealInFolder = (entry: TreeEntry) => {
    if (!project) return;
    const parts = parentOfPath(entry.path).split("/").filter(Boolean);
    let prefix = "";
    const next = new Set(expanded);
    for (const part of parts) {
      prefix = prefix ? `${prefix}/${part}` : part;
      next.add(prefix);
    }
    ide.updateProjectUiState(project.id, { expanded: [...next] });
    setMenuTarget(null);
  };

  const openInTerminal = (entry: TreeEntry | null) => {
    if (!project) return;
    const cwd =
      !entry || entry.path === ""
        ? ""
        : entry.kind === "directory"
          ? entry.path
          : parentOfPath(entry.path);
    ide.updateProjectUiState(project.id, { terminalCwd: cwd });
    setMenuTarget(null);
    router.push("/terminal");
  };

  const rows = useMemo(() => {
    if (!session) return [];
    if (searchHits !== null) {
      return searchHits.map((hit) => ({
        path: hit.path,
        name: hit.name,
        kind: hit.kind,
        depth: 0,
      }));
    }
    const query = searchQuery.trim();
    if (query) {
      const out: TreeRow[] = [];
      const walk = (dirPath: string, depth: number) => {
        for (const entry of tree[dirPath] ?? []) {
          if (matchesTreeQuery(entry, query)) {
            out.push({ ...entry, depth });
          }
          if (entry.kind === "directory") walk(entry.path, depth + 1);
        }
      };
      walk("", 0);
      return out;
    }
    return flattenTree(tree, expanded);
  }, [session, searchHits, searchQuery, tree, expanded]);

  const activeEntry: TreeEntry | null = activePath
    ? ({ path: activePath, name: activePath.split("/").pop() ?? activePath, kind: "file" } as TreeEntry)
    : null;

  if (!project || !session) {
    return (
      <Container
        contentClassName="gap-sp-4 py-sp-4"
        includeBottomTabInset={false}
      >
        <View className="flex-row items-center gap-sp-2">
          <Button
            leftIcon={<ChevronLeft color={theme.text} size={16} />}
            onPress={() => {
              if (router.canGoBack()) {
                router.back();
              } else {
                router.push("/");
              }
            }}
            size="icon-xs"
            variant="ghost"
          />
          <Text className="font-sans text-xl font-semibold text-foreground dark:text-foreground-dark">
            Files
          </Text>
        </View>
        <View className="flex-1 items-center justify-center gap-sp-3 px-sp-6">
          <Text className="text-center font-sans text-base font-medium text-foreground dark:text-foreground-dark">
            No project selected
          </Text>
          <Text className="text-center font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
            Open a local project or clone a repository to begin.
          </Text>
          <Button
            loading={busy === "open"}
            onPress={() => {
              void openLocalProject();
            }}
          >
            Open Local Project
          </Button>
          <Button
            onPress={() => {
              setCloneOpen(true);
            }}
            variant="outline"
          >
            Git Clone
          </Button>
          {notice ? (
            <Text className="text-center font-sans text-sm text-destructive dark:text-destructive-dark">
              {notice}
            </Text>
          ) : null}
        </View>
        <CloneModal
          open={cloneOpen}
          url={cloneUrl}
          branch={cloneBranch}
          token={cloneToken}
          progress={cloneProgress}
          error={cloneError}
          busy={busy === "clone"}
          onChangeUrl={setCloneUrl}
          onChangeBranch={setCloneBranch}
          onChangeToken={setCloneToken}
          onClose={() => {
            if (busy !== "clone") setCloneOpen(false);
          }}
          onClone={() => {
            void runClone();
          }}
        />
      </Container>
    );
  }

  return (
    <Container
      contentClassName="gap-sp-2 py-sp-4"
      contentStyle={{ paddingBottom: 0 }}
      includeBottomTabInset={false}
    >
      <AppHeader
        left={
          <CircleIconButton
            accessibilityLabel="Back"
            onPress={() => {
              if (router.canGoBack()) {
                router.back();
              } else {
                router.push("/");
              }
            }}
          >
            <ChevronLeft color={theme.text} size={20} strokeWidth={2} />
          </CircleIconButton>
        }
        title="Files"
        subtitle={`${project.displayName}${gitBadge ? ` · ${gitBadge}` : ""}${treeTruncated ? " · list truncated" : ""}`}
        right={
          <CapsuleContainer accessibilityLabel="File actions">
            <Pressable
              accessibilityLabel="Refresh files"
              accessibilityRole="button"
              onPress={refreshAll}
              hitSlop={8}
              className="items-center justify-center rounded-full"
              style={({ pressed }) => ({
                width: ICON_INNER,
                height: ICON_INNER,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <RefreshCw color={theme.text} size={20} strokeWidth={2} />
            </Pressable>
            <Pressable
              accessibilityLabel="New file or folder"
              accessibilityRole="button"
              onPress={() => {
                setCreateName("");
                setCreateOpen({ kind: "file", parent: "" });
              }}
              hitSlop={8}
              className="items-center justify-center rounded-full"
              style={({ pressed }) => ({
                width: ICON_INNER,
                height: ICON_INNER,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Plus color={theme.text} size={20} strokeWidth={2} />
            </Pressable>
          </CapsuleContainer>
        }
      />
      <ProjectTabsBar />

      <View className="flex-row items-center gap-sp-2">
        <View className="h-10 min-w-0 flex-1 flex-row items-center gap-sp-2 rounded-full border border-border bg-input px-sp-3 dark:border-border-dark dark:bg-input-dark">
          <Search color={theme.textSecondary} size={16} />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search files"
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            className="min-w-0 flex-1 font-sans text-sm text-foreground dark:text-foreground-dark"
          />
          {searchQuery ? (
            <Pressable
              accessibilityLabel="Clear search"
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => {
                setSearchQuery("");
              }}
            >
              <X color={theme.textSecondary} size={16} />
            </Pressable>
          ) : null}
        </View>
        <Pressable
          accessibilityLabel="Toggle content search"
          accessibilityRole="button"
          onPress={() => {
            setSearchContent((value) => !value);
          }}
          hitSlop={8}
          className="h-10 items-center justify-center rounded-full border border-border px-sp-3 dark:border-border-dark"
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
        >
          <Text
            className="font-mono text-xs"
            style={{ color: searchContent ? theme.accent : theme.textSecondary }}
          >
            {searchContent ? "aA●" : "aA"}
          </Text>
        </Pressable>
      </View>
      {searching ? (
        <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
          Searching…
        </Text>
      ) : null}

      {notice ? (
        <Text className="font-sans text-sm text-destructive dark:text-destructive-dark">
          {notice}
        </Text>
      ) : null}

      <View className="min-h-0 flex-1 gap-sp-2">
        <View className="relative max-h-64">
          <HeaderShadow visible={treeScrolled} />
          {loadingTree ? (
            <View className="flex-row items-center gap-sp-2 py-sp-2">
              <ActivityIndicator size="small" color={theme.textSecondary} />
              <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                Loading files…
              </Text>
            </View>
          ) : treeError ? (
            <Text className="font-sans text-sm text-destructive dark:text-destructive-dark">
              {treeError}
            </Text>
          ) : (
            <FlatList
              data={rows}
              keyExtractor={(row) => row.path}
              scrollEventThrottle={32}
              onScroll={(event) => {
                setTreeScrolled(event.nativeEvent.contentOffset.y > 4);
              }}
              renderItem={({ item }) => (
                <TreeRowView
                  row={item}
                  active={item.path === activePath}
                  dirty={(ui?.dirtyPaths ?? []).includes(item.path)}
                  expanded={
                    item.kind === "directory" && expanded.has(item.path)
                  }
                  gitMark={gitMarks[item.path] ?? null}
                  onPress={() => {
                    if (item.kind === "directory") {
                      setExpanded(item.path, !expanded.has(item.path));
                    } else {
                      void openEntry(item);
                    }
                  }}
                  onLongPress={() => {
                    setMenuTarget(item);
                  }}
                />
              )}
              initialNumToRender={40}
              maxToRenderPerBatch={40}
              windowSize={11}
              removeClippedSubviews
              ListEmptyComponent={
                <Text className="py-sp-2 font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                  Empty folder.
                </Text>
              }
            />
          )}
        </View>

        {tabs.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            className="max-h-11 flex-none"
            contentContainerClassName="items-center gap-sp-1 pr-sp-1"
          >
            {tabs.map((path) => {
              const selected = path === activePath;
              const dirty = (ui?.dirtyPaths ?? []).includes(path);
              return (
                <View
                  key={path}
                  className="flex-row items-center rounded-full"
                  style={{
                    borderWidth: selected ? 1 : 0,
                    borderColor: selected ? theme.accent : "transparent",
                    backgroundColor: selected
                      ? withAlpha(theme.accent, 0.18)
                      : "transparent",
                  }}
                >
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      ide.updateProjectUiState(project.id, {
                        activePath: path,
                      });
                      setPreviewMode("code");
                      setCompareText(null);
                      setImageUri(null);
                    }}
                    className="max-w-36 flex-row items-center gap-sp-1 py-sp-2 pl-sp-2"
                  >
                    {dirty ? (
                      <View
                        className="rounded-full"
                        style={{
                          width: 8,
                          height: 8,
                          backgroundColor: "#E0A23C",
                        }}
                      />
                    ) : null}
                    <Text
                      numberOfLines={1}
                      className="font-mono text-xs text-foreground dark:text-foreground-dark"
                    >
                      {path.split("/").pop()}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityLabel={`Close ${path}`}
                    accessibilityRole="button"
                    hitSlop={8}
                    onPress={() => {
                      closeTab(path);
                    }}
                    className="px-sp-1 py-sp-2"
                  >
                    <X color={theme.textSecondary} size={13} />
                  </Pressable>
                </View>
              );
            })}
          </ScrollView>
        ) : null}

        <View className="min-h-0 flex-1">
          {activeEntry ? (
            <ActiveFileView
              entry={activeEntry}
              session={session}
              projectId={project.id}
              previewMode={previewMode}
              onPreviewModeChange={setPreviewMode}
              compareText={compareText}
              onCompareChange={setCompareText}
              imageUri={imageUri}
              onImageUriChange={setImageUri}
              onSave={saveActiveFile}
              saving={busy === "save"}
              bufferKey={bufferKey.current}
            />
          ) : (
            <View className="flex-1 items-center justify-center px-sp-6">
              <Text className="text-center font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                Select a file to open it in the editor.
              </Text>
            </View>
          )}
        </View>
      </View>

      <EntryActionSheet
        target={menuTarget}
        projectName={project.displayName}
        onClose={() => {
          setMenuTarget(null);
        }}
        onOpen={() => {
          if (menuTarget) void openEntry(menuTarget);
          setMenuTarget(null);
        }}
        onPreview={() => {
          if (menuTarget && menuTarget.kind === "file") {
            openTab(menuTarget);
            setPreviewMode("preview");
          }
          setMenuTarget(null);
        }}
        onRename={() => {
          if (menuTarget) {
            setRenameName(menuTarget.name);
            setRenameTarget(menuTarget);
          }
          setMenuTarget(null);
        }}
        onDelete={() => {
          const target = menuTarget;
          if (!target) return;
          Alert.alert(
            "Delete",
            `Delete "${target.path}"${target.kind === "directory" ? " and everything inside it" : ""}?`,
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Delete",
                style: "destructive",
                onPress: () => {
                  void deleteEntry(target);
                },
              },
            ],
          );
        }}
        onDuplicate={() => {
          if (menuTarget) void duplicateEntry(menuTarget);
        }}
        onCopyPath={() => {
          if (menuTarget) void copyPath(menuTarget, false);
        }}
        onCopyRelative={() => {
          if (menuTarget) void copyPath(menuTarget, true);
        }}
        onReveal={() => {
          if (menuTarget) revealInFolder(menuTarget);
        }}
        onTerminal={() => {
          openInTerminal(menuTarget);
        }}
        onDiff={async () => {
          if (!menuTarget || menuTarget.kind !== "file" || !session) return;
          setBusy("diff");
          try {
            const { getDiff } = await import("@/modules/ide/git-ops");
            const text = await getDiff(session, menuTarget.path, false);
            setMenuTarget(null);
            openTab(menuTarget);
            setCompareText(text);
            setPreviewMode("preview");
          } catch (error) {
            setNotice(error instanceof Error ? error.message : String(error));
          } finally {
            setBusy(null);
          }
        }}
        onStage={async () => {
          if (!menuTarget || !session) return;
          const target = menuTarget;
          setMenuTarget(null);
          setBusy("stage");
          try {
            const { stagePaths } = await import("@/modules/ide/git-ops");
            await stagePaths(session, [target.path]);
            ide.emit({ type: "GIT_STATUS_CHANGED", projectId: project.id });
            refreshGitBadge().catch(() => {});
          } catch (error) {
            setNotice(error instanceof Error ? error.message : String(error));
          } finally {
            setBusy(null);
          }
        }}
        onUnstage={async () => {
          if (!menuTarget || !session) return;
          const target = menuTarget;
          setMenuTarget(null);
          setBusy("stage");
          try {
            const { unstagePaths } = await import("@/modules/ide/git-ops");
            await unstagePaths(session, [target.path]);
            ide.emit({ type: "GIT_STATUS_CHANGED", projectId: project.id });
            refreshGitBadge().catch(() => {});
          } catch (error) {
            setNotice(error instanceof Error ? error.message : String(error));
          } finally {
            setBusy(null);
          }
        }}
      />

      <Drawer
        onOpenChange={(open) => {
          if (!open) {
            setCreateOpen(null);
            setCreateName("");
          }
        }}
        open={createOpen !== null}
      >
        <DrawerContent showCloseButton showHandle>
          <DrawerHeader>
            <DrawerTitle>
              New {createOpen?.kind === "folder" ? "folder" : "file"}
            </DrawerTitle>
            <DrawerDescription>
              In {createOpen?.parent || project.displayName}
            </DrawerDescription>
          </DrawerHeader>
          <DrawerBody contentContainerClassName="gap-sp-2 pb-sp-4">
            <View className="flex-row gap-sp-2">
              {(["file", "folder"] as const).map((kind) => (
                <Pressable
                  key={kind}
                  accessibilityRole="button"
                  onPress={() => {
                    setCreateOpen((current) =>
                      current ? { ...current, kind } : current,
                    );
                  }}
                  className="flex-1 items-center rounded-ui border border-border py-sp-2 dark:border-border-dark"
                  style={({ pressed }) => ({
                    backgroundColor:
                      createOpen?.kind === kind
                        ? "rgba(59,130,246,0.25)"
                        : "transparent",
                    opacity: pressed ? 0.8 : 1,
                  })}
                >
                  <Text className="font-sans text-sm text-foreground dark:text-foreground-dark">
                    {kind === "file" ? "File" : "Folder"}
                  </Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              autoFocus
              value={createName}
              onChangeText={setCreateName}
              placeholder={createOpen?.kind === "folder" ? "Folder name" : "File name"}
              placeholderTextColor={theme.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              onSubmitEditing={() => {
                void createEntry();
              }}
              className="h-11 rounded-ui border border-border bg-input px-sp-3 font-sans text-base text-foreground dark:border-border-dark dark:bg-input-dark dark:text-foreground-dark"
            />
            <Button
              loading={busy === "create"}
              onPress={() => {
                void createEntry();
              }}
            >
              Create
            </Button>
          </DrawerBody>
        </DrawerContent>
      </Drawer>

      <Drawer
        onOpenChange={(open) => {
          if (!open) {
            setRenameTarget(null);
            setRenameName("");
          }
        }}
        open={renameTarget !== null}
      >
        <DrawerContent showCloseButton showHandle>
          <DrawerHeader>
            <DrawerTitle>Rename</DrawerTitle>
            <DrawerDescription>{renameTarget?.path}</DrawerDescription>
          </DrawerHeader>
          <DrawerBody contentContainerClassName="gap-sp-2 pb-sp-4">
            <TextInput
              autoFocus
              value={renameName}
              onChangeText={setRenameName}
              placeholder="New name"
              placeholderTextColor={theme.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              onSubmitEditing={() => {
                void renameEntry();
              }}
              className="h-11 rounded-ui border border-border bg-input px-sp-3 font-sans text-base text-foreground dark:border-border-dark dark:bg-input-dark dark:text-foreground-dark"
            />
            <Button
              loading={busy === "rename"}
              onPress={() => {
                void renameEntry();
              }}
            >
              Rename
            </Button>
          </DrawerBody>
        </DrawerContent>
      </Drawer>

      <Drawer
        onOpenChange={(open) => {
          if (!open) setTooLarge(null);
        }}
        open={tooLarge !== null}
      >
        <DrawerContent showCloseButton showHandle>
          <DrawerHeader>
            <DrawerTitle>File is large</DrawerTitle>
            <DrawerDescription>
              {tooLarge?.entry.path} (
              {tooLarge?.size !== null && tooLarge?.size !== undefined
                ? `${Math.round((tooLarge?.size ?? 0) / 1024)} KB`
                : "unknown size"}
              ). Large files can be slow to edit.
            </DrawerDescription>
          </DrawerHeader>
          <DrawerBody contentContainerClassName="gap-sp-2 pb-sp-4">
            <Button
              onPress={() => {
                if (tooLarge) openTab(tooLarge.entry);
                setTooLarge(null);
              }}
            >
              Open Anyway
            </Button>
            <Button
              onPress={() => {
                setTooLarge(null);
              }}
              variant="outline"
            >
              Cancel
            </Button>
          </DrawerBody>
        </DrawerContent>
      </Drawer>

      <CloneModal
        open={cloneOpen}
        url={cloneUrl}
        branch={cloneBranch}
        token={cloneToken}
        progress={cloneProgress}
        error={cloneError}
        busy={busy === "clone"}
        onChangeUrl={setCloneUrl}
        onChangeBranch={setCloneBranch}
        onChangeToken={setCloneToken}
        onClose={() => {
          if (busy !== "clone") setCloneOpen(false);
        }}
        onClone={() => {
          void runClone();
        }}
      />
    </Container>
  );

  function ProjectTabsBar() {
    const tabs = ide.projects;
    if (tabs.length === 0) return null;
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="max-h-11 flex-none"
        contentContainerClassName="items-center gap-sp-1 pr-sp-1"
      >
        {tabs.map((entry) => {
          const selected = entry.id === project?.id;
          return (
            <Pressable
              key={entry.id}
              accessibilityRole="button"
              onPress={() => {
                if (entry.id !== project?.id) {
                  setBusy("switch");
                  ide
                    .activateProject(entry.id)
                    .catch((error) => {
                      setNotice(
                        error instanceof Error ? error.message : String(error),
                      );
                    })
                    .finally(() => {
                      setBusy(null);
                    });
                }
              }}
              className="max-w-40 flex-row items-center gap-sp-1 rounded-ui border border-border px-sp-2 py-sp-2 dark:border-border-dark"
              style={({ pressed }) => ({
                backgroundColor: selected
                  ? "rgba(59,130,246,0.18)"
                  : pressed
                    ? "rgba(255,255,255,0.06)"
                    : "transparent",
              })}
            >
              <Text
                numberOfLines={1}
                className="font-sans text-xs text-foreground dark:text-foreground-dark"
              >
                {entry.name}
              </Text>
            </Pressable>
          );
        })}
        <Pressable
          accessibilityLabel="Open another project"
          accessibilityRole="button"
          onPress={() => {
            void openLocalProject();
          }}
          hitSlop={8}
          className="h-9 w-9 items-center justify-center rounded-full"
        >
          <Plus color={theme.textSecondary} size={18} />
        </Pressable>
      </ScrollView>
    );
  }
}

function ActiveFileView({
  entry,
  session,
  projectId,
  previewMode,
  onPreviewModeChange,
  compareText,
  onCompareChange,
  imageUri,
  onImageUriChange,
  onSave,
  saving,
  bufferKey,
}: {
  entry: TreeEntry;
  session: ExternalFolderSession;
  projectId: string;
  previewMode: PreviewMode;
  onPreviewModeChange: (mode: PreviewMode) => void;
  compareText: string | null;
  onCompareChange: (text: string | null) => void;
  imageUri: string | null;
  onImageUriChange: (uri: string | null) => void;
  onSave: () => void;
  saving: boolean;
  bufferKey: number;
}) {
  const ide = useIdeWorkspace();
  const theme = useTheme();
  const [disk, setDisk] = useState<{
    text: string;
    fingerprint: string;
  } | null>(null);
  const [diskError, setDiskError] = useState<string | null>(null);
  const [externalChanged, setExternalChanged] = useState(false);
  const fingerprintRef = useRef<string | null>(null);

  const buffer = ide.getBuffer(projectId, entry.path);
  const kind = previewKindFor(entry.name, null);

  const loadDisk = useCallback(async () => {
    setDiskError(null);
    setExternalChanged(false);
    const read = await readProjectText(session, entry.path);
    if (read.status !== "ok") {
      setDiskError(
        read.status === "too-large"
          ? "File is too large to open."
          : read.message,
      );
      setDisk(null);
      fingerprintRef.current = null;
      return;
    }
    const fingerprint = fingerprintKey(
      fingerprintForBytes(new TextEncoder().encode(read.text)),
    );
    fingerprintRef.current = fingerprint;
    setDisk({ text: read.text, fingerprint });
    if (buffer === undefined) {
      ide.setBuffer(projectId, entry.path, read.text);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.uri, entry.path, bufferKey]);

  useEffect(() => {
    void loadDisk();
  }, [loadDisk]);

  const checkExternal = useCallback(async () => {
    if (!fingerprintRef.current) return;
    const read = await readProjectText(session, entry.path);
    if (read.status !== "ok") return;
    const fingerprint = fingerprintKey(
      fingerprintForBytes(new TextEncoder().encode(read.text)),
    );
    if (fingerprint === fingerprintRef.current) return;
    const dirty = ide.getProjectUiState(projectId).dirtyPaths.includes(entry.path);
    if (dirty) {
      setExternalChanged(true);
    } else {
      fingerprintRef.current = fingerprint;
      setDisk({ text: read.text, fingerprint });
      ide.setBuffer(projectId, entry.path, read.text);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.uri, entry.path]);

  useFocusEffect(
    useCallback(() => {
      void checkExternal();
    }, [checkExternal]),
  );

  useEffect(() => {
    return ide.subscribe((event) => {
      if (
        (event.type === "FILE_CHANGED" || event.type === "FILE_SAVED") &&
        "path" in event &&
        event.path === entry.path &&
        event.projectId === projectId
      ) {
        void checkExternal();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, entry.path]);

  useEffect(() => {
    if (kind === "image" && !imageUri) {
      void (async () => {
        try {
          const service = createExternalFolderService();
          const { bytes } = await service.readBytesFile(session, entry.path);
          if (bytes.length > 5_000_000) return;
          let binary = "";
          const chunk = 8192;
          for (let index = 0; index < bytes.length; index += chunk) {
            binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
          }
          const { Buffer } = await import("buffer");
          const base64 = Buffer.from(binary, "binary").toString("base64");
          const extension = extensionOf(entry.name);
          const mime =
            extension === ".png"
              ? "image/png"
              : extension === ".gif"
                ? "image/gif"
                : extension === ".webp"
                  ? "image/webp"
                  : "image/jpeg";
          onImageUriChange(`data:${mime};base64,${base64}`);
        } catch {
          // leave the placeholder
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, entry.path]);

  const value = buffer ?? disk?.text ?? "";

  if (diskError) {
    return (
      <View className="flex-1 items-center justify-center px-sp-6">
        <Text className="text-center font-sans text-sm text-destructive dark:text-destructive-dark">
          {diskError}
        </Text>
      </View>
    );
  }

  if (kind === "binary") {
    return (
      <View className="flex-1 items-center justify-center gap-sp-2 px-sp-6">
        <FileText color={theme.textSecondary} size={28} />
        <Text className="font-sans text-base font-medium text-foreground dark:text-foreground-dark">
          {entry.name}
        </Text>
        <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
          Binary file — preview is not supported.
        </Text>
      </View>
    );
  }

  if (kind === "image") {
    return (
      <View className="flex-1 items-center justify-center bg-black">
        {imageUri ? (
          <Image
            source={{ uri: imageUri }}
            contentFit="contain"
            style={{ width: "100%", height: "100%" }}
          />
        ) : (
          <ActivityIndicator color={theme.textSecondary} />
        )}
      </View>
    );
  }

  if (kind === "svg") {
    return (
      <View className="flex-1 items-center justify-center gap-sp-2 px-sp-6">
        <FileText color={theme.textSecondary} size={28} />
        <Text className="text-center font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
          SVG preview is not rendered safely on this build. Open as text to
          inspect the source.
        </Text>
        <Button
          onPress={() => {
            onPreviewModeChange("code");
          }}
          variant="outline"
        >
          Open as text
        </Button>
      </View>
    );
  }

  if (compareText !== null) {
    return (
      <View className="min-h-0 flex-1 gap-sp-1">
        <View className="flex-row items-center gap-sp-2">
          <Text className="flex-1 font-sans text-sm font-medium text-foreground dark:text-foreground-dark">
            Diff
          </Text>
          <Pressable
            accessibilityLabel="Close diff"
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => {
              onCompareChange(null);
            }}
          >
            <X color={theme.textSecondary} size={16} />
          </Pressable>
        </View>
        <ScrollView className="min-h-0 flex-1">
          <Text selectable className="font-mono text-xs text-foreground dark:text-foreground-dark">
            {compareText}
          </Text>
        </ScrollView>
      </View>
    );
  }

  if (
    (kind === "markdown" || kind === "json" || kind === "html") &&
    previewMode !== "code"
  ) {
    return (
      <View className="min-h-0 flex-1 gap-sp-1">
        <PreviewTabs kind={kind} />
        {kind === "html" ? (
          <View className="min-h-0 flex-1 overflow-hidden rounded-ui border border-border dark:border-border-dark">
            <WebView
              originWhitelist={["*"]}
              source={{ html: value, baseUrl: "about:blank" }}
              javaScriptEnabled
              domStorageEnabled={false}
              allowFileAccess={false}
              allowUniversalAccessFromFileURLs={false}
              mixedContentMode="never"
              cacheEnabled={false}
              showsVerticalScrollIndicator={false}
              showsHorizontalScrollIndicator={false}
            />
          </View>
        ) : kind === "markdown" ? (
          <ScrollView className="min-h-0 flex-1">
            <Markdown
              style={{
                body: { color: theme.text, fontSize: 14 },
                heading1: { color: theme.text },
                heading2: { color: theme.text },
                heading3: { color: theme.text },
                code_inline: { color: theme.text, backgroundColor: theme.backgroundElement },
                fence: { color: theme.text, backgroundColor: theme.backgroundElement },
                link: { color: theme.accent },
              }}
            >
              {value}
            </Markdown>
          </ScrollView>
        ) : (
          <ScrollView className="min-h-0 flex-1">
            <Text selectable className="font-mono text-xs text-foreground dark:text-foreground-dark">
              {formatJson(value)}
            </Text>
          </ScrollView>
        )}
      </View>
    );
  }

  return (
    <View className="min-h-0 flex-1 gap-sp-1">
      {(kind === "markdown" || kind === "json" || kind === "html") && (
        <PreviewTabs kind={kind} />
      )}
      <CodeMirrorEditor
        path={entry.path}
        value={value}
        onChangeText={(text) => {
          ide.setBuffer(projectId, entry.path, text);
          ide.setPathDirty(projectId, entry.path, text !== disk?.text);
        }}
        onSave={onSave}
      />
      {externalChanged ? (
        <ExternalChangeBar
          onKeep={() => {
            setExternalChanged(false);
          }}
          onReload={async () => {
            setExternalChanged(false);
            await loadDisk();
            ide.clearBuffer(projectId, entry.path);
            ide.setPathDirty(projectId, entry.path, false);
          }}
          onCompare={async () => {
            const read = await readProjectText(session, entry.path);
            if (read.status === "ok") {
              const { computeLineDiff, formatLineDiff } = await import(
                "@/modules/tools/coding/diff"
              );
              onCompareChange(
                formatLineDiff(entry.path, computeLineDiff(read.text, value)),
              );
            }
            setExternalChanged(false);
          }}
        />
      ) : null}
      {saving ? (
        <View className="flex-row items-center gap-sp-2">
          <ActivityIndicator size="small" color={theme.textSecondary} />
          <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
            Saving…
          </Text>
        </View>
      ) : null}
    </View>
  );

  function PreviewTabs({ kind: previewKind }: { kind: "markdown" | "json" | "html" }) {
    const left = previewKind === "json" ? "Raw" : "Code";
    const right =
      previewKind === "markdown" || previewKind === "html"
        ? "Preview"
        : "Formatted";
    return (
      <AppTabs
        tabs={[
          { key: "code", label: left },
          { key: "preview", label: right },
        ]}
        activeKey={previewMode}
        onChange={(key) => {
          onPreviewModeChange(key as PreviewMode);
        }}
      />
    );
  }

  function ExternalChangeBar({
    onKeep,
    onReload,
    onCompare,
  }: {
    onKeep: () => void;
    onReload: () => void;
    onCompare: () => void;
  }) {
    return (
      <View className="gap-sp-1 rounded-ui border border-border bg-card p-sp-2 dark:border-border-dark dark:bg-card-dark">
        <Text className="font-sans text-sm font-medium text-foreground dark:text-foreground-dark">
          File changed externally.
        </Text>
        <View className="flex-row gap-sp-2">
          <Button onPress={onKeep} size="xs" variant="outline">
            Keep mine
          </Button>
          <Button onPress={onReload} size="xs" variant="outline">
            Reload
          </Button>
          <Button onPress={onCompare} size="xs" variant="outline">
            Compare
          </Button>
        </View>
      </View>
    );
  }

  function formatJson(text: string): string {
    if (previewMode === "raw") return text;
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  }
}

function EntryActionSheet({
  target,
  projectName,
  onClose,
  onOpen,
  onPreview,
  onRename,
  onDelete,
  onDuplicate,
  onCopyPath,
  onCopyRelative,
  onReveal,
  onTerminal,
  onDiff,
  onStage,
  onUnstage,
}: {
  target: TreeEntry | null;
  projectName: string;
  onClose: () => void;
  onOpen: () => void;
  onPreview: () => void;
  onRename: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onCopyPath: () => void;
  onCopyRelative: () => void;
  onReveal: () => void;
  onTerminal: () => void;
  onDiff: () => void;
  onStage: () => void;
  onUnstage: () => void;
}) {
  const isFile = target?.kind === "file";
  const rows: { label: string; action: () => void; danger?: boolean }[] = [
    { label: "Open", action: onOpen },
    ...(isFile ? [{ label: "Preview", action: onPreview }] : []),
    { label: "Rename", action: onRename },
    { label: "Delete", action: onDelete, danger: true },
    ...(isFile ? [{ label: "Duplicate", action: onDuplicate }] : []),
    { label: "Copy Path", action: onCopyPath },
    { label: "Copy Relative Path", action: onCopyRelative },
    { label: "Reveal in Folder", action: onReveal },
    { label: "Open in Terminal", action: onTerminal },
    ...(isFile
      ? [
          { label: "Git Diff", action: onDiff },
          { label: "Stage", action: onStage },
          { label: "Unstage", action: onUnstage },
        ]
      : []),
  ];
  return (
    <Drawer open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent showCloseButton showHandle>
        <DrawerHeader>
          <DrawerTitle numberOfLines={1}>{target?.path ?? projectName}</DrawerTitle>
          <DrawerDescription>{projectName}</DrawerDescription>
        </DrawerHeader>
        <DrawerBody contentContainerClassName="gap-sp-1 pb-sp-4">
          {rows.map((row) => (
            <SheetActionRow
              key={row.label}
              label={row.label}
              danger={row.danger}
              onPress={row.action}
            />
          ))}
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}

function SheetActionRow({
  label,
  danger,
  onPress,
}: {
  label: string;
  danger?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className="rounded-ui px-sp-4 py-sp-3"
      style={({ pressed }) => ({
        backgroundColor: pressed ? "rgba(255,255,255,0.06)" : "transparent",
      })}
    >
      <Text
        className={
          danger
            ? "font-sans text-base text-destructive dark:text-destructive-dark"
            : "font-sans text-base text-foreground dark:text-foreground-dark"
        }
      >
        {label}
      </Text>
    </Pressable>
  );
}

function CloneModal({
  open,
  url,
  branch,
  token,
  progress,
  error,
  busy,
  onChangeUrl,
  onChangeBranch,
  onChangeToken,
  onClose,
  onClone,
}: {
  open: boolean;
  url: string;
  branch: string;
  token: string;
  progress: string | null;
  error: string | null;
  busy: boolean;
  onChangeUrl: (value: string) => void;
  onChangeBranch: (value: string) => void;
  onChangeToken: (value: string) => void;
  onClose: () => void;
  onClone: () => void;
}) {
  const theme = useTheme();
  return (
    <Drawer open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DrawerContent showCloseButton showHandle>
        <DrawerHeader>
          <DrawerTitle>Git Clone</DrawerTitle>
          <DrawerDescription>
            Clone into an empty folder you pick, then open it as a project.
          </DrawerDescription>
        </DrawerHeader>
        <DrawerBody contentContainerClassName="gap-sp-2 pb-sp-4">
          <TextInput
            value={url}
            onChangeText={onChangeUrl}
            placeholder="https://github.com/owner/repo.git"
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            className="h-11 rounded-ui border border-border bg-input px-sp-3 font-sans text-base text-foreground dark:border-border-dark dark:bg-input-dark dark:text-foreground-dark"
          />
          <TextInput
            value={branch}
            onChangeText={onChangeBranch}
            placeholder="Branch (optional)"
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            className="h-11 rounded-ui border border-border bg-input px-sp-3 font-sans text-base text-foreground dark:border-border-dark dark:bg-input-dark dark:text-foreground-dark"
          />
          <TextInput
            value={token}
            onChangeText={onChangeToken}
            placeholder="Token (optional, private repos)"
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            className="h-11 rounded-ui border border-border bg-input px-sp-3 font-sans text-base text-foreground dark:border-border-dark dark:bg-input-dark dark:text-foreground-dark"
          />
          {progress ? (
            <View className="flex-row items-center gap-sp-2">
              {busy ? (
                <ActivityIndicator size="small" color={theme.textSecondary} />
              ) : null}
              <Text className="font-mono text-xs text-muted-foreground dark:text-muted-foreground-dark">
                {progress}
              </Text>
            </View>
          ) : null}
          {error ? (
            <Text className="font-sans text-sm text-destructive dark:text-destructive-dark">
              {error}
            </Text>
          ) : null}
          <Button loading={busy} onPress={onClone}>
            Clone
          </Button>
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
