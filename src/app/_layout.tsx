import { ExtensionCatalogObserver } from "@/components/extensions/catalog-sync-observer";
import { PluginHostSurface } from "@/components/extensions/plugin-host-surface";
import { DismissibleBanner } from "@/components/ui/dismissible-banner";
import { migrateAppDatabase } from "@/core/db/database";
import { useAppState } from "@/hooks/use-app-state";
import { useChat } from "@/hooks/use-chat";
import { useTheme } from "@/hooks/use-theme";
import {
  TOOL_APPROVAL_APPROVE_ACTION_ID,
  TOOL_APPROVAL_REJECT_ACTION_ID,
} from "@/modules/notifications/run-notifications";
import { AppStateProvider } from "@/providers/app-state";
import { UpdateProvider, useUpdate } from "@/providers/check-for-updates";
import { IdeWorkspaceProvider } from "@/providers/ide-workspace";
import { AppQueryProvider } from "@/providers/query-provider";
import * as Notifications from "expo-notifications";
import {
  DarkTheme,
  DefaultTheme,
  router,
  Slot,
  ThemeProvider,
} from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useFonts } from "expo-font";
import {
  Geist_400Regular,
  Geist_500Medium,
  Geist_600SemiBold,
  Geist_700Bold,
} from "@expo-google-fonts/geist";
import {
  GeistMono_400Regular,
  GeistMono_500Medium,
} from "@expo-google-fonts/geist-mono";
import { SQLiteProvider } from "expo-sqlite";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { X } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { Image } from "expo-image";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { useColorScheme } from "@/hooks/use-color-scheme";
import {
  SPLASH_FADE_OUT_MS,
  SPLASH_MARK_WIDTH_FRACTION,
} from "@/launch/splash";
import "./global.css";

SplashScreen.preventAutoHideAsync();

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const data = notification.request.content.data as
      | { type?: string }
      | null;
    const alertKind = data?.type;

    return {
      shouldPlaySound:
        alertKind === "tool-approval" || alertKind === "run-finished",
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    };
  },
});

function NotificationObserver() {
  const { resolveNotificationApproval, selectConversation } = useChat();
  const callbacksRef = useRef({
    resolveNotificationApproval,
    selectConversation,
  });
  callbacksRef.current = { resolveNotificationApproval, selectConversation };

  useEffect(() => {
    function openConversation(
      notification: Notifications.Notification | null | undefined,
    ) {
      const conversationId = notification?.request.content.data?.conversationId;

      if (typeof conversationId === "string") {
        callbacksRef.current
          .selectConversation(conversationId)
          .then(() => {
            router.push("/");
          })
          .catch(console.error);
      }
    }

    function handleResponse(
      response: Notifications.NotificationResponse | null | undefined,
    ) {
      if (!response?.notification) {
        return;
      }

      const data = response.notification.request.content.data as
        | { approvalId?: string; runId?: string; type?: string }
        | null;

      if (
        data?.type === "tool-approval" &&
        response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER
      ) {
        if (
          typeof data.runId === "string" &&
          typeof data.approvalId === "string"
        ) {
          if (
            response.actionIdentifier === TOOL_APPROVAL_APPROVE_ACTION_ID
          ) {
            void callbacksRef.current.resolveNotificationApproval({
              approvalId: data.approvalId,
              decision: "approve",
              runId: data.runId,
            });
          } else if (
            response.actionIdentifier === TOOL_APPROVAL_REJECT_ACTION_ID
          ) {
            void callbacksRef.current.resolveNotificationApproval({
              approvalId: data.approvalId,
              decision: "deny",
              runId: data.runId,
            });
          }
        }

        return;
      }

      openConversation(response.notification);
    }

    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        handleResponse(response);
        Notifications.clearLastNotificationResponseAsync().catch(() => {});
      })
      .catch(() => {});

    const subscription = Notifications.addNotificationResponseReceivedListener(
      handleResponse,
    );

    return () => {
      subscription.remove();
    };
  }, []);

  return null;
}

function InAppNotificationBanner() {
  const theme = useTheme();
  const { dismissInAppNotification, inAppNotification } = useAppState();
  const { currentConversation, selectConversation } = useChat();

  useEffect(() => {
    if (!inAppNotification) {
      return;
    }

    const timeout = setTimeout(() => {
      dismissInAppNotification();
    }, 3500);

    return () => {
      clearTimeout(timeout);
    };
  }, [dismissInAppNotification, inAppNotification]);

  if (!inAppNotification) {
    return null;
  }

  return (
    <View className="absolute inset-x-0 top-0 z-50 px-sp-4 pt-12">
      <DismissibleBanner onDismiss={dismissInAppNotification}>
        <Pressable
          accessibilityRole="button"
          className="rounded-card border border-border bg-card px-sp-4 py-sp-3 shadow-sm dark:border-border-dark dark:bg-card-dark"
          onPress={() => {
            if (currentConversation?.id !== inAppNotification.conversationId) {
              selectConversation(inAppNotification.conversationId)
                .then(() => {
                  router.push("/");
                })
                .catch(console.error);
            }

            dismissInAppNotification();
          }}
          style={({ pressed }) => (pressed ? { opacity: 0.92 } : null)}
        >
          <View className="flex-row items-start gap-sp-3">
            <View className="min-w-0 flex-1 gap-1">
              <Text className="font-sans text-sm font-semibold text-foreground dark:text-foreground-dark">
                {inAppNotification.title}
              </Text>
              <Text
                className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark"
                numberOfLines={2}
              >
                {inAppNotification.body}
              </Text>
            </View>
            <Pressable
              accessibilityLabel="Dismiss notification"
              accessibilityRole="button"
              className="p-1"
              hitSlop={8}
              onPress={dismissInAppNotification}
              style={({ pressed }) => (pressed ? { opacity: 0.72 } : null)}
            >
              <X color={theme.textSecondary} size={16} />
            </Pressable>
          </View>
        </Pressable>
      </DismissibleBanner>
    </View>
  );
}

