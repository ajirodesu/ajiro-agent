/**
 * Delete-chat confirmation drawer for the Main/Chat ellipsis menu.
 */
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";

export function DeleteChatDrawer({
  chatTitle,
  onCancel,
  onConfirm,
  open,
}: {
  chatTitle: string;
  onCancel: () => void;
  onConfirm: () => void;
  open: boolean;
}) {
  return (
    <Drawer
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
      open={open}
    >
      <DrawerContent showCloseButton showHandle size={360}>
        <DrawerHeader>
          <DrawerTitle>Delete chat?</DrawerTitle>
          <DrawerDescription>
            {`"${chatTitle}" and all of its messages will be deleted. This cannot be undone.`}
          </DrawerDescription>
        </DrawerHeader>
        <DrawerFooter>
          <View className="flex-row gap-sp-2">
            <Button className="flex-1" onPress={onCancel} variant="outline">
              Cancel
            </Button>
            <Button className="flex-1" onPress={onConfirm} variant="destructive">
              Delete
            </Button>
          </View>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
