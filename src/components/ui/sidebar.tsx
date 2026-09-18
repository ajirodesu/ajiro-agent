import { PanelLeft, X } from "lucide-react-native";
import {
  cloneElement,
  createContext,
  forwardRef,
  isValidElement,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ComponentPropsWithoutRef,
  type ComponentRef,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  Pressable,
  Modal as ReactNativeModal,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
  type GestureResponderEvent,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  FadeIn,
  FadeInLeft,
  FadeInRight,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { cn } from "@/core/utils";
import { useTheme } from "@/hooks/use-theme";
import {
  expandedSidebarWidth,
  SIDEBAR_COMPACT_WIDTH,
} from "@/components/ui/responsive";

type SidebarContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  side: "left" | "right";
  /**
   * Persistent (tablet/desktop) sidebar density. False = normal expanded
   * state with icons + labels; true = compact icon-only rail. The mobile
   * overlay drawer ignores this. Defaults to expanded.
   */
  compact: boolean;
  setCompact: (compact: boolean) => void;
};

const SidebarContext = createContext<SidebarContextValue | null>(null);

function useSidebarContext(name: string) {
  const context = useContext(SidebarContext);

  if (!context) {
    throw new Error(`${name} must be used within a SidebarProvider`);
  }

  return context;
}

function useControllableState({
  defaultValue,
  onChange,
  value,
}: {
  defaultValue: boolean;
  onChange?: (value: boolean) => void;
  value?: boolean;
}) {
  const [internalValue, setInternalValue] = useState(defaultValue);
  const isControlled = value !== undefined;
  const currentValue = isControlled ? value : internalValue;

  const setValue = (nextValue: boolean) => {
    if (!isControlled) {
      setInternalValue(nextValue);
    }

    onChange?.(nextValue);
  };

  return [currentValue, setValue] as const;
}

function slotPressableChild(
  child: ReactNode,
  props: ComponentPropsWithoutRef<typeof Pressable> & { className?: string },
) {
  if (!isValidElement(child)) {
    return null;
  }

  const element = child as ReactElement<
    ComponentPropsWithoutRef<typeof Pressable> & {
      className?: string;
      onPress?: (event: GestureResponderEvent) => void;
    }
  >;
  const childProps = (element.props ?? {}) as ComponentPropsWithoutRef<
    typeof Pressable
  > & {
    className?: string;
    onPress?: (event: GestureResponderEvent) => void;
  };

  return cloneElement(element, {
    ...props,
    ...childProps,
    className: cn(props.className, childProps.className),
    onPress: (event: GestureResponderEvent) => {
      props.onPress?.(event);
      childProps.onPress?.(event);
    },
  });
}

export type SidebarProviderProps = {
  children: ReactNode;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
  side?: "left" | "right";
};

export function SidebarProvider({
  children,
  defaultOpen = false,
  onOpenChange,
  open,
  side = "left",
}: SidebarProviderProps) {
  const [isOpen, setIsOpen] = useControllableState({
    defaultValue: defaultOpen,
    onChange: onOpenChange,
    value: open,
  });
  const [compact, setCompact] = useState(false);

  const value = useMemo(
    () => ({
      open: isOpen,
      setOpen: setIsOpen,
      side,
      compact,
      setCompact,
    }),
    [isOpen, setIsOpen, side, compact],
  );

  return (
    <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>
  );
}

/**
 * Shared sidebar open-state hook. Screens rendered inside the SidebarProvider
 * (via expo-router Slot) can use this to open/close the drawer, e.g. to
 * re-open it when the user navigates back from a screen launched here.
 */
export function useSidebar() {
  return useSidebarContext("useSidebar");
}

export type SidebarTriggerProps = Omit<
  ComponentPropsWithoutRef<typeof Pressable>,
  "children"
> & {
  asChild?: boolean;
  children?: ReactNode;
  className?: string;
};

export const SidebarTrigger = forwardRef<
  ComponentRef<typeof Pressable>,
  SidebarTriggerProps
