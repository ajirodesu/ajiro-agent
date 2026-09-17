/**
 * App-side renderer for plugin dialogs, loaders, and toasts (prompt §48).
 *
 * Acode renders `alert`/`confirm`/`prompt`/`select`/`multiPrompt`/`loader`
 * as DOM overlays and `toast` as a transient message (verified against
 * `src/dialogs/*` + `src/lib/acode.js`). Ajiro renders them with native
 * UI instead: `alert`/`confirm` go through `Alert`, the input dialogs go
 * through a bottom drawer, the loader is a fullscreen overlay, and toasts
 * are transient notices. Dialogs are served serially — one visible at a
 * time — so two plugins can never stack blocking UI on each other.
 *
 * Nothing here executes plugin code: it only resolves the promises the
 * bridge host already created, with values shaped exactly like the payloads
 * `bridge-protocol.ts` documents. Dialog answers are never logged.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

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
import { Input } from "@/components/ui/input";
import { createExternalFolderService } from "@/core/services/external-folder/external-folder-service";
import { useTheme } from "@/hooks/use-theme";
import {
  normalizeNewFileName,
  PLUGIN_DIALOG_CANCELLED,
  type PluginDialogKind,
  type PluginDialogPayload,
  type PluginMultiPromptInput,
  type PluginSelectOption,
  type PluginUiHandler,
} from "@/modules/extensions";
import { useIdeWorkspace } from "@/providers/ide-workspace";

type PendingDialog = {
  id: number;
  kind: PluginDialogKind;
  payload: PluginDialogPayload;
  reject: (error: Error) => void;
  resolve: (value: unknown) => void;
};

type LoaderState = {
  cancellable: boolean;
  id: string;
  message: string;
  title: string;
};

type ToastState = {
  id: number;
  text: string;
};

const DEFAULT_TOAST_MS = 2_500;

function cancelledError(): Error {
  return Object.assign(new Error("The dialog was dismissed."), {
    name: PLUGIN_DIALOG_CANCELLED,
  });
}

function dialogTitle(payload: PluginDialogPayload): string {
  return "title" in payload && payload.title ? payload.title : "Plugin";
}

function booleanFrom(value: string | undefined): boolean {
  return value === "true" || value === "1";
}

function PromptDialog({
  onCancel,
  onSubmit,
  payload,
}: {
  onCancel: () => void;
  onSubmit: (value: string | number | null) => void;
  payload: Extract<PluginDialogPayload, { message: string; type: string }>;
}) {
  const [value, setValue] = useState(payload.defaultValue ?? "");
  const [error, setError] = useState<string | null>(null);
  const matcher = useMemo(() => {
    if (!payload.matchSource) return null;
    try {
      return new RegExp(payload.matchSource);
    } catch {
      return null;
    }
  }, [payload.matchSource]);

  const validate = useCallback(
    (next: string): boolean => {
      if (payload.required && !next) {
        setError("A value is required.");
        return false;
      }
      if (matcher && next && !matcher.test(next)) {
        setError("Invalid value.");
        return false;
      }
      setError(null);
      return true;
    },
    [matcher, payload.required],
  );

  const submit = useCallback(() => {
    if (!validate(value)) return;
    onSubmit(payload.type === "number" ? (value ? +value : value) : value);
  }, [onSubmit, payload.type, validate, value]);

  return (
    <>
      <DrawerHeader>
        <DrawerTitle>{payload.message || "Plugin"}</DrawerTitle>
        {payload.placeholder ? (
          <DrawerDescription>{payload.placeholder}</DrawerDescription>
        ) : null}
      </DrawerHeader>
      <DrawerBody contentContainerClassName="gap-sp-2 pb-sp-4">
        <Input
          autoFocus
          keyboardType={payload.type === "number" ? "numeric" : "default"}
          multiline={payload.type === "textarea"}
          onChangeText={(next) => {
            setValue(next);
            validate(next);
          }}
          placeholder={payload.placeholder}
          secureTextEntry={payload.type === "password"}
          value={value}
        />
        {error ? (
          <Text className="font-sans text-xs text-destructive dark:text-destructive-dark">
            {error}
          </Text>
        ) : null}
      </DrawerBody>
      <DrawerFooter>
        <Button onPress={submit}>OK</Button>
        <Button onPress={onCancel} variant="outline">
          Cancel
        </Button>
      </DrawerFooter>
    </>
  );
}

function SelectDialog({
  onCancel,
  onSubmit,
  payload,
}: {
  onCancel: () => void;
  onSubmit: (value: string) => void;
  payload: Extract<PluginDialogPayload, { options: PluginSelectOption[] }>;
}) {
  const theme = useTheme();
  return (
    <>
      <DrawerHeader>
        <DrawerTitle>{payload.title || "Choose"}</DrawerTitle>
      </DrawerHeader>
      <DrawerBody contentContainerClassName="gap-sp-1 pb-sp-4">
        <ScrollView>
          {payload.options.map((option) => {
            const selected = payload.defaultValue === option.value;
            return (
              <Pressable
                accessibilityRole="button"
                disabled={option.disabled}
                key={option.value}
                onPress={() => onSubmit(option.value)}
                style={({ pressed }) => (pressed ? { opacity: 0.7 } : null)}
              >
                <View
                  className="rounded-card border border-border px-sp-3 py-sp-2 dark:border-border-dark"
                  style={{
                    backgroundColor: selected ? theme.backgroundSelected : undefined,
                    opacity: option.disabled ? 0.5 : 1,
                  }}
                >
                  <Text className="font-sans text-sm text-foreground dark:text-foreground-dark">
                    {option.text}
                  </Text>
                  {option.subText ? (
                    <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                      {option.subText}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      </DrawerBody>
      <DrawerFooter>
        <Button onPress={onCancel} variant="outline">
          Cancel
        </Button>
      </DrawerFooter>
    </>
  );
}

function MultiPromptDialog({
  onCancel,
  onSubmit,
  payload,
}: {
  onCancel: () => void;
  onSubmit: (values: Record<string, string | boolean>) => void;
  payload: Extract<PluginDialogPayload, { inputs: PluginMultiPromptInput[] }>;
}) {
  const theme = useTheme();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      payload.inputs.map((input) => [input.id, input.defaultValue ?? ""]),
    ),
  );
  const [error, setError] = useState<string | null>(null);

  const set = useCallback((id: string, value: string) => {
    setValues((current) => ({ ...current, [id]: value }));
  }, []);

  const submit = useCallback(() => {
    const missing = payload.inputs.find(
      (input) =>
        input.required &&
        input.type !== "checkbox" &&
        !(values[input.id] ?? "").trim(),
    );
    if (missing) {
      setError(`"${missing.label ?? missing.id}" is required.`);
      return;
    }
    const result: Record<string, string | boolean> = {};
    for (const input of payload.inputs) {
      result[input.id] =
        input.type === "checkbox"
          ? booleanFrom(values[input.id])
          : (values[input.id] ?? "");
    }
    onSubmit(result);
  }, [onSubmit, payload.inputs, values]);

  return (
    <>
      <DrawerHeader>
        <DrawerTitle>{payload.title || "Plugin"}</DrawerTitle>
        {payload.help ? <DrawerDescription>{payload.help}</DrawerDescription> : null}
      </DrawerHeader>
      <DrawerBody contentContainerClassName="gap-sp-2 pb-sp-4">
        <ScrollView>
          {payload.inputs
            .filter((input) => !input.hidden)
            .map((input) =>
              input.type === "checkbox" ? (
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: booleanFrom(values[input.id]) }}
                  disabled={input.disabled}
                  key={input.id}
                  onPress={() =>
                    set(
                      input.id,
                      booleanFrom(values[input.id]) ? "false" : "true",
                    )
                  }
                  style={({ pressed }) => (pressed ? { opacity: 0.7 } : null)}
                >
                  <View className="flex-row items-center gap-sp-2 py-sp-1">
                    <View
                      className="rounded-card border border-border px-sp-2 py-sp-1 dark:border-border-dark"
                      style={{
                        backgroundColor: booleanFrom(values[input.id])
                          ? theme.accent
                          : undefined,
                      }}
                    >
                      <Text
                        className="font-sans text-xs text-foreground dark:text-foreground-dark"
                        style={
                          booleanFrom(values[input.id])
                            ? { color: theme.accentForeground }
                            : undefined
                        }
                      >
                        {booleanFrom(values[input.id]) ? "✓" : "○"}
                      </Text>
                    </View>
                    <Text className="flex-1 font-sans text-sm text-foreground dark:text-foreground-dark">
                      {input.label ?? input.placeholder ?? input.id}
                    </Text>
                  </View>
                </Pressable>
              ) : (
                <View className="gap-sp-1" key={input.id}>
                  <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                    {input.label ?? input.placeholder ?? input.id}
                  </Text>
                  <Input
                    disabled={input.disabled}
                    keyboardType={input.type === "number" ? "numeric" : "default"}
                    multiline={input.type === "textarea"}
                    onChangeText={(next) => set(input.id, next)}
                    placeholder={input.placeholder}
                    secureTextEntry={input.type === "password"}
                    value={values[input.id] ?? ""}
                  />
                </View>
              ),
            )}
        </ScrollView>
        {error ? (
          <Text className="font-sans text-xs text-destructive dark:text-destructive-dark">
            {error}
          </Text>
        ) : null}
      </DrawerBody>
      <DrawerFooter>
        <Button onPress={submit}>OK</Button>
        <Button onPress={onCancel} variant="outline">
          Cancel
        </Button>
      </DrawerFooter>
    </>
  );
}

export function usePluginUiHandler(): {
  element: React.ReactNode;
  handler: PluginUiHandler;
} {
  const theme = useTheme();
  const ide = useIdeWorkspace();
  const serviceRef = useRef(createExternalFolderService());
  const idRef = useRef(0);
  const queueRef = useRef<PendingDialog[]>([]);
  const currentRef = useRef<PendingDialog | null>(null);
  const [current, setCurrent] = useState<PendingDialog | null>(null);
  const [loader, setLoader] = useState<LoaderState | null>(null);
  const loaderIdRef = useRef(0);
  const loaderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const advance = useCallback(() => {
    const next = queueRef.current.shift() ?? null;
    currentRef.current = next;
    setCurrent(next);
  }, []);

  const settle = useCallback(
    (id: number, action: (dialog: PendingDialog) => void) => {
      const dialog = currentRef.current;
      if (!dialog || dialog.id !== id) return;
      action(dialog);
      advance();
    },
    [advance],
  );

  const showDialog = useCallback(
    (kind: PluginDialogKind, payload: PluginDialogPayload): Promise<unknown> => {
      // alert/confirm render through the OS dialog and never enter the drawer
      // queue, so a plugin alert cannot trap the queue behind a drawer.
      if (kind === "alert") {
        const title = dialogTitle(payload);
        const message = "message" in payload ? payload.message : "";
        return new Promise((resolve) => {
          Alert.alert(title, message, [
            { onPress: () => resolve(undefined), text: "OK" },
          ]);
        });
      }
      if (kind === "confirm") {
        const title = dialogTitle(payload);
        const message = "message" in payload ? payload.message : "";
        return new Promise((resolve) => {
          Alert.alert(title, message, [
            { onPress: () => resolve(false), style: "cancel", text: "Cancel" },
            { onPress: () => resolve(true), text: "OK" },
          ]);
        });
      }
      return new Promise((resolve, reject) => {
        idRef.current += 1;
        queueRef.current.push({ id: idRef.current, kind, payload, reject, resolve });
        if (!currentRef.current) advance();
      });
    },
    [advance],
  );

  const cancelCurrent = useCallback(() => {
    const dialog = currentRef.current;
    if (!dialog) return;
    if (dialog.kind === "prompt") {
      settle(dialog.id, (pending) => pending.resolve(null));
    } else if (dialog.kind === "select") {
      const rejectOnCancel =
        "rejectOnCancel" in dialog.payload && dialog.payload.rejectOnCancel === true;
      if (rejectOnCancel) {
        settle(dialog.id, (pending) => pending.reject(cancelledError()));
      } else {
        // Mirror Acode: without rejectOnCancel the promise stays pending.
        advance();
      }
    } else {
      // multi-prompt rejects on cancel, exactly like Acode.
      settle(dialog.id, (pending) => pending.reject(cancelledError()));
    }
  }, [advance, settle]);

  const createLoader = useCallback(
    (pluginId: string, title: string, message: string, timeoutMs?: number) => {
      void pluginId;
      loaderIdRef.current += 1;
      const id = `loader-${loaderIdRef.current}`;
      if (loaderTimerRef.current) {
        clearTimeout(loaderTimerRef.current);
        loaderTimerRef.current = null;
      }
      setLoader({ cancellable: false, id, message, title });
      if (typeof timeoutMs === "number" && timeoutMs > 0) {
        loaderTimerRef.current = setTimeout(() => {
          setLoader((active) =>
            active && active.id === id ? { ...active, cancellable: true } : active,
          );
        }, Math.min(timeoutMs, 120_000));
      }
      return Promise.resolve(id);
    },
    [],
  );

  const operateLoader = useCallback(
    (loaderId: string, op: "hide" | "setMessage" | "setTitle" | "show", value?: string) => {
      // Hide/show are overlay visibility; the state is retained so show can
      // restore it, mirroring Acode's hide/show pair.
      if (op === "hide") {
        setLoader((active) => (active && active.id === loaderId ? null : active));
        return;
      }
      if (op === "show") return;
      if (op === "setTitle" || op === "setMessage") {
        setLoader((active) =>
          active && active.id === loaderId
            ? { ...active, [op === "setTitle" ? "title" : "message"]: value ?? "" }
            : active,
        );
      }
    },
    [],
  );

  const destroyLoader = useCallback((loaderId: string) => {
    if (loaderTimerRef.current) {
      clearTimeout(loaderTimerRef.current);
      loaderTimerRef.current = null;
    }
    setLoader((active) => (active && active.id === loaderId ? null : active));
  }, []);

  const showToast = useCallback((pluginId: string, text: string, durationMs?: number) => {
    void pluginId;
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    idRef.current += 1;
    const id = idRef.current;
    setToast({ id, text });
    toastTimerRef.current = setTimeout(
      () => setToast((active) => (active && active.id === id ? null : active)),
      typeof durationMs === "number" && durationMs > 0
        ? Math.min(durationMs, 10_000)
        : DEFAULT_TOAST_MS,
    );
  }, []);

  const pickFiles = useCallback(async (pluginId: string, mode: string) => {
    void pluginId;
    if (mode.toLowerCase().includes("folder")) {
      throw new Error("Picking folders is not supported by the plugin file browser.");
    }
    const { getDocumentAsync } = await import("expo-document-picker");
    const multiple = mode.toLowerCase().includes("multiple");
    const result = await getDocumentAsync({ copyToCacheDirectory: true, multiple });
    if (result.canceled || !result.assets?.length) return [];
    return result.assets.map((asset) => asset.uri).filter(Boolean);
  }, []);

  const openNewFile = useCallback(
    async (pluginId: string, filename: string, text: string) => {
      void pluginId;
      const session = ide.activeSession;
      const project = ide.activeProject;
      if (!session || !project) {
        throw new Error("No project is open, so the file cannot be created.");
      }
      const name = normalizeNewFileName(filename);
      if (!name) throw new Error("A new editor file requires a file name.");
      const created = await serviceRef.current.createTextFile(session, name, text);
      ide.emit({ path: created.path, projectId: project.id, type: "FILE_CREATED" });
      return created.path;
    },
    [ide],
  );

  useEffect(
    () => () => {
      if (loaderTimerRef.current) clearTimeout(loaderTimerRef.current);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      // Pending drawer dialogs stay unsettled: their document died with the
      // surface, mirroring Acode's dismiss-on-destroy behavior.
      queueRef.current = [];
    },
    [],
  );

  const handler = useMemo<PluginUiHandler>(
    () => ({
      createLoader,
      destroyLoader,
      openNewFile,
      operateLoader,
      pickFiles,
      showDialog,
      toast: showToast,
    }),
    [createLoader, destroyLoader, openNewFile, operateLoader, pickFiles, showDialog, showToast],
  );

  const drawerKind =
    current && (current.kind === "prompt" || current.kind === "select" || current.kind === "multi-prompt")
      ? current.kind
      : null;

  const element = (
    <>
      <Drawer
        key={current?.id ?? "none"}
        onOpenChange={(open) => {
          if (!open) cancelCurrent();
        }}
        open={drawerKind !== null}
      >
        <DrawerContent showCloseButton showHandle>
          {drawerKind === "prompt" &&
          current &&
          "message" in current.payload &&
          "type" in current.payload ? (
            <PromptDialog
              onCancel={cancelCurrent}
              onSubmit={(value) =>
                settle(current.id, (pending) => pending.resolve(value))
              }
              payload={
                current.payload as Extract<
                  PluginDialogPayload,
                  { message: string; type: string }
                >
              }
            />
          ) : null}
          {drawerKind === "select" &&
          current &&
          "options" in current.payload ? (
            <SelectDialog
              onCancel={cancelCurrent}
              onSubmit={(value) =>
                settle(current.id, (pending) => pending.resolve(value))
              }
              payload={
                current.payload as Extract<
                  PluginDialogPayload,
                  { options: PluginSelectOption[] }
                >
              }
            />
          ) : null}
          {drawerKind === "multi-prompt" &&
          current &&
          "inputs" in current.payload ? (
            <MultiPromptDialog
              onCancel={cancelCurrent}
              onSubmit={(values) =>
                settle(current.id, (pending) => pending.resolve(values))
              }
              payload={
                current.payload as Extract<
                  PluginDialogPayload,
                  { inputs: PluginMultiPromptInput[] }
                >
              }
            />
          ) : null}
        </DrawerContent>
      </Drawer>

      {loader ? (
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              alignItems: "center",
              backgroundColor: "rgba(0,0,0,0.45)",
              justifyContent: "center",
              zIndex: 80,
            },
          ]}
        >
          <View className="rounded-card border border-border bg-card px-sp-5 py-sp-4 dark:border-border-dark dark:bg-card-dark">
            {loader.title ? (
              <Text className="font-sans text-sm font-semibold text-foreground dark:text-foreground-dark">
                {loader.title}
              </Text>
            ) : null}
            {loader.message ? (
              <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                {loader.message}
              </Text>
            ) : null}
            <ActivityIndicator
              color={theme.accent}
              size="large"
              style={{ marginVertical: 12 }}
            />
            {loader.cancellable ? (
              <Button onPress={() => destroyLoader(loader.id)} variant="outline">
                Cancel
              </Button>
            ) : null}
          </View>
        </View>
      ) : null}

      {toast ? (
        <View
          pointerEvents="none"
          style={{ alignItems: "center", bottom: 96, left: 16, position: "absolute", right: 16, zIndex: 75 }}
        >
          <View className="rounded-card border border-border bg-card px-sp-4 py-sp-2 dark:border-border-dark dark:bg-card-dark">
            <Text
              className="font-sans text-xs text-foreground dark:text-foreground-dark"
              numberOfLines={2}
            >
              {toast.text}
            </Text>
          </View>
        </View>
      ) : null}
    </>
  );

  return { element, handler };
}
