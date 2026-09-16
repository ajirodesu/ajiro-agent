/**
 * Choose Model Modal — provider/model hierarchy for the composer.
 *
 * Functional reference: lobehub's ModelSwitchPanel (provider group headers
 * with a settings affordance, model rows with abilities + active state,
 * detail-on-inspect, empty/disabled states) rebuilt on Ajiro's Drawer +
 * theme + typography. Per prompt rules: NO per-model avatar (§10/§26),
 * provider rows keep a settings gear (§6), everything visual is Ajiro.
 */
import { useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import {
  Brain,
  ChevronLeft,
  Eye,
  Image as ImageIcon,
  Mic,
  RefreshCw,
  Search,
  Settings2,
  Video,
  Wrench,
} from "lucide-react-native";

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
import type {
  DisplayCapabilityKey,
  ModelAvailability,
} from "@/modules/models/model-display";

export interface ModelModalBadge {
  key: DisplayCapabilityKey;
  label: string;
}

export interface ModelModalRow {
  ref: string;
  label: string;
  modelId: string;
  badges: ModelModalBadge[];
  contextLabel: string | null;
  availability: ModelAvailability;
  availabilityNote: string | null;
  selected: boolean;
  custom: boolean;
  free: boolean;
}

export interface ModelModalGroup {
  providerId: string;
  providerLabel: string;
  enabled: boolean;
  hasCredential: boolean;
  discoveryError: string | null;
  models: ModelModalRow[];
}

export interface ModelModalDetail {
  ref: string;
  label: string;
  modelId: string;
  providerLabel: string;
  badges: { key: DisplayCapabilityKey; label: string; description: string }[];
  contextLabel: string | null;
  usageLabel: string | null;
  maxTokensLabel: string | null;
  inputPrice: string | null;
  outputPrice: string | null;
  availabilityNote: string | null;
  free: boolean;
  custom: boolean;
  outputType: string;
}

export interface ModelModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: ModelModalGroup[];
  staleBanner: {
    currentLabel: string;
    requestedLabel: string;
    onFix: () => void;
  } | null;
  notice: string | null;
  detail: ModelModalDetail | null;
  onOpenDetail: (ref: string | null) => void;
  onSelectModel: (ref: string) => void;
  onOpenProviderSettings: (providerId: string) => void;
  onToggleProviderEnabled: (providerId: string, enabled: boolean) => void;
  onAddProvider: () => void;
  onRefreshModels: () => void;
  refreshing: boolean;
}

function BadgeChip({ label }: { label: string }) {
  return (
    <View className="rounded-ui border border-border px-sp-1 py-0.5 dark:border-border-dark">
      <Text className="font-mono text-xs text-muted-foreground dark:text-muted-foreground-dark">
        {label}
      </Text>
    </View>
  );
}

function CapabilityIcon({ badgeKey, size = 13 }: { badgeKey: DisplayCapabilityKey; size?: number }) {
  const theme = useTheme();
  const color = theme.textSecondary;
  switch (badgeKey) {
    case "tools":
      return <Wrench color={color} size={size} />;
    case "vision":
      return <Eye color={color} size={size} />;
    case "image":
      return <ImageIcon color={color} size={size} />;
    case "reasoning":
      return <Brain color={color} size={size} />;
    case "audioInput":
    case "audioOutput":
      return <Mic color={color} size={size} />;
    case "videoInput":
    case "videoOutput":
      return <Video color={color} size={size} />;
  }
}

