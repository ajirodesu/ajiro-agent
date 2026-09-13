import { useRouter } from "expo-router";
import {
  Archive,
  Bell,
  Bot,
  Briefcase,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Code,
  Contrast,
  Copy,
  Cpu,
  Database,
  KeyRound,
  RefreshCw,
  Server,
  Terminal,
  Upload,
  Wand2,
} from "lucide-react-native";
import { useEffect, useState, type ReactNode } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import type { DatabaseMode, ModelRef } from "@/core/types/app-state";
import { cn } from "@/core/utils";
import { useAppState } from "@/hooks/use-app-state";
import { useConfig } from "@/hooks/use-config";
import { useTheme } from "@/hooks/use-theme";
import { countEnabledBuiltInFileTools } from "@/modules/config/built-in-tools";
import { useUpdate } from "@/providers/check-for-updates";
import {
  isBackgroundAgentHeld,
  isIgnoringBatteryOptimizations,
  openBatteryOptimizationSettings,
  requestBatteryOptimizationExemption,
} from "background-agent-service";

type DrawerKey =
  | "current-model"
  | "db"
  | "theme"
  | "background"
  | "notifications"
  | null;

type RowIcon = typeof Bell;

function SettingsRefRow({
  disabled = false,
  icon: Icon,
  onPress,
  showChevron = true,
  title,
  value,
}: {
  disabled?: boolean;
  icon: RowIcon;
  onPress?: () => void;
  showChevron?: boolean;
  title: string;
  value?: ReactNode;
}) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      className="min-h-[52px] flex-row items-center"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        gap: 12,
        padding: 16,
        opacity: pressed && !disabled ? 0.75 : disabled ? 0.5 : 1,
      })}
    >
      <Icon color="#ffffff" size={22} strokeWidth={2} />
      <Text
        numberOfLines={1}
        className="min-w-0 flex-1 font-sans text-foreground dark:text-foreground-dark"
        style={{ fontSize: 16, fontWeight: "500" }}
      >
        {title}
      </Text>
      {typeof value === "string" || typeof value === "number" ? (
        <Text
          className="font-sans text-muted-foreground dark:text-muted-foreground-dark"
          style={{ fontSize: 15 }}
        >
          {value}
        </Text>
      ) : (
        value
      )}
      {showChevron ? (
        <ChevronRight color={theme.textSecondary} size={18} style={{ opacity: 0.5 }} />
      ) : null}
    </Pressable>
  );
}

function SettingsGroup({ children }: { children: ReactNode }) {
  const count = Array.isArray(children) ? children.length : 1;
  return (
    <View
      className="bg-card dark:bg-card-dark"
      style={{ gap: 2, marginHorizontal: 16, marginBottom: 28 }}
    >
      {Array.isArray(children)
        ? children.map((child, index) => (
            <View
              key={index}
              className="overflow-hidden"
              style={{
                borderTopLeftRadius: index === 0 ? 24 : 4,
                borderTopRightRadius: index === 0 ? 24 : 4,
                borderBottomLeftRadius: index === count - 1 ? 24 : 4,
                borderBottomRightRadius: index === count - 1 ? 24 : 4,
              }}
            >
              {child}
            </View>
          ))
        : children}
    </View>
  );
}

function SettingsSectionLabel({ children }: { children: string }) {
  return (
    <Text
      className="font-sans text-muted-foreground dark:text-muted-foreground-dark"
      style={{
        fontSize: 13,
        fontWeight: "600",
        paddingHorizontal: 16,
        paddingBottom: 8,
      }}
    >
      {children}
    </Text>
  );
}