>(({ asChild = false, children, className, onPress, ...props }, ref) => {
  const { open, setOpen } = useSidebarContext("SidebarTrigger");
  const theme = useTheme();

  const handlePress: ComponentPropsWithoutRef<typeof Pressable>["onPress"] = (
    event,
  ) => {
    onPress?.(event);
    setOpen(!open);
  };

  if (asChild) {
    return slotPressableChild(children, {
      ...props,
      className,
      onPress: handlePress,
    });
  }

  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      className={cn(
        "h-12 w-12 items-center justify-center rounded-full border border-border bg-background dark:border-border-dark dark:bg-background-dark",
        className,
      )}
      onPress={handlePress}
      style={({ pressed }) => (pressed ? { opacity: 0.9 } : null)}
      {...props}
    >
      {children ? (
        typeof children === "string" || typeof children === "number" ? (
          <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
            {children}
          </Text>
        ) : (
          children
        )
      ) : (
        <PanelLeft color={theme.text} size={20} />
      )}
    </Pressable>
  );
});

SidebarTrigger.displayName = "SidebarTrigger";

export type SidebarProps = ComponentPropsWithoutRef<typeof View> & {
  children: ReactNode;
  closeOnOverlayPress?: boolean;
  overlayClassName?: string;
  showCloseButton?: boolean;
  width?: number;
  /**
   * "overlay" (default) is the fullscreen mobile drawer in a Modal.
   * "persistent" is the tablet/desktop sidebar: always mounted in normal
   * flow, resizing the content beside it via flexbox (never an overlay),
   * with an animated width that follows the compact rail state.
   */
  variant?: "overlay" | "persistent";
};

