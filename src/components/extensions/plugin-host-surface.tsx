/**
 * Plugin host surface (prompt §19, §42, §45, §48-§52, §63, §72-§73).
 *
 * One `react-native-webview` document hosts the entry script of every
 * installed extension. It exists because Hermes — Ajiro's JavaScript engine —
 * has no DOM and no dynamic code evaluation, while Acode plugins are written
 * against both. Inside this document a plugin gets a real `window`,
 * `document`, `HTMLElement`, `CustomEvent`, `fetch`, and `URL`; everything it
 * needs from the app (package files, private storage, commands, notifications,
 * installing another extension) travels back as a permission-checked message
 * on the bridge protocol.
 *
 * The document stays mounted for the app's lifetime once an entry-script
 * extension is installed, because plugin state (timers, listeners, pages,
 * command closures) lives inside it and would die with a remount.
 *
 * Nothing here executes plugin code on its own: mounting the document only
 * makes execution *possible*. A plugin runs when the user enables it.
 */
import { TriangleAlert, X } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";

import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { useTheme } from "@/hooks/use-theme";
import {
  getExtensionStore,
  getPluginRuntimeBridge,
  PLUGIN_RUNTIME_GLOBAL,
  serializePluginBridgeInbound,
  subscribeExtensionEvents,
  type ExtensionPermissionKey,
  type PluginBridgeInbound,
  type PluginNotification,
} from "@/modules/extensions";
import { PERMISSION_LABELS } from "@/modules/extensions/permissions";
import { usePluginUiHandler } from "@/components/extensions/plugin-dialogs";

/** How long a plugin notification stays on screen. */
const NOTICE_TIMEOUT_MS = 6_000;

const INSTALL_REFUSED_MESSAGE =
  "Plugin-initiated installs are turned off in Plugins. Enable them there if you want extensions to be able to ask.";

