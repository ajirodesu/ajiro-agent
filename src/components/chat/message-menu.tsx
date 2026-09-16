/**
 * Long-press message menu: an adaptive popup with a relative date/time
 * header followed by icon action rows. Positions above, below, or centered
 * on the anchor bubble based on available screen space (see
 * `menu-placement.ts`), so it is never cut off.
 */
import type { ReactNode } from "react";
import { useState } from "react";
import {
  Modal,
  Pressable,
  Text,
  View,
  useWindowDimensions,
} from "react-native";

import { placeMenu, type MenuAnchor } from "@/components/chat/menu-placement";
import { useTheme } from "@/hooks/use-theme";

export type { MenuAnchor };

export type MessageMenuAction = {
  key: string;
  label: string;
  icon: ReactNode;
  destructive?: boolean;
  disabled?: boolean;
  onPress: () => void;
};

const MENU_WIDTH = 240;

export function MessageMenu({
  actions,
  align = "end",
  anchor,
  dateLabel,
  onClose,
  visible,
}: {
  actions: MessageMenuAction[];
  align?: "start" | "end";
  anchor: MenuAnchor | null;
  dateLabel: string;
  onClose: () => void;
  visible: boolean;
}) {
  const theme = useTheme();
  const { height: screenHeight, width: screenWidth } = useWindowDimensions();
  const [menuHeight, setMenuHeight] = useState(0);

  if (!visible || !anchor) {
    return null;
  }
  const placed = placeMenu(
    anchor,
    { width: screenWidth, height: screenHeight },
    { width: MENU_WIDTH, height: Math.max(menuHeight, 1) },
    align,
  );

  return (
    <Modal
      transparent
      animationType="fade"
      visible={visible}
      onRequestClose={onClose}
    >
      <Pressable className="flex-1" onPress={onClose}>
        <View
          onLayout={(event) => {
            setMenuHeight(event.nativeEvent.layout.height);
          }}
          style={{
            position: "absolute",
            top: placed.top,
            left: placed.left,
            width: MENU_WIDTH,
          }}
          className="overflow-hidden rounded-2xl border border-border bg-popover dark:border-border-dark dark:bg-popover-dark"
        >
          <Text className="px-sp-4 py-sp-2 font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
            {dateLabel}
          </Text>
          <View
            style={{ height: 1, backgroundColor: theme.border, opacity: 0.6 }}
          />
          {actions.map((action) => (
            <Pressable
              key={action.key}
              accessibilityLabel={action.label}
              accessibilityRole="button"
              accessibilityState={{ disabled: action.disabled }}
              disabled={action.disabled}
              onPress={() => {
                onClose();
                action.onPress();
              }}
              className="flex-row items-center gap-sp-3 px-sp-4 py-sp-3 active:bg-secondary dark:active:bg-secondary-dark"
              style={action.disabled ? { opacity: 0.4 } : null}
            >
              {action.icon}
              <Text
                className={
                  action.destructive
                    ? "font-sans text-base text-destructive dark:text-destructive-dark"
                    : "font-sans text-base text-foreground dark:text-foreground-dark"
                }
              >
                {action.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </Pressable>
    </Modal>
  );
}