export const Sidebar = forwardRef<ComponentRef<typeof View>, SidebarProps>(
  (
    {
      children,
      className,
      closeOnOverlayPress = true,
      overlayClassName,
      showCloseButton = false,
      style,
      variant = "overlay",
      width = 320,
      ...props
    },
    ref,
  ) => {
    const { compact, open, setOpen, side } = useSidebarContext("Sidebar");
    const insets = useSafeAreaInsets();
    const reduceMotion = useReducedMotion();
    const theme = useTheme();
    const { width: viewportWidth } = useWindowDimensions();

    // Fullscreen page: the panel spans the viewport. Swipe-left to close
    // tracks the finger on the UI thread (vsync) with native touch
    // sampling via the gesture handler — no JS-thread involvement.
    // (Hooks stay above the early return so open/close never reorders them.)
    const dragX = useSharedValue(0);

    // Persistent width follows the compact rail state with a timed
    // transition; flexbox beside it resizes content for free, so nothing
    // can overflow or jump outside the viewport.
    const persistentTargetWidth = compact
      ? SIDEBAR_COMPACT_WIDTH
      : expandedSidebarWidth(viewportWidth);
    const persistentWidth = useSharedValue(persistentTargetWidth);
    useEffect(() => {
      persistentWidth.value = reduceMotion
        ? persistentTargetWidth
        : withTiming(persistentTargetWidth, { duration: 220 });
    }, [persistentTargetWidth, persistentWidth, reduceMotion]);
    const persistentStyle = useAnimatedStyle(() => ({
      width: persistentWidth.value,
    }));

    // Fullscreen: the sidebar is a page, not a peeking drawer.
    const panelWidth = viewportWidth;
    void width;

    const persistentPanel = (
      <Animated.View
        ref={ref}
        className={cn(
          "border-border bg-sidebar dark:border-border-dark dark:bg-sidebar-dark",
          // Compact rail needs tighter gutters: 76px rail minus 16px
          // padding leaves 60px for 48px buttons; the full 24px gutters
          // would clip them.
          compact ? "px-sp-2" : "px-sp-4",
          side === "left" ? "border-r" : "border-l",
          className,
        )}
        style={[
          {
            paddingTop: insets.top + 12,
            paddingBottom: insets.bottom + 12,
          },
          persistentStyle,
          style,
        ]}
        {...props}
      >
        <View className="flex-1 gap-sp-2">{children}</View>
      </Animated.View>
    );

    const close = () => {
      setOpen(false);
    };

    const pan = Gesture.Pan()
      .activeOffsetX([-14, 14])
      .failOffsetY([-14, 14])
      .onUpdate((event) => {
        // Only leftward motion moves the page; rightward stays pinned.
        dragX.value = Math.min(0, event.translationX);
      })
      .onEnd((event) => {
        const width = panelWidth;
        const flingLeft = event.velocityX < -900;
        if (flingLeft || dragX.value < -width * 0.28) {
          dragX.value = withTiming(-width, { duration: 140 }, (finished) => {
            if (finished) runOnJS(close)();
          });
        } else {
          dragX.value = withSpring(0, { stiffness: 320, damping: 30 });
        }
      });

    const dragStyle = useAnimatedStyle(() => ({
      transform: [{ translateX: dragX.value }],
    }));

    // A gesture-dismiss leaves the offset off-screen; reset for next open.
    useEffect(() => {
      if (open) dragX.value = 0;
    }, [open, dragX]);

    // Persistent sidebar ignores the modal open state: it is always
    // mounted in normal flow (visible by default on tablet/desktop).
    if (variant === "persistent") {
      return persistentPanel;
    }

    if (!open) {
      return null;
    }

    return (
      <ReactNativeModal
        animationType="none"
        onRequestClose={() => setOpen(false)}
        statusBarTranslucent
        transparent
        visible={open}
      >
        <View
          className={cn(
            "flex-1 flex-row",
            side === "right" ? "justify-end" : "justify-start",
          )}
        >
          <Animated.View
            className="absolute inset-0"
            entering={reduceMotion ? undefined : FadeIn.duration(160)}
          >
            <Pressable
              className={cn("flex-1 bg-black/50", overlayClassName)}
              onPress={closeOnOverlayPress ? () => setOpen(false) : undefined}
            />
          </Animated.View>
          <Animated.View
            ref={ref}
            className={cn(
              "border-border bg-sidebar px-sp-4 dark:border-border-dark dark:bg-sidebar-dark",
              side === "left" ? "border-r" : "border-l",
              className,
            )}
            style={[
              {
                width: panelWidth,
                paddingTop: insets.top + 12,
                paddingBottom: insets.bottom + 12,
              },
              style,
            ]}
            entering={
              reduceMotion
                ? undefined
                : side === "right"
                  ? FadeInRight.duration(190).withInitialValues({
                      opacity: 0,
                      translateX: 20,
                    })
                  : FadeInLeft.duration(190).withInitialValues({
                      opacity: 0,
                      translateX: -20,
                    })
            }
            {...props}
          >
            {showCloseButton ? (
              <View
                className="absolute right-sp-3 z-10"
                style={{ top: insets.top + 10 }}
              >
                <Pressable
                  accessibilityLabel="Close sidebar"
                  accessibilityRole="button"
                  className="h-10 w-10 items-center justify-center rounded-full bg-secondary dark:bg-secondary-dark"
                  onPress={() => setOpen(false)}
                  style={({ pressed }) => (pressed ? { opacity: 0.72 } : null)}
                >
                  <X color={theme.text} size={18} />
                </Pressable>
              </View>
            ) : null}
            <GestureDetector gesture={pan}>
              <Animated.View style={[{ flex: 1 }, dragStyle]}>
                <View className="flex-1 gap-sp-2">{children}</View>
              </Animated.View>
            </GestureDetector>
          </Animated.View>
        </View>
      </ReactNativeModal>
    );
  },
);

Sidebar.displayName = "Sidebar";

export type SidebarInsetProps = ComponentPropsWithoutRef<typeof View> & {
  className?: string;
};

export const SidebarInset = forwardRef<
  ComponentRef<typeof View>,
  SidebarInsetProps
>(({ className, ...props }, ref) => (
  <View ref={ref} className={cn("flex-1", className)} {...props} />
));

SidebarInset.displayName = "SidebarInset";

export type SidebarHeaderProps = ComponentPropsWithoutRef<typeof View> & {
  className?: string;
};

export const SidebarHeader = forwardRef<
  ComponentRef<typeof View>,
  SidebarHeaderProps
>(({ className, ...props }, ref) => (
  <View ref={ref} className={cn("gap-sp-3 pb-sp-2", className)} {...props} />
));

