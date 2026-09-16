import * as LegacyFileSystem from "expo-file-system/legacy";
import { Image } from "expo-image";
import * as IntentLauncher from "expo-intent-launcher";
import {
  useLocalSearchParams,
  useRouter,
} from "expo-router";
import * as Sharing from "expo-sharing";
import {
  ChevronLeft,
  File as FileIcon,
  FileText,
  Share2,
  Trash2,
} from "lucide-react-native";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  Text,
  View,
} from "react-native";

import { Container } from "@/components/shared/container";
import {
  AppHeader,
  AppTabs,
  CircleIconButton,
  HeaderShadow,
} from "@/components/ui/chrome";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  isTextWorkspaceFile,
  resolveWorkspaceFile,
} from "@/core/services/workspace-file-service";
import type { WorkspaceFile } from "@/core/types/app-state";
import { useChat } from "@/hooks/use-chat";
import { useTheme } from "@/hooks/use-theme";

type LibraryCategory = "all" | "images" | "docs";

const CATEGORIES: { id: LibraryCategory; label: string }[] = [
  { id: "all", label: "All" },
  { id: "images", label: "Images" },
  { id: "docs", label: "Docs" },
];

export default function LibraryScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [scrolled, setScrolled] = useState(false);
  const { deleteWorkspaceFile, refreshWorkspaceFiles, workspaceFiles } =
    useChat();
  const params = useLocalSearchParams<{ category?: string }>();
  const initialCategory =
    params.category === "images" || params.category === "docs"
      ? params.category
      : "all";
  const [category, setCategory] = useState<LibraryCategory>(initialCategory);
  const [openingFileId, setOpeningFileId] = useState<string | null>(null);
  const [sharingFileId, setSharingFileId] = useState<string | null>(null);
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null);

  useEffect(() => {
    refreshWorkspaceFiles().catch(console.error);
  }, [refreshWorkspaceFiles]);

  const filteredFiles = useMemo(() => {
    if (category === "images") {
      return workspaceFiles.filter((file) => file.mimeType?.startsWith("image/"));
    }

    if (category === "docs") {
      return workspaceFiles.filter((file) => isTextWorkspaceFile(file));
    }

    return workspaceFiles;
  }, [category, workspaceFiles]);

  const handleOpenFile = async (workspaceFile: WorkspaceFile) => {
    setOpeningFileId(workspaceFile.id);

    try {
      const localFile = resolveWorkspaceFile(workspaceFile.relativePath);

      if (!localFile.exists) {
        throw new Error("This file is no longer available in the workspace.");
      }

      const mimeType = isTextWorkspaceFile(workspaceFile)
        ? "text/plain"
        : workspaceFile.mimeType || localFile.type || "*/*";

      if (Platform.OS === "android") {
        const contentUri = await LegacyFileSystem.getContentUriAsync(
          localFile.uri,
        );

        await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
          data: contentUri,
          flags: 1,
          type: mimeType,
        });
        return;
      }

      if (!(await Linking.canOpenURL(localFile.uri))) {
        throw new Error("No compatible app is available to open this file.");
      }

      await Linking.openURL(localFile.uri);
    } catch (error) {
      Alert.alert(
        "Unable to open file",
        error instanceof Error
          ? error.message
          : "The file could not be opened.",
      );
    } finally {
      setOpeningFileId(null);
    }
  };

  const handleShareFile = async (workspaceFile: WorkspaceFile) => {
    setSharingFileId(workspaceFile.id);

    try {
      const available = await Sharing.isAvailableAsync();

      if (!available) {
        Alert.alert(
          "Share unavailable",
          "Sharing is not available on this device.",
        );
        return;
      }

      const localFile = resolveWorkspaceFile(workspaceFile.relativePath);

      if (!localFile.exists) {
        throw new Error("This file is no longer available in the workspace.");
      }

      const mimeType = isTextWorkspaceFile(workspaceFile)
        ? "text/plain"
        : workspaceFile.mimeType || localFile.type || "*/*";

      await Sharing.shareAsync(localFile.uri, {
        dialogTitle: `Share ${workspaceFile.displayName}`,
        mimeType,
        ...(isTextWorkspaceFile(workspaceFile)
          ? { UTI: "public.plain-text" as const }
          : {}),
      });
    } catch (error) {
      if (error instanceof Error && /cancel/i.test(error.message)) {
        return;
      }

      Alert.alert(
        "Share failed",
        error instanceof Error ? error.message : "Failed to share the file.",
      );
    } finally {
      setSharingFileId(null);
    }
  };

  const handleDeleteFile = (workspaceFile: WorkspaceFile) => {
    if (deletingFileId) {
      return;
    }

    Alert.alert(
      "Delete file?",
      `${workspaceFile.displayName} will be permanently deleted.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            setDeletingFileId(workspaceFile.id);
            deleteWorkspaceFile(workspaceFile.id)
              .catch(console.error)
              .finally(() => {
                setDeletingFileId(null);
              });
          },
        },
      ],
    );
  };

  return (
    <Container
      scroll
      contentClassName="gap-sp-4 py-sp-4"
      includeBottomTabInset={false}
      overlay={<HeaderShadow visible={scrolled} />}
      onScroll={(event) => {
        setScrolled(event.nativeEvent.contentOffset.y > 4);
      }}
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
        title="Library"
      />

      <AppTabs
        tabs={CATEGORIES.map((item) => ({ key: item.id, label: item.label }))}
        activeKey={category}
        onChange={(key) => {
          setCategory(key as LibraryCategory);
        }}
      />

      {filteredFiles.length > 0 ? (
        <Card className="overflow-hidden">
          {filteredFiles.map((file, index) => (
            <View key={file.id}>
              {index > 0 ? <Separator /> : null}
              <LibraryFileRow
                file={file}
                opening={openingFileId === file.id}
                sharing={sharingFileId === file.id}
                deleting={deletingFileId === file.id}
                onOpen={() => {
                  handleOpenFile(file).catch(console.error);
                }}
                onShare={() => {
                  handleShareFile(file).catch(console.error);
                }}
                onDelete={() => {
                  handleDeleteFile(file);
                }}
              />
            </View>
          ))}
        </Card>
      ) : (
        <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
          {category === "all"
            ? "No files in the workspace yet. Ask the agent to create files or upload one from the chat screen."
            : `No ${category} in the workspace yet.`}
        </Text>
      )}
    </Container>
  );
}

function LibraryFileRow({
  deleting,
  file,
  onDelete,
  onOpen,
  onShare,
  opening,
  sharing,
}: {
  deleting: boolean;
  file: WorkspaceFile;
  onDelete: () => void;
  onOpen: () => void;
  onShare: () => void;
  opening: boolean;
  sharing: boolean;
}) {
  const theme = useTheme();
  const isImage = file.mimeType?.startsWith("image/");
  const uri = resolveWorkspaceFile(file.relativePath).uri;
  const subtitle = [
    file.mimeType ?? "Unknown type",
    typeof file.size === "number" ? formatBytes(file.size) : null,
    formatDate(file.createdAt),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <View className="flex-row items-center gap-sp-3 px-sp-4 py-sp-3">
      <Pressable
        accessibilityHint="Opens the file"
        accessibilityLabel={file.displayName}
        accessibilityRole="button"
        className="min-w-0 flex-1 flex-row items-center gap-sp-3"
        disabled={opening}
        onPress={onOpen}
        style={({ pressed }) => (pressed ? { opacity: 0.72 } : null)}
      >
        <View className="h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-card bg-secondary dark:bg-secondary-dark">
          {isImage ? (
            <Image
              contentFit="cover"
              source={{ uri }}
              style={{ height: 48, width: 48 }}
            />
          ) : isTextWorkspaceFile(file) ? (
            <FileText color={theme.text} size={20} />
          ) : (
            <FileIcon color={theme.text} size={20} />
          )}
        </View>
        <View className="min-w-0 flex-1 gap-1">
          <Text
            className="font-sans text-base text-foreground dark:text-foreground-dark"
            numberOfLines={1}
          >
            {file.displayName}
          </Text>
          <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
            {subtitle}
          </Text>
        </View>
        {opening ? (
          <ActivityIndicator color={theme.textSecondary} size="small" />
        ) : null}
      </Pressable>
      <RowAction
        accessibilityLabel={`Share ${file.displayName}`}
        busy={sharing}
        icon={<Share2 color={theme.textSecondary} size={18} />}
        onPress={onShare}
      />
      <RowAction
        accessibilityLabel={`Delete ${file.displayName}`}
        busy={deleting}
        icon={<Trash2 color={theme.destructive} size={18} />}
        onPress={onDelete}
      />
    </View>
  );
}

function RowAction({
  accessibilityLabel,
  busy,
  icon,
  onPress,
}: {
  accessibilityLabel: string;
  busy: boolean;
  icon: ReactNode;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      disabled={busy}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => ({
        opacity: busy ? 0.45 : pressed ? 0.7 : 1,
      })}
    >
      {busy ? (
        <ActivityIndicator color={theme.textSecondary} size="small" />
      ) : (
        icon
      )}
    </Pressable>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 ** 2) {
    return `${(bytes / 1024).toFixed(0)} KB`;
  }

  if (bytes < 1024 ** 3) {
    return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  }

  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function formatDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleDateString();
}