function ModelRow({
  onOpenDetail,
  onSelect,
  row,
}: {
  onOpenDetail: () => void;
  onSelect: () => void;
  row: ModelModalRow;
}) {
  const theme = useTheme();
  const unavailable = row.availability !== "available";
  return (
    <View
      accessibilityState={{ disabled: unavailable, selected: row.selected }}
      className={`rounded-ui border px-sp-3 py-sp-2 ${
        row.selected
          ? "border-foreground bg-secondary dark:border-foreground-dark dark:bg-secondary-dark"
          : "border-border bg-background dark:border-border-dark dark:bg-background-dark"
      }`}
    >
      <Pressable
        accessibilityLabel={`${row.label}${row.selected ? ", selected" : ""}${unavailable && row.availabilityNote ? `, ${row.availabilityNote}` : ""}`}
        accessibilityRole="button"
        accessibilityState={{ disabled: unavailable, selected: row.selected }}
        className="flex-row items-center gap-sp-2"
        onPress={() => {
          if (unavailable) {
            onOpenDetail();
          } else {
            onSelect();
          }
        }}
      >
        <View className="min-w-0 flex-1 gap-1">
          <View className="flex-row items-center gap-sp-2">
            <Text
              className="min-w-0 flex-1 font-sans text-base font-semibold text-foreground dark:text-foreground-dark"
              numberOfLines={1}
            >
              {row.label}
            </Text>
            {row.selected ? (
              <Text className="font-sans text-xs font-semibold" style={{ color: theme.accent }}>
                Active
              </Text>
            ) : null}
          </View>
          <View className="flex-row flex-wrap items-center gap-sp-1">
            {row.badges.map((badge) => (
              <BadgeChip key={badge.key} label={badge.label} />
            ))}
            {row.contextLabel ? <BadgeChip label={row.contextLabel} /> : null}
            {row.free ? <BadgeChip label="Free" /> : null}
            {row.custom ? <BadgeChip label="Custom" /> : null}
          </View>
          {unavailable && row.availabilityNote ? (
            <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
              {row.availabilityNote} — tap for details.
            </Text>
          ) : null}
        </View>
      </Pressable>
      <View className="mt-1 flex-row justify-end">
        <Button onPress={onOpenDetail} size="xs" variant="ghost">
          <Text style={{ color: theme.textSecondary, fontSize: 12 }}>Detail</Text>
        </Button>
      </View>
    </View>
  );
}