SidebarHeader.displayName = "SidebarHeader";

export type SidebarContentProps = ComponentPropsWithoutRef<
  typeof ScrollView
> & {
  className?: string;
};

export const SidebarContent = forwardRef<
  ComponentRef<typeof ScrollView>,
  SidebarContentProps
>(({ className, ...props }, ref) => (
  <ScrollView
    ref={ref}
    className={cn("flex-1", className)}
    contentContainerClassName="gap-sp-3"
    showsVerticalScrollIndicator={false}
    {...props}
  />
));

SidebarContent.displayName = "SidebarContent";

export type SidebarFooterProps = ComponentPropsWithoutRef<typeof View> & {
  className?: string;
};

/**
 * Sticky bottom bar: absolutely positioned so scrollable content flows
 * underneath it (callers add matching bottom padding to the scroll content).
 */
export const SidebarFooter = forwardRef<
  ComponentRef<typeof View>,
  SidebarFooterProps
>(({ className, style, ...props }, ref) => (
  <View
    ref={ref}
    className={cn(
      "absolute inset-x-0 bottom-0 gap-sp-3 px-sp-4 pb-sp-2 pt-sp-2",
      className,
    )}
    style={style}
    {...props}
  />
));

SidebarFooter.displayName = "SidebarFooter";

export type SidebarGroupProps = ComponentPropsWithoutRef<typeof View> & {
  className?: string;
};

export const SidebarGroup = forwardRef<
  ComponentRef<typeof View>,
  SidebarGroupProps
>(({ className, ...props }, ref) => (
  <View ref={ref} className={cn("gap-sp-2", className)} {...props} />
));

SidebarGroup.displayName = "SidebarGroup";

export type SidebarGroupLabelProps = ComponentPropsWithoutRef<typeof Text> & {
  className?: string;
};

export const SidebarGroupLabel = forwardRef<
  ComponentRef<typeof Text>,
  SidebarGroupLabelProps
>(({ className, ...props }, ref) => (
  <Text
    ref={ref}
    className={cn(
      "px-sp-2 font-sans text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground dark:text-muted-foreground-dark",
      className,
    )}
    {...props}
  />
));

SidebarGroupLabel.displayName = "SidebarGroupLabel";

export type SidebarGroupActionProps = Omit<
  ComponentPropsWithoutRef<typeof Pressable>,
  "children"
> & {
  children?: ReactNode;
  className?: string;
};

export const SidebarGroupAction = forwardRef<
  ComponentRef<typeof Pressable>,
  SidebarGroupActionProps
>(({ children, className, ...props }, ref) => (
  <Pressable
    ref={ref}
    accessibilityRole="button"
    className={cn("items-start px-sp-2", className)}
    {...props}
  >
    {typeof children === "string" || typeof children === "number" ? (
      <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
        {children}
      </Text>
    ) : (
      children
    )}
  </Pressable>
));

SidebarGroupAction.displayName = "SidebarGroupAction";

export type SidebarGroupContentProps = ComponentPropsWithoutRef<typeof View> & {
  className?: string;
};

export const SidebarGroupContent = forwardRef<
  ComponentRef<typeof View>,
  SidebarGroupContentProps
>(({ className, ...props }, ref) => (
  <View ref={ref} className={cn("gap-1", className)} {...props} />
));

SidebarGroupContent.displayName = "SidebarGroupContent";

export type SidebarMenuProps = ComponentPropsWithoutRef<typeof View> & {
  className?: string;
};

export const SidebarMenu = forwardRef<
  ComponentRef<typeof View>,
  SidebarMenuProps
>(({ className, ...props }, ref) => (
  <View ref={ref} className={cn("gap-1", className)} {...props} />
));

SidebarMenu.displayName = "SidebarMenu";

export type SidebarMenuItemProps = ComponentPropsWithoutRef<typeof View> & {
  className?: string;
};

export const SidebarMenuItem = forwardRef<
  ComponentRef<typeof View>,
  SidebarMenuItemProps
>(({ className, ...props }, ref) => (
  <View ref={ref} className={cn("gap-1", className)} {...props} />
));

SidebarMenuItem.displayName = "SidebarMenuItem";

