/**
 * Main/Chat after-chat ellipsis popup: title header + 5 chat actions.
 * Styled after MessageMenu (rounded-2xl popover, icon rows).
 */
import { FileSearch, Files, Pin, PinOff, Share2, Trash2 } from "lucide-react-native";
import { MessageMenu, type MenuAnchor } from "@/components/chat/message-menu";
import { useTheme } from "@/hooks/use-theme";

export function ChatMenuPopup({
  anchor,
  chatTitle,
  onClose,
  onDeletePress,
  onFilesOpen,
  onFindOpen,
  onPinPress,
  onSharePress,
  pinned,
  visible,
}: {
  anchor: MenuAnchor | null;
  chatTitle: string;
  onClose: () => void;
  onDeletePress: () => void;
  onFilesOpen: () => void;
  onFindOpen: () => void;
  onPinPress: () => void;
  onSharePress: () => void;
  pinned: boolean;
  visible: boolean;
}) {
  const theme = useTheme();
  return (
    <MessageMenu
      actions={[
        {
          key: "share",
          label: "Share",
          icon: <Share2 color={theme.text} size={18} />,
          onPress: onSharePress,
        },
        {
          key: "pin",
          label: pinned ? "Unpin" : "Pin",
          icon: pinned ? (
            <PinOff color={theme.text} size={18} />
          ) : (
            <Pin color={theme.text} size={18} />
          ),
          onPress: onPinPress,
        },
        {
          key: "files",
          label: "Uploaded files",
          icon: <Files color={theme.text} size={18} />,
          onPress: onFilesOpen,
        },
        {
          key: "find",
          label: "Find in chat",
          icon: <FileSearch color={theme.text} size={18} />,
          onPress: onFindOpen,
        },
        {
          key: "delete",
          label: "Delete",
          icon: <Trash2 color={theme.destructive} size={18} />,
          destructive: true,
          onPress: onDeletePress,
        },
      ]}
      align="end"
      anchor={anchor}
      dateLabel={chatTitle}
      onClose={onClose}
      visible={visible}
    />
  );
}