export function PluginHostSurface() {
  const theme = useTheme();
  const bridge = useMemo(() => getPluginRuntimeBridge(), []);
  // Native dialogs, loaders, toasts, the file browser, and new editor
  // files for plugin code (§48). Hooked before the early return below so
  // the hook order stays stable whether the document is needed or not.
  const pluginUi = usePluginUiHandler();
  const [status, setStatus] = useState(() => bridge.status());
  const [needed, setNeeded] = useState(false);
  const [notice, setNotice] = useState<PluginNotification | null>(null);
  const [installRequest, setInstallRequest] = useState<{
    pluginId: string;
    targetId: string;
  } | null>(null);
  const [pendingPermissions, setPendingPermissions] = useState<
    ExtensionPermissionKey[] | null
  >(null);
  const [installBusy, setInstallBusy] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);

  const webViewRef = useRef<WebView>(null);
  const attachedRef = useRef(false);
  const resolverRef = useRef<{
    reject: (error: Error) => void;
    resolve: () => void;
  } | null>(null);

  const document = useMemo(
    () =>
      bridge.buildDocument({
        accent: theme.accent,
        background: theme.background,
        backgroundElement: theme.backgroundElement,
        border: theme.border,
        text: theme.text,
        textSecondary: theme.textSecondary,
      }),
    [bridge, theme],
  );

  const post = useCallback((message: PluginBridgeInbound) => {
    // The document's inbox is a global function; `<` is escaped in the
    // payload so plugin source can never break out of this injected call.
    const script = `window[${JSON.stringify(
      PLUGIN_RUNTIME_GLOBAL,
    )}](${serializePluginBridgeInbound(message)}); true;`;
    webViewRef.current?.injectJavaScript(script);
  }, []);

  /* ------------------------------------------------- execution necessity */

  useEffect(() => {
    let cancelled = false;
    const check = () => {
      bridge
        .hasExecutableExtensions()
        .then((value) => {
          if (!cancelled) setNeeded(value);
        })
        .catch(() => {});
    };
    check();
    const unsubscribe = subscribeExtensionEvents((event) => {
      if (
        event.type === "installed" ||
        event.type === "rolled-back" ||
        event.type === "uninstalled" ||
        event.type === "updated"
      ) {
        check();
      }
      if (event.type === "notification") {
        setNotice({ level: event.level, pluginId: event.pluginId, text: event.text });
      }
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [bridge]);

  useEffect(() => bridge.subscribe(setStatus), [bridge]);

  useEffect(() => {
    bridge.setUiHandler(pluginUi.handler);
    return () => {
      bridge.setUiHandler(null);
    };
  }, [bridge, pluginUi.handler]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  /* ---------------------------------------------------- install consent */

  useEffect(() => {
    bridge.setInstallRequestHandler((pluginId, targetId) => {
      if (!needed) {
        return Promise.reject(new Error("The plugin runtime is not available."));
      }
      return getExtensionStore()
        .preferences.load()
        .then((preferences) => {
          if (!preferences.allowPluginInstallRequests) {
            throw new Error(INSTALL_REFUSED_MESSAGE);
          }
          return new Promise<void>((resolve, reject) => {
            resolverRef.current = { reject, resolve };
            setInstallError(null);
            setPendingPermissions(null);
            setInstallRequest({ pluginId, targetId });
          });
        });
    });
    return () => {
      bridge.setInstallRequestHandler(null);
      resolverRef.current?.reject(
        new Error("The plugin runtime surface was unmounted."),
      );
      resolverRef.current = null;
    };
  }, [bridge, needed]);

  const settleInstall = useCallback((error?: Error) => {
    const resolver = resolverRef.current;
    resolverRef.current = null;
    setInstallRequest(null);
    setPendingPermissions(null);
    if (error) resolver?.reject(error);
    else resolver?.resolve();
  }, []);

  const approveInstall = useCallback(async () => {
    const request = installRequest;
    if (!request) return;
    setInstallBusy(true);
    setInstallError(null);
    try {
      // The same package manager the Store uses, so a plugin-initiated
      // install is validated, staged, and consented exactly like a manual
      // one (§42). Permissions the package needs are shown before the second
      // tap, never silently accepted.
      const outcome = await getExtensionStore().manager.install(
        { kind: "registry", pluginId: request.targetId },
        pendingPermissions ? { acceptedPermissions: pendingPermissions } : {},
      );
      if (outcome.status === "needs-permissions") {
        setPendingPermissions(outcome.pending);
        return;
      }
      if (outcome.status === "needs-dependencies") {
        throw new Error(
          `"${request.targetId}" requires ${outcome.missing.join(", ")}. Install those first.`,
        );
      }
      settleInstall();
    } catch (error) {
      setInstallError(
        error instanceof Error ? error.message : "The installation failed.",
      );
    } finally {
      setInstallBusy(false);
    }
  }, [installRequest, pendingPermissions, settleInstall]);

  /* ------------------------------------------------------- document boot */

  const handleDocumentLoaded = useCallback(() => {
    if (attachedRef.current) return;
    attachedRef.current = true;
    bridge.attachDocument({ post }).catch((error: unknown) => {
      // A document that never reports ready cannot host plugin code; the
      // runtime falls back to declarative activation, so this is a degraded
      // mode rather than an app failure.
      attachedRef.current = false;
      console.warn(
        `[extensions] plugin host document failed to start: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
  }, [bridge, post]);

  useEffect(
    () => () => {
      attachedRef.current = false;
      bridge.detachDocument();
    },
    [bridge],
  );

  const pageVisible = status.page !== null && status.ready;
  if (!needed) return null;

  return (
    <>
      <View
        accessibilityElementsHidden={!pageVisible}
        importantForAccessibility={pageVisible ? "auto" : "no-hide-descendants"}
        pointerEvents={pageVisible ? "auto" : "none"}
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: theme.background,
            opacity: pageVisible ? 1 : 0,
            zIndex: 60,
          },
        ]}
      >
        {pageVisible ? (
          <View
            className="flex-row items-center gap-sp-2 border-b border-border bg-card px-sp-3 py-sp-2 dark:border-border-dark dark:bg-card-dark"
            style={{ paddingTop: 34 }}
          >
            <Text
              className="min-w-0 flex-1 font-sans text-sm font-semibold text-foreground dark:text-foreground-dark"
              numberOfLines={1}
            >
              {status.page?.title ?? "Plugin"}
            </Text>
            <Pressable
              accessibilityLabel="Close plugin page"
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => bridge.hidePage()}
              style={({ pressed }) => (pressed ? { opacity: 0.72 } : null)}
            >
              <X color={theme.text} size={18} />
            </Pressable>
          </View>
        ) : null}
        <WebView
          allowFileAccess={false}
          allowFileAccessFromFileURLs={false}
          allowUniversalAccessFromFileURLs={false}
          domStorageEnabled={false}
          javaScriptCanOpenWindowsAutomatically={false}
          javaScriptEnabled
          mixedContentMode="never"
          onLoadEnd={handleDocumentLoaded}
          onMessage={(event) => bridge.handleMessage(event.nativeEvent.data)}
          originWhitelist={["about:blank", "data:"]}
          ref={webViewRef}
          setSupportMultipleWindows={false}
          // Plugin code may never navigate the document anywhere: it is a
          // blank page whose only I/O is the bridge.
          onShouldStartLoadWithRequest={(request) =>
            /^(about:|data:|blob:)/i.test(request.url)
          }
          source={{ html: document }}
          style={{ backgroundColor: theme.background, flex: 1 }}
        />
      </View>

      {/* Plugin notifications (§63): a quiet inline notice, never a modal. */}
      {notice ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss plugin notification"
          onPress={() => setNotice(null)}
          style={[
            { left: 16, position: "absolute", right: 16, top: 44, zIndex: 70 },
          ]}
        >
          <View className="rounded-card border border-border bg-card px-sp-4 py-sp-3 shadow-sm dark:border-border-dark dark:bg-card-dark">
            <Text className="font-sans text-xs font-semibold text-foreground dark:text-foreground-dark">
              {notice.pluginId}
            </Text>
            <Text
              className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark"
              numberOfLines={3}
            >
              {notice.text}
            </Text>
          </View>
        </Pressable>
      ) : null}

      {/* Plugin dialogs, loaders, and toasts (§48). */}
      {pluginUi.element}

      {/* Consent for `acode.installPlugin` (§42): a plugin can ask, never act. */}
      <Drawer
        onOpenChange={(open) => {
          if (!open) settleInstall(new Error("The install request was dismissed."));
        }}
        open={installRequest !== null}
      >
        <DrawerContent showCloseButton showHandle>
          <DrawerHeader>
            <DrawerTitle>Install {installRequest?.targetId}</DrawerTitle>
            <DrawerDescription>
              {installRequest?.pluginId} asked to install this extension. Nothing
              has been downloaded yet, and the request is refused if you close
              this panel.
            </DrawerDescription>
          </DrawerHeader>
          <DrawerBody contentContainerClassName="gap-sp-2 pb-sp-4">
            {pendingPermissions?.length ? (
              <>
                <Text className="font-sans text-xs font-semibold text-foreground dark:text-foreground-dark">
                  This extension asks for the following capabilities:
                </Text>
                {pendingPermissions.map((key) => (
                  <Text
                    className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark"
                    key={key}
                  >
                    • {key} — {PERMISSION_LABELS[key]}
                  </Text>
                ))}
              </>
            ) : (
              <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                The package is downloaded, validated, and installed disabled. It
                will not run until you enable it yourself.
              </Text>
            )}
            {installError ? (
              <View className="flex-row items-start gap-sp-2">
                <TriangleAlert color={theme.destructive} size={16} strokeWidth={2} />
                <Text className="flex-1 font-sans text-xs text-destructive dark:text-destructive-dark">
                  {installError}
                </Text>
              </View>
            ) : null}
          </DrawerBody>
          <DrawerFooter>
            <Button
              loading={installBusy}
              onPress={() => {
                void approveInstall();
              }}
            >
              {pendingPermissions?.length ? "Allow and install" : "Download and install"}
            </Button>
            <Button
              onPress={() =>
                settleInstall(new Error("The install request was declined."))
              }
              variant="outline"
            >
              Decline
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </>
  );
}