export type SidebarMenuButtonProps = Omit<
  ComponentPropsWithoutRef<typeof Pressable>,
  "children"
> & {
  asChild?: boolean;
  children?: ReactNode;
  className?: string;
  /** Full-width, zero-radius row highlight (spans the panel's padding gutters). */
  fullBleed?: boolean;
  isActive?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
};

export const SidebarMenuButton = forwardRef<
  ComponentRef<typeof Pressable>,
  SidebarMenuButtonProps
>(
  (
    {
      asChild = false,
      children,
      className,
      disabled,
      fullBleed = false,
      isActive = false,
      leftIcon,
      rightIcon,
      ...props
    },
    ref,
  ) => {
    const layoutClassName = fullBleed
      ? "-mx-sp-4 min-h-12 flex-row items-center gap-sp-3 rounded-none px-sp-4 py-sp-3"
      : "min-h-12 flex-row items-center gap-sp-3 rounded-2xl px-sp-3 py-sp-3";

    if (asChild) {
      return slotPressableChild(children, {
        ...props,
        className: cn(
          layoutClassName,
          isActive ? "bg-sidebar-element dark:bg-sidebar-element-dark" : "bg-transparent",
          disabled && "opacity-50",
          className,
        ),
      });
    }

    return (
      <Pressable
        ref={ref}
        accessibilityRole="button"
        className={cn(
          layoutClassName,
          isActive
            ? "bg-sidebar-element dark:bg-sidebar-element-dark"
            : "bg-transparent",
          disabled && "opacity-50",
          className,
        )}
        disabled={disabled}
        style={({ pressed }) =>
          pressed && !disabled ? { opacity: 0.9 } : null
        }
        {...props}
      >
        <View className="z-10 flex-1 flex-row items-center gap-sp-3">
          {leftIcon ? <View>{leftIcon}</View> : null}
          <View className="min-w-0 flex-1">
            {typeof children === "string" || typeof children === "number" ? (
              <Text
                className={cn(
                  "font-sans text-base font-medium",
                  isActive
                    ? "text-foreground dark:text-foreground-dark"
                    : "text-foreground dark:text-foreground-dark",
                )}
              >
                {children}
              </Text>
            ) : (
              children
            )}
          </View>
          {rightIcon ? <View>{rightIcon}</View> : null}
        </View>
      </Pressable>
    );
  },
);

SidebarMenuButton.displayName = "SidebarMenuButton";

export type SidebarMenuBadgeProps = ComponentPropsWithoutRef<typeof Text> & {
  className?: string;
};

export const SidebarMenuBadge = forwardRef<
  ComponentRef<typeof Text>,
  SidebarMenuBadgeProps
>(({ className, ...props }, ref) => (
  <Text
    ref={ref}
    className={cn(
      "rounded-pill bg-secondary px-sp-2 py-1 font-sans text-xs font-medium text-foreground dark:bg-secondary-dark dark:text-foreground-dark",
      className,
    )}
    {...props}
  />
));

SidebarMenuBadge.displayName = "SidebarMenuBadge";

export type SidebarCloseProps = Omit<
  ComponentPropsWithoutRef<typeof Pressable>,
  "children"
> & {
  asChild?: boolean;
  children?: ReactNode;
  className?: string;
};

export const SidebarClose = forwardRef<
  ComponentRef<typeof Pressable>,
  SidebarCloseProps
>(({ asChild = false, children, className, onPress, ...props }, ref) => {
  const { setOpen } = useSidebarContext("SidebarClose");

  const handlePress: ComponentPropsWithoutRef<typeof Pressable>["onPress"] = (
    event,
  ) => {
    onPress?.(event);
    setOpen(false);
  };

  if (asChild) {
    return slotPressableChild(children, {
      ...props,
      className,
      onPress: handlePress,
    });
  }

  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      className={cn("items-start", className)}
      onPress={handlePress}
      {...props}
    >
      {typeof children === "string" || typeof children === "number" ? (
        <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
          {children}
        </Text>
      ) : (
        children
      )}
    </Pressable>
  );
});

SidebarClose.displayName = "SidebarClose";
