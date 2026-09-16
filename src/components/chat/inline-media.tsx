/**
 * Inline media players for chat attachments and markdown media.
 *
 * - `InlineVideo` plays video URIs with native controls.
 * - `InlineAudio` plays audio URIs with a play/pause toggle and time readout.
 * - `mediaKindForUri` routes a URI to `video` / `audio` / `image` / `file`
 *   by extension (mime types are unreliable for workspace files).
 *
 * Players are created per mounted component via the expo hooks, so each
 * releases automatically on unmount.
 */
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { useVideoPlayer, VideoView } from "expo-video";
import { Pause, Play } from "lucide-react-native";

import { useTheme } from "@/hooks/use-theme";

const VIDEO_EXTENSIONS = [
  ".mp4",
  ".mov",
  ".webm",
  ".avi",
  ".mkv",
  ".m4v",
  ".3gp",
];
const AUDIO_EXTENSIONS = [".mp3", ".wav", ".ogg", ".flac", ".m4a", ".aac"];
const IMAGE_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".heic",
];

export type MediaKind = "video" | "audio" | "image" | "file";

export function mediaKindForUri(uri: string): MediaKind {
  const clean = uri.split("?")[0].toLowerCase();
  if (VIDEO_EXTENSIONS.some((extension) => clean.endsWith(extension))) {
    return "video";
  }
  if (AUDIO_EXTENSIONS.some((extension) => clean.endsWith(extension))) {
    return "audio";
  }
  if (IMAGE_EXTENSIONS.some((extension) => clean.endsWith(extension))) {
    return "image";
  }
  return "file";
}

function formatMediaTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "0:00";
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function InlineVideo({ uri }: { uri: string }) {
  const theme = useTheme();
  const player = useVideoPlayer(uri);
  const [ready, setReady] = useState(false);
  return (
    <View
      className="w-full overflow-hidden rounded-ui border border-border bg-black dark:border-border-dark"
      style={{ aspectRatio: 16 / 9 }}
    >
      {!ready ? (
        <View className="absolute inset-0 items-center justify-center">
          <ActivityIndicator color={theme.textSecondary} size="small" />
        </View>
      ) : null}
      <VideoView
        player={player}
        style={{ width: "100%", height: "100%" }}
        contentFit="contain"
        nativeControls
        onFirstFrameRender={() => {
          setReady(true);
        }}
      />
    </View>
  );
}

export function InlineAudio({
  title,
  uri,
}: {
  title: string;
  uri: string;
}) {
  const theme = useTheme();
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);
  const isPlaying =
    status !== null && "playing" in status ? status.playing : false;

  return (
    <View className="w-full flex-row items-center gap-sp-2 rounded-ui border border-border bg-card px-sp-2 py-sp-2 dark:border-border-dark dark:bg-card-dark">
      <Pressable
        accessibilityLabel={isPlaying ? "Pause audio" : "Play audio"}
        accessibilityRole="button"
        onPress={() => {
          if (isPlaying) {
            player.pause();
          } else {
            player.play();
          }
        }}
        className="h-9 w-9 items-center justify-center rounded-full"
        style={{
          backgroundColor: theme.backgroundSelected,
        }}
      >
        {isPlaying ? (
          <Pause color={theme.text} size={16} />
        ) : (
          <Play color={theme.text} size={16} />
        )}
      </Pressable>
      <View className="min-w-0 flex-1">
        <Text
          numberOfLines={1}
          className="font-sans text-sm font-medium text-foreground dark:text-foreground-dark"
        >
          {title}
        </Text>
        <Text className="font-mono text-xs text-muted-foreground dark:text-muted-foreground-dark">
          {formatMediaTime(status.currentTime)} /{" "}
          {formatMediaTime(status.duration)}
        </Text>
      </View>
    </View>
  );
}