export function ModelModal(props: ModelModalProps) {
  const theme = useTheme();
  const [query, setQuery] = useState("");

  const visibleGroups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return props.groups;
    return props.groups
      .map((group) => {
        if (group.providerLabel.toLowerCase().includes(needle)) {
          return group;
        }
        return {
          ...group,
          models: group.models.filter((row) => {
            const badges = row.badges.map((badge) => badge.label).join(" ");
            return [row.label, row.modelId, badges].some((field) =>
              field.toLowerCase().includes(needle),
            );
          }),
        };
      })
      .filter((group) => group.models.length > 0);
  }, [props.groups, query]);

  const openDetail = (ref: string | null) => {
    props.onOpenDetail(ref);
  };

  const totalModels = props.groups.reduce((sum, group) => sum + group.models.length, 0);

  return (
    <Drawer
      onOpenChange={(open) => {
        if (!open) {
          openDetail(null);
          setQuery("");
        }
        props.onOpenChange(open);
      }}
      open={props.open}
    >
      <DrawerContent showCloseButton showHandle>
        <DrawerHeader>
          {props.detail ? (
            <View className="flex-row items-center gap-sp-2">
              <Button
                leftIcon={<ChevronLeft color={theme.text} size={16} />}
                onPress={() => openDetail(null)}
                size="icon-xs"
                variant="ghost"
              />
              <DrawerTitle>Model detail</DrawerTitle>
            </View>
          ) : (
            <DrawerTitle>Choose model</DrawerTitle>
          )}
          <DrawerDescription>
            {props.detail
              ? "Verified provider metadata."
              : "The selected model powers this chat."}
          </DrawerDescription>
        </DrawerHeader>
        <DrawerBody contentContainerClassName="gap-sp-2 pb-sp-4">
          {props.staleBanner && !props.detail ? (
            <View className="gap-1 rounded-ui border border-border px-sp-3 py-sp-2 dark:border-border-dark">
              <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                “{props.staleBanner.requestedLabel}” is unavailable — using
                “{props.staleBanner.currentLabel}”.
              </Text>
              <Button onPress={props.staleBanner.onFix} size="xs" variant="outline">
                Use {props.staleBanner.currentLabel}
              </Button>
            </View>
          ) : null}

          {props.notice && !props.detail ? (
            <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
              {props.notice}
            </Text>
          ) : null}

          {props.detail ? (
            <ModelDetailBody detail={props.detail} />
          ) : (
            <>
              <View className="flex-row items-center gap-sp-2 rounded-ui border border-border px-sp-2 py-1 dark:border-border-dark">
                <Search color={theme.textSecondary} size={14} />
                <TextInput
                  accessibilityLabel="Search models"
                  autoCapitalize="none"
                  autoCorrect={false}
                  className="min-w-0 flex-1 font-sans text-sm text-foreground dark:text-foreground-dark"
                  onChangeText={setQuery}
                  placeholder="Search name, id, provider, capability…"
                  placeholderTextColor={theme.textSecondary}
                  value={query}
                />
              </View>

              {visibleGroups.length === 0 ? (
                <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                  {totalModels === 0
                    ? "No models available. Add a provider below or check provider setup."
                    : "No models match your search."}
                </Text>
              ) : (
                visibleGroups.map((group) => (
                  <View className="gap-sp-2" key={group.providerId}>
                    <View className="flex-row items-center gap-sp-2">
                      <View className="min-w-0 flex-1">
                        <Text className="font-sans text-sm font-semibold text-foreground dark:text-foreground-dark">
                          {group.providerLabel}
                        </Text>
                        <Text className="font-mono text-xs text-muted-foreground dark:text-muted-foreground-dark">
                          {group.models.length} model{group.models.length === 1 ? "" : "s"}
                          {!group.enabled ? " · disabled" : ""}
                          {!group.hasCredential ? " · no key" : ""}
                        </Text>
                      </View>
                      <Button
                        accessibilityLabel={`${group.enabled ? "Disable" : "Enable"} ${group.providerLabel}`}
                        onPress={() =>
                          props.onToggleProviderEnabled(group.providerId, !group.enabled)
                        }
                        size="xs"
                        variant="ghost"
                      >
                        <Text style={{ color: theme.textSecondary, fontSize: 12 }}>
                          {group.enabled ? "Disable" : "Enable"}
                        </Text>
                      </Button>
                      <Button
                        accessibilityLabel={`Open ${group.providerLabel} settings`}
                        leftIcon={<Settings2 color={theme.text} size={16} />}
                        onPress={() => props.onOpenProviderSettings(group.providerId)}
                        size="icon-xs"
                        variant="ghost"
                      />
                    </View>
                    {group.discoveryError ? (
                      <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                        Refresh failed: {group.discoveryError}
                      </Text>
                    ) : null}
                    {group.models.length === 0 ? (
                      <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                        No models for this provider — open settings to configure.
                      </Text>
                    ) : null}
                    {group.models.map((row) => (
                      <ModelRow
                        key={row.ref}
                        onOpenDetail={() => openDetail(row.ref)}
                        onSelect={() => props.onSelectModel(row.ref)}
                        row={row}
                      />
                    ))}
                  </View>
                ))
              )}
            </>
          )}
        </DrawerBody>
        <DrawerFooter>
          <Button
            disabled={props.refreshing}
            leftIcon={<RefreshCw color={theme.text} size={14} />}
            onPress={props.onRefreshModels}
            variant="outline"
          >
            {props.refreshing ? "Refreshing…" : "Refresh"}
          </Button>
          <Button onPress={props.onAddProvider} variant="outline">
            Add provider
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

function ModelDetailBody({ detail }: { detail: ModelModalDetail }) {
  return (
    <View className="gap-sp-3">
      <View className="gap-1">
        <Text className="font-sans text-lg font-semibold text-foreground dark:text-foreground-dark">
          {detail.label}
        </Text>
        <Text className="font-mono text-xs text-muted-foreground dark:text-muted-foreground-dark">
          {detail.providerLabel} · {detail.modelId}
        </Text>
      </View>

      <View className="flex-row flex-wrap gap-sp-1">
        {detail.badges.map((badge) => (
          <View
            className="flex-row items-center gap-sp-1 rounded-ui border border-border px-sp-2 py-1 dark:border-border-dark"
            key={badge.key}
          >
            <CapabilityIcon badgeKey={badge.key} />
            <Text className="font-mono text-xs text-foreground dark:text-foreground-dark">
              {badge.label}
            </Text>
          </View>
        ))}
        {detail.free ? (
          <View className="rounded-ui border border-border px-sp-2 py-1 dark:border-border-dark">
            <Text className="font-mono text-xs text-foreground dark:text-foreground-dark">
              Free
            </Text>
          </View>
        ) : null}
      </View>

      <View className="gap-1">
        <DetailRow label="Context" value={detail.contextLabel ?? "Unknown"} />
        <DetailRow label="Used" value={detail.usageLabel ?? "—"} />
        <DetailRow label="Max output" value={detail.maxTokensLabel ?? "Unknown"} />
        <DetailRow label="Input price" value={detail.inputPrice ?? "Unknown"} />
        <DetailRow label="Output price" value={detail.outputPrice ?? "Unknown"} />
        <DetailRow label="Type" value={detail.custom ? "Custom model" : "Catalog model"} />
        <DetailRow
          label="Output"
          value={detail.outputType === "image" ? "Image" : "Text"}
        />
      </View>

      {detail.availabilityNote ? (
        <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
          {detail.availabilityNote}
        </Text>
      ) : null}
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-start justify-between gap-sp-3 py-1">
      <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
        {label}
      </Text>
      <Text className="min-w-0 flex-1 text-right font-mono text-xs text-foreground dark:text-foreground-dark">
        {value}
      </Text>
    </View>
  );
}
