/**
 * Web Preview CodeMirror surface: read-only snapshot of the document open
 * at mount time. The xterm-style WebView bridge (postMessage document
 * sync) has no browser equivalent that preserves edit fidelity, so this
 * variant deliberately never reports ready and drops inbound edits — the
 * parent queues them instead of losing keystrokes. File contents stay
 * authoritative in the workspace; nothing here installs, enables, or runs
 * anything.
 */
import { useImperativeHandle } from "react";
import { ScrollView, Text, View } from "react-native";

import { NativeViewUnavailable } from "@/components/ui/native-unavailable";
import type {
  CodeMirrorWebViewProps,
  CodeMirrorWebViewRef,
} from "@/editor/CodeMirrorWebView";

// Re-exported so type consumers resolve identically on both platforms.
export type {
  CodeMirrorWebViewProps,
  CodeMirrorWebViewRef,
} from "@/editor/CodeMirrorWebView";

export function CodeMirrorWebView({
  initialDoc,
  ref,
}: CodeMirrorWebViewProps & {
  ref?: React.Ref<CodeMirrorWebViewRef>;
}): React.JSX.Element {
  useImperativeHandle(
    ref,
    () => ({
      postInbound: () => {},
    }),
    [],
  );

  return (
    <View className="min-h-0 flex-1">
      <NativeViewUnavailable
        title="Read-only preview"
        detail="Editing needs the Android app build. This snapshot does not update as the file changes."
      />
      <ScrollView className="min-h-0 flex-1 px-sp-3 py-sp-2">
        <Text selectable className="font-mono text-xs text-foreground dark:text-foreground-dark">
          {initialDoc}
        </Text>
      </ScrollView>
    </View>
  );
}
