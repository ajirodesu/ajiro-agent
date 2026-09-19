/**
 * Uploaded-files drawer for the Main/Chat ellipsis menu.
 */
import { Text, View } from "react-native";
import { Paperclip } from "lucide-react-native";
import type { ChatUploadedFile } from "@/components/chat/chat-header-menu";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { useTheme } from "@/hooks/use-theme";

export function UploadedFilesDrawer({
  chatTitle,
  files,
  onOpenChange,
  open,
}: {
  chatTitle: string;
  files: ChatUploadedFile[];
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const theme = useTheme();
  return (
    <Drawer onOpenChange={onOpenChange} open={open}>
      <DrawerContent showCloseButton showHandle size={480}>
        <DrawerHeader>
          <DrawerTitle>Uploaded files</DrawerTitle>
          <DrawerDescription>{`Files attached to "${chatTitle}".`}</DrawerDescription>
        </DrawerHeader>
        <DrawerBody contentContainerClassName="gap-sp-2 pb-sp-4">
          {files.length === 0 ? (
            <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
              No files uploaded in this chat yet. Attach files from the
              composer to see them here.
            </Text>
          ) : (
            files.map((file) => (
              <View
                key={file.id}
                className="flex-row items-center gap-sp-3 rounded-ui border border-border bg-card px-sp-3 py-sp-2 dark:border-border-dark dark:bg-card-dark"
              >
                <Paperclip
                  color={theme.textSecondary}
                  size={18}
                  strokeWidth={2}
                />
                <View className="min-w-0 flex-1">
                  <Text
                    numberOfLines={1}
                    className="font-sans text-sm font-medium text-foreground dark:text-foreground-dark"
                  >
                    {file.displayName}
                  </Text>
                  {file.subtitle ? (
                    <Text className="font-mono text-xs text-muted-foreground dark:text-muted-foreground-dark">
                      {file.subtitle}
                    </Text>
                  ) : null}
                </View>
              </View>
            ))
          )}
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