function ReleaseUpdateBanner() {
  const theme = useTheme();
  const { release, bannerDismissed, installing, installUpdate, dismissUpdate } =
    useUpdate();

  if (!release || bannerDismissed) return null;
  return (
    <View className="absolute inset-x-0 top-10 z-50 px-sp-4 pb-10">
      <DismissibleBanner onDismiss={dismissUpdate}>
        <View className="rounded-card border border-border bg-card px-sp-4 py-sp-3 shadow-sm dark:border-border-dark dark:bg-card-dark">
          <View className="flex-row items-start gap-sp-3">
            <Pressable
              accessibilityRole="button"
              className="min-w-0 flex-1 gap-1"
              disabled={installing}
              onPress={installUpdate}
            >
              <Text className="font-sans text-sm font-semibold text-foreground dark:text-foreground-dark">
                Update available: {release.tagName}
              </Text>
              <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                {installing
                  ? `Downloading ${release.apkName}…`
                  : `You have ${release.currentVersion}. Tap to update.`}
              </Text>
            </Pressable>
            <Pressable
              accessibilityLabel="Dismiss update"
              accessibilityRole="button"
              className="p-1"
              hitSlop={8}
              onPress={dismissUpdate}
            >
              <X color={theme.textSecondary} size={16} />
            </Pressable>
          </View>
        </View>
      </DismissibleBanner>
    </View>
  );
}

/**
 * Brand typefaces, loaded before first paint and held behind the splash.
 * A load failure never blocks launch: the font stacks fall back to system
 * typefaces (declared alongside every Geist family).
 */
export function useBrandFonts(): boolean {
  const [loaded, error] = useFonts({
    Geist_400Regular,
    Geist_500Medium,
    Geist_600SemiBold,
    Geist_700Bold,
    GeistMono_400Regular,
    GeistMono_500Medium,
  });
  useEffect(() => {
    if (error) console.warn("[fonts] Geist failed to load, using system fallback.", error);
  }, [error]);
  return loaded || !!error;
}

function SplashScreenController({ ready }: { ready: boolean }) {
  useEffect(() => {
    if (ready) SplashScreen.hide();
  }, [ready]);

  return null;
}

function ThemedSplashOverlay() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const opacity = useRef(new Animated.Value(1)).current;
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const animation = Animated.timing(opacity, {
      toValue: 0,
      duration: SPLASH_FADE_OUT_MS,
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (finished) setGone(true);
    });
    return () => {
      animation.stop();
    };
  }, [opacity]);

  if (gone) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        { ...StyleSheet.absoluteFill },
        { backgroundColor: theme.background, opacity, zIndex: 100 },
      ]}
    >
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <Image
          source={require("../../assets/images/new-splash-icon.png")}
          style={{
            width: width * SPLASH_MARK_WIDTH_FRACTION,
            aspectRatio: 1,
          }}
          contentFit="contain"
        />
      </View>
    </Animated.View>
  );
}

export default function MainLayout() {
  // The resolved color scheme comes from the shared css-interop observable.
  // ThemePreferenceController (in AppStateProvider) sets it from the user's
  // Theme preference ("system" | "light" | "dark"); before that it follows the
  // device appearance. Subscribing here lets the native chrome (expo-router
  // theme, status bar, system background) stay in sync with the app content.
  const scheme = useColorScheme();
  const isDark = scheme === "dark";
  const fontsReady = useBrandFonts();

  useEffect(() => {
    SystemUI.setBackgroundColorAsync(
      isDark ? "#000000" : "#FFFFFF",
    ).catch(console.error);
  }, [isDark]);

  return (
    <GestureHandlerRootView
      style={{ flex: 1, backgroundColor: isDark ? "#000000" : "#FFFFFF" }}
    >
      <KeyboardProvider>
        <ThemeProvider value={isDark ? DarkTheme : DefaultTheme}>
          <StatusBar style={isDark ? "light" : "dark"} />
          <AppQueryProvider>
            <SQLiteProvider
              databaseName="ajiro-agent.db"
              onInit={migrateAppDatabase}
            >
              <AppStateProvider>
                <IdeWorkspaceProvider>
                  <UpdateProvider>
                    <SplashScreenController ready={fontsReady} />
                    <NotificationObserver />
                    <ExtensionCatalogObserver />
                    <InAppNotificationBanner />
                    <ReleaseUpdateBanner />
                    <Slot />
                    {/* The DOM documents plugin entry scripts execute in.
                        Mounted once, above the router, so plugin pages can
                        show over any screen (§48/§49). */}
                    <PluginHostSurface />
                    <ThemedSplashOverlay />
                  </UpdateProvider>
                </IdeWorkspaceProvider>
              </AppStateProvider>
            </SQLiteProvider>
          </AppQueryProvider>
        </ThemeProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