export default function SettingsScreen() {
  const router = useRouter();
  const { error, hydrating, ready } = useAppState();
  const {
    activeModels,
    agents,
    currentModel,
    databaseMode,
    databaseUrl,
    memoryEnabled,
    refresh,
    schedules,
    schedulingEnabled,
    selectModel,
    mcpServers,
    notificationSettings,
    savedPrompts,
    skills,
    themeMode,
    toolSettings,
    updateDatabaseSettings,
    updateNotificationSettings,
    updateThemeMode,
    providers,
    codingSettings,
  } = useConfig();
  const { release, installing, installUpdate } = useUpdate();
  const [databaseUrlInput, setDatabaseUrlInput] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [openDrawer, setOpenDrawer] = useState<DrawerKey>(null);
  const [agentActive, setAgentActive] = useState(false);
  const [batteryOptimizationGranted, setBatteryOptimizationGranted] = useState<
    boolean | null
  >(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    setDatabaseUrlInput(databaseUrl ?? "");
  }, [databaseUrl]);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const poll = setInterval(async () => {
      setAgentActive(await isBackgroundAgentHeld());
      setBatteryOptimizationGranted(await isIgnoringBatteryOptimizations());
    }, 2000);
    return () => clearInterval(poll);
  }, []);

  const providerCount = providers.length;
  const enabledToolCount = countEnabledBuiltInFileTools(toolSettings);
  const enabledMcpServerCount = mcpServers.filter(
    (server) => server.enabled,
  ).length;
  const enabledSkillCount = skills.filter((skill) => skill.enabled).length;

  const runAction = async (key: string, action: () => Promise<void>) => {
    setBusyKey(key);

    try {
      await action();
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <SafeAreaView
      className="flex-1 bg-background dark:bg-background-dark"
      edges={["top", "left", "right"]}
    >
      <View className="relative flex-1">
        <ScrollView
          className="flex-1"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingTop: 100, paddingBottom: 24 }}
          scrollEventThrottle={32}
          onScroll={(event) => {
            setScrolled(event.nativeEvent.contentOffset.y > 4);
          }}
        >
          <SettingsSectionLabel>Tools & agents</SettingsSectionLabel>
          <SettingsGroup>
            <SettingsRefRow
              icon={KeyRound}
              title="Providers"
              value={`${providerCount}`}
              onPress={() => {
                router.push("/settings/providers");
              }}
            />
            <SettingsRefRow
              icon={Briefcase}
              title="Built-in tools"
              value={`${enabledToolCount} active`}
              onPress={() => {
                router.push("/settings/tools");
              }}
            />
            <SettingsRefRow
              icon={Code}
              title="Coding"
              value={
                codingSettings.execEnabled || codingSettings.gitEnabled
                  ? "Enabled"
                  : "Off"
              }
              onPress={() => {
                router.push("/settings/coding" as never);
              }}
            />
            <SettingsRefRow
              icon={Bot}
              title="Agents"
              value={`${agents.length} custom`}
              onPress={() => {
                router.push("/settings/agents" as never);
              }}
            />
            <SettingsRefRow
              icon={Server}
              title="MCP servers"
              value={`${enabledMcpServerCount} active`}
              onPress={() => {
                router.push("/settings/mcp/connected" as never);
              }}
            />
            <SettingsRefRow
              icon={Wand2}
              title="Skills"
              value={`${enabledSkillCount} active`}
              onPress={() => {
                router.push("/settings/skills" as never);
              }}
            />
            <SettingsRefRow
              icon={Clock}
              title="Jobs"
              value={
                schedulingEnabled
                  ? `${schedules.filter((schedule) => schedule.enabled).length} active`
                  : "Off"
              }
              onPress={() => {
                router.push("/settings/jobs" as never);
              }}
            />
            <Drawer
              onOpenChange={(open) => {
                setOpenDrawer(open ? "background" : null);
              }}
              open={openDrawer === "background"}
            >
              <DrawerTrigger asChild>
                <SettingsRefRow
                  icon={Copy}
                  title="Background agent"
                  value={
                    batteryOptimizationGranted === null
                      ? "…"
                      : batteryOptimizationGranted
                        ? agentActive
                          ? "Active"
                          : "Ready"
                        : "Permission needed"
                  }
                />
              </DrawerTrigger>
              <DrawerContent showCloseButton>
                <DrawerHeader>
                  <DrawerTitle>Background agent</DrawerTitle>
                </DrawerHeader>
                <DrawerBody contentContainerClassName="gap-sp-2">
                  <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                    Keeps the agent running when the app is in the background. Uses
                    a foreground service + wake lock (Android).
                  </Text>

                  {Platform.OS === "android" ? (
                    <View className="flex-row items-center justify-between">
                      <View className="min-w-0 flex-1">
                        <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
                          Battery optimization
                        </Text>
                        <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                          Stops Android from killing the agent while it runs in the
                          background.
                        </Text>
                      </View>
                      <Checkbox
                        checked={batteryOptimizationGranted ?? false}
                        onCheckedChange={() => {
                          if (batteryOptimizationGranted) {
                            openBatteryOptimizationSettings().catch(() => {});
                          } else {
                            requestBatteryOptimizationExemption().catch(() => {});
                          }
                        }}
                      />
                    </View>
                  ) : null}
                </DrawerBody>
              </DrawerContent>
            </Drawer>
          </SettingsGroup>

          <SettingsSectionLabel>Workspace</SettingsSectionLabel>
          <SettingsGroup>
            <SettingsRefRow
              icon={Terminal}
              title="Saved prompts"
              value={`${savedPrompts.length}`}
              onPress={() => {
                router.push("/settings/prompts" as never);
              }}
            />
            <SettingsRefRow
              icon={Archive}
              title="Memory"
              value={memoryEnabled ? "Local" : "Disabled"}
              onPress={() => {
                router.push("/settings/memory" as never);
              }}
            />
            <Drawer
              onOpenChange={(open) => {
                setOpenDrawer(open ? "db" : null);
              }}
              open={openDrawer === "db"}
            >
              <DrawerTrigger asChild>
                <SettingsRefRow
                  icon={Database}
                  title="Database"
                  value={databaseMode === "local" ? "Local" : "Remote"}
                />
              </DrawerTrigger>
              <DrawerContent showCloseButton>
                <DrawerHeader>
                  <DrawerTitle>Database</DrawerTitle>
                </DrawerHeader>
                <DrawerBody>
                  <View className="flex-row gap-sp-2">
                    <Button
                      className="flex-1"
                      onPress={() => {
                        runAction("db-mode-local", async () => {
                          await updateDatabaseSettings({
                            databaseMode: "local" as DatabaseMode,
                          });
                        }).catch(console.error);
                      }}
                      variant={databaseMode === "local" ? "default" : "outline"}
                    >
                      Local
                    </Button>
                    <Button
                      className="flex-1"
                      onPress={() => {
                        runAction("db-mode-remote", async () => {
                          await updateDatabaseSettings({
                            databaseMode: "remote" as DatabaseMode,
                          });
                        }).catch(console.error);
                      }}
                      variant={databaseMode === "remote" ? "default" : "outline"}
                    >
                      Remote
                    </Button>
                  </View>
                  <View className="gap-sp-2">
                    <Text className="font-sans text-sm font-medium text-foreground dark:text-foreground-dark">
                      Database URL
                    </Text>
                    <Input
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="url"
                      onChangeText={setDatabaseUrlInput}
                      placeholder="https://example-db.internal"
                      value={databaseUrlInput}
                    />
                  </View>
                </DrawerBody>
                <DrawerFooter>
                  <View className="flex-row gap-sp-2">
                    <Button
                      className="flex-1"
                      loading={busyKey === "db-url"}
                      onPress={() => {
                        runAction("db-url", async () => {
                          await updateDatabaseSettings({
                            databaseUrl: databaseUrlInput.trim() || null,
                          });
                        }).catch(console.error);
                      }}
                      variant="secondary"
                    >
                      Save
                    </Button>
                    <Button
                      className="flex-1"
                      loading={busyKey === "db-clear"}
                      onPress={() => {
                        runAction("db-clear", async () => {
                          setDatabaseUrlInput("");
                          await updateDatabaseSettings({ databaseUrl: null });
                        }).catch(console.error);
                      }}
                      variant="outline"
                    >
                      Clear
                    </Button>
                  </View>
                </DrawerFooter>
              </DrawerContent>
            </Drawer>
          </SettingsGroup>

          <SettingsSectionLabel>Preferences</SettingsSectionLabel>
          <SettingsGroup>
            <Drawer
              onOpenChange={(open) => {
                setOpenDrawer(open ? "notifications" : null);
              }}
              open={openDrawer === "notifications"}
            >
              <DrawerTrigger asChild>
                <SettingsRefRow
                  icon={Bell}
                  title="Notifications"
                  value={
                    notificationSettings.approvalRequests ||
                    notificationSettings.runFinished
                      ? "On"
                      : "Off"
                  }
                />
              </DrawerTrigger>
              <DrawerContent showCloseButton>
                <DrawerHeader>
                  <DrawerTitle>Notifications</DrawerTitle>
                </DrawerHeader>
                <DrawerBody contentContainerClassName="gap-sp-2">
                  <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                    Alerts sent even when the app is in the background.
                  </Text>

                  <View className="flex-row items-center justify-between">
                    <View className="min-w-0 flex-1">
                      <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
                        Approval requests
                      </Text>
                      <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                        Alert when the agent asks permission to use a tool. Includes
                        Approve / Reject actions.
                      </Text>
                    </View>
                    <Checkbox
                      checked={notificationSettings.approvalRequests}
                      onCheckedChange={async (checked) => {
                        await updateNotificationSettings({
                          approvalRequests: checked,
                        });
                      }}
                    />
                  </View>

                  <View className="flex-row items-center justify-between">
                    <View className="min-w-0 flex-1">
                      <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
                        Run finished
                      </Text>
                      <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                        Alert when the agent finishes a task or fails.
                      </Text>
                    </View>
                    <Checkbox
                      checked={notificationSettings.runFinished}
                      onCheckedChange={async (checked) => {
                        await updateNotificationSettings({
                          runFinished: checked,
                        });
                      }}
                    />
                  </View>
                </DrawerBody>
              </DrawerContent>
            </Drawer>
            <Drawer
              onOpenChange={(open) => {
                setOpenDrawer(open ? "theme" : null);
              }}
              open={openDrawer === "theme"}
            >
              <DrawerTrigger asChild>
                <SettingsRefRow
                  icon={Contrast}
                  title="Theme"
                  value={
                    themeMode === "system"
                      ? "System"
                      : themeMode === "dark"
                        ? "Dark"
                        : "Light"
                  }
                />
              </DrawerTrigger>
              <DrawerContent showCloseButton>
                <DrawerHeader>
                  <DrawerTitle>Theme</DrawerTitle>
                </DrawerHeader>
                <DrawerBody contentContainerClassName="gap-sp-2">
                  {(
                    [
                      ["system", "System", "Follow your device appearance"],
                      ["light", "Light", "Always use the light theme"],
                      ["dark", "Dark", "Always use the dark theme"],
                    ] as const
                  ).map(([value, label, subtitle]) => (
                    <DrawerOptionRow
                      key={value}
                      label={label}
                      onPress={() => {
                        runAction(`theme:${value}`, async () => {
                          await updateThemeMode(value);
                          setOpenDrawer(null);
                        }).catch(console.error);
                      }}
                      selected={themeMode === value}
                      subtitle={subtitle}
                    />
                  ))}
                </DrawerBody>
              </DrawerContent>
            </Drawer>
            <Drawer
              onOpenChange={(open) => {
                setOpenDrawer(open ? "current-model" : null);
              }}
              open={openDrawer === "current-model"}
            >
              <DrawerTrigger asChild>
                <SettingsRefRow
                  icon={Cpu}
                  title="Current model"
                  value={currentModel?.label ?? "None"}
                />
              </DrawerTrigger>
              <DrawerContent showCloseButton>
                <DrawerHeader>
                  <DrawerTitle>Current model</DrawerTitle>
                </DrawerHeader>
                <DrawerBody>
                  {activeModels.length > 0 ? (
                    activeModels.map((model) => {
                      const selected = currentModel?.ref === model.ref;

                      return (
                        <DrawerOptionRow
                          key={model.ref}
                          label={model.label}
                          onPress={() => {
                            runAction(`model:${model.ref}`, async () => {
                              await selectModel(model.ref as ModelRef);
                              setOpenDrawer(null);
                            }).catch(console.error);
                          }}
                          selected={selected}
                          subtitle={model.providerLabel}
                        />
                      );
                    })
                  ) : (
                    <EmptyStateText>No active models</EmptyStateText>
                  )}
                </DrawerBody>
                <DrawerFooter>
                  <Button
                    onPress={() => {
                      setOpenDrawer(null);
                      router.push("/settings/providers");
                    }}
                    variant="outline"
                  >
                    Manage providers
                  </Button>
                </DrawerFooter>
              </DrawerContent>
            </Drawer>
          </SettingsGroup>

          <SettingsSectionLabel>App</SettingsSectionLabel>
          <SettingsGroup>
            <SettingsRefRow
              icon={Upload}
              title="App update"
              value={
                installing
                  ? "Downloading..."
                  : release
                    ? `Update ${release.tagName}`
                    : "Up to date"
              }
              showChevron={!!release}
              disabled={installing}
              onPress={release ? installUpdate : undefined}
            />
            <SettingsRefRow
              icon={RefreshCw}
              title="Refresh config"
              disabled={!ready || hydrating || busyKey === "refresh"}
              showChevron={false}
              value={hydrating || busyKey === "refresh" ? "Loading..." : undefined}
              onPress={() => {
                runAction("refresh", refresh).catch(console.error);
              }}
            />
          </SettingsGroup>

          {error ? (
            <Text
              className="font-sans text-sm text-destructive dark:text-destructive-dark"
              style={{ paddingHorizontal: 16 }}
            >
              {error}
            </Text>
          ) : null}
        </ScrollView>

        {scrolled ? (
          <View
            className="absolute inset-x-0 top-0"
            pointerEvents="none"
            style={{ height: 96 }}
          >
            <View style={{ flex: 26, backgroundColor: "rgba(0,0,0,0.55)" }} />
            <View style={{ flex: 35, backgroundColor: "rgba(0,0,0,0.25)" }} />
            <View style={{ flex: 35, backgroundColor: "rgba(0,0,0,0)" }} />
          </View>
        ) : null}

        <View
          className="absolute left-0 right-0 flex-row items-center justify-center"
          pointerEvents="box-none"
          style={{ top: 44, height: 44 }}
        >
          <Text
            className="font-sans text-foreground dark:text-foreground-dark"
            style={{ fontSize: 18, fontWeight: "600" }}
          >
            Settings
          </Text>
        </View>
        <Pressable
          accessibilityLabel="Back"
          accessibilityRole="button"
          onPress={() => {
            router.back();
          }}
          className="absolute items-center justify-center rounded-full"
          style={{
            top: 44,
            left: 20,
            width: 44,
            height: 44,
            backgroundColor: "#2a2b31",
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.12)",
          }}
        >
          <ChevronLeft color="#ffffff" size={20} strokeWidth={2} />
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function DrawerOptionRow({
  label,
  onPress,
  selected = false,
  subtitle,
}: {
  label: string;
  onPress: () => void;
  selected?: boolean;
  subtitle?: string;
}) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      className={cn(
        "min-h-14 flex-row items-center gap-sp-3 rounded-ui border px-sp-4 py-sp-3",
        selected
          ? "border-foreground bg-secondary dark:border-foreground-dark dark:bg-secondary-dark"
          : "border-border bg-background dark:border-border-dark dark:bg-background-dark",
      )}
      onPress={onPress}
      style={({ pressed }) => (pressed ? { opacity: 0.86 } : null)}
    >
      <View className="flex-1 gap-1">
        <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
          {label}
        </Text>
        {subtitle ? (
          <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {selected ? <Check color={theme.text} size={18} /> : null}
    </Pressable>
  );
}

function EmptyStateText({ children }: { children: ReactNode }) {
  return (
    <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
      {children}
    </Text>
  );
}
