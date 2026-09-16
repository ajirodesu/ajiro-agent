/**
 * Coding harness — project and tooling configuration for coding sessions:
 * in-process exec checks, local git tooling, the verify loop, and the
 * sandbox boundary. Opened from the sidebar (Projects).
 *
 * Author: AjiroDesu
 */
import { useRouter } from "expo-router";
import { Check, ChevronLeft } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, Switch, Text, View } from "react-native";

import { Container } from "@/components/shared/container";
import { AppHeader, CircleIconButton } from "@/components/ui/chrome";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/core/utils";
import { useConfig } from "@/hooks/use-config";
import { useTheme } from "@/hooks/use-theme";
import {
  stockAndroidLinuxPlan,
  type LinuxProvisioningPlan,
} from "@/modules/runtime/linux-provision";
import {
  EXEC_COMMAND_DESCRIPTIONS,
  EXEC_COMMAND_IDS,
} from "@/modules/tools/coding/exec";
import type { CodingExecCommandId } from "@/core/services/coding/coding-settings";

function CheckRow({
  checked,
  description,
  disabled,
  label,
  onToggle,
}: {
  checked: boolean;
  description: string;
  disabled?: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      className={cn("gap-1 px-sp-4 py-sp-3", disabled && "opacity-50")}
      disabled={disabled}
      onPress={onToggle}
    >
      <View className="flex-row items-center gap-sp-2">
        <View
          className={cn(
            "h-5 w-5 items-center justify-center rounded-full border",
            checked
              ? "border-[#0A84FF] bg-[#0A84FF]"
              : "border-border dark:border-border-dark",
          )}
        >
          {checked ? <Check color="#FFFFFF" size={13} strokeWidth={2.5} /> : null}
        </View>
        <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
          {label}
        </Text>
      </View>
      <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
        {description}
      </Text>
    </Pressable>
  );
}

export default function CodingSettingsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { codingSettings, updateCodingSettings } = useConfig();
  const [saving, setSaving] = useState(false);
  const [linuxPlan, setLinuxPlan] = useState<LinuxProvisioningPlan | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    stockAndroidLinuxPlan()
      .then((plan) => {
        if (!cancelled) setLinuxPlan(plan);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const apply = (input: Partial<typeof codingSettings>) => {
    setSaving(true);
    updateCodingSettings(input)
      .catch(console.error)
      .finally(() => {
        setSaving(false);
      });
  };

  const toggleVerifyCommand = (command: CodingExecCommandId) => {
    const has = codingSettings.verifyCommands.includes(command);
    const next = has
      ? codingSettings.verifyCommands.filter((item) => item !== command)
      : [...codingSettings.verifyCommands, command];

    apply({ verifyCommands: next });
  };

  return (
    <Container
      contentClassName="gap-sp-4 py-sp-4"
      includeBottomTabInset={false}
      scroll
    >
      <AppHeader
        left={
          <CircleIconButton
            accessibilityLabel="Back"
            onPress={() => {
              router.back();
            }}
          >
            <ChevronLeft color={theme.text} size={20} strokeWidth={2} />
          </CircleIconButton>
        }
        title="Coding"
      />

      <Card className="overflow-hidden">
        <View className="flex-row items-center gap-sp-3 px-sp-4 py-sp-3">
          <View className="flex-1 gap-1">
            <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
              In-process checks
            </Text>
            <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
              Run typecheck, lint, grep, and project stats inside the app
              sandbox. Nothing executes outside the granted project folder.
            </Text>
          </View>
          <Switch
            accessibilityLabel="Enable in-process checks"
            disabled={saving}
            onValueChange={(value) => {
              apply({ execEnabled: value });
            }}
            value={codingSettings.execEnabled}
          />
        </View>
        <Separator />
        <View className="flex-row items-center gap-sp-3 px-sp-4 py-sp-3">
          <View className="flex-1 gap-1">
            <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
              Local git tools
            </Text>
            <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
              Status, diff, add, commit, branch, and log on the granted project
              folder. Remote operations run through connected MCP servers.
            </Text>
          </View>
          <Switch
            accessibilityLabel="Enable local git tools"
            disabled={saving}
            onValueChange={(value) => {
              apply({ gitEnabled: value });
            }}
            value={codingSettings.gitEnabled}
          />
        </View>
      </Card>

      <Card className="overflow-hidden">
        <View className="flex-row items-center gap-sp-3 px-sp-4 py-sp-3">
          <View className="flex-1 gap-1">
            <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
              Verify loop
            </Text>
            <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
              After each edit, run the selected checks and feed any failures
              back to the model (up to {codingSettings.verifyMaxRetries}{" "}
              retries).
            </Text>
          </View>
          <Switch
            accessibilityLabel="Enable verify loop"
            disabled={saving}
            onValueChange={(value) => {
              apply({ verifyEnabled: value });
            }}
            value={codingSettings.verifyEnabled}
          />
        </View>
        <Separator />
        {EXEC_COMMAND_IDS.map((command, index) => (
          <View key={command}>
            {index > 0 ? <Separator /> : null}
            <CheckRow
              checked={codingSettings.verifyCommands.includes(command)}
              description={EXEC_COMMAND_DESCRIPTIONS[command]}
              disabled={saving || !codingSettings.verifyEnabled}
              label={command}
              onToggle={() => {
                toggleVerifyCommand(command);
              }}
            />
          </View>
        ))}
      </Card>

      <Card className="overflow-hidden">
        <View className="px-sp-4 py-sp-3">
          <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
            Sandbox
          </Text>
          <Text className="mt-1 font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
            Writes are limited to the project folder granted per chat through
            the system folder picker. Network access is restricted to model
            providers and connected MCP servers. Destructive tool actions honor
            the tool approval setting on the chat screen.
          </Text>
        </View>
      </Card>

      <Card className="overflow-hidden">
        <View className="px-sp-4 py-sp-3">
          <Text className="font-sans text-base text-foreground dark:text-foreground-dark">
            Linux runtime
          </Text>
          <Text className="mt-1 font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
            {linuxPlan
              ? linuxPlan.guidance
              : "Checking on-device Linux status…"}
          </Text>
          {linuxPlan && linuxPlan.missing.length > 0 ? (
            <Text className="mt-2 font-mono text-xs text-muted-foreground dark:text-muted-foreground-dark">
              Missing: {linuxPlan.missing.join(", ")}
            </Text>
          ) : null}
          {linuxPlan?.provisioned ? (
            <Text className="mt-2 font-sans text-xs text-foreground dark:text-foreground-dark">
              Status: ready
            </Text>
          ) : null}
        </View>
      </Card>
    </Container>
  );
}

