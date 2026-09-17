import { useRouter } from "expo-router";
import Constants from "expo-constants";
import { Plus } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { Platform, Text, View } from "react-native";

import { McpScreenHeader } from "@/components/settings/mcp/screen-header";
import { Container } from "@/components/shared/container";
import { SearchBox } from "@/components/shared/search-box";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Separator } from "@/components/ui/separator";
import { useConfig } from "@/hooks/use-config";
import { useTheme } from "@/hooks/use-theme";
import {
  fetchMcpServerCatalogCached,
  type McpServerPreset,
} from "@/modules/mcp/catalog";
import {
  checkMcpPresetSupport,
  deriveMcpPresetStatus,
  findMissingMcpDependencies,
} from "@/modules/mcp/mcp-compat";
import { isMcpOAuthCanceledError } from "@/modules/mcp/oauth";
import { describeDynamicUpdateStatus } from "@/modules/updates/extension-framework";

import { McpServerForm } from "./add";

function normalizeMcpUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.href.replace(/\/$/, "");
  } catch {
    return value.trim().replace(/\/$/, "");
  }
}

export default function McpCatalogScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { createMcpServerOAuth, mcpServers } = useConfig();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogPresets, setCatalogPresets] = useState<McpServerPreset[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [setupPresetId, setSetupPresetId] = useState<string | null>(null);
  const [setupDrawerOpen, setSetupDrawerOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filteredPresets = useMemo(() => {
    const needle = query.trim().toLowerCase();

    if (!needle) {
      return catalogPresets;
    }

    return catalogPresets.filter(
      (preset) =>
        preset.label.toLowerCase().includes(needle) ||
        preset.description.toLowerCase().includes(needle),
    );
  }, [catalogPresets, query]);

  const loadCatalog = async (signal?: AbortSignal) => {
    setCatalogLoading(true);
    setCatalogError(null);

    try {
      const result = await fetchMcpServerCatalogCached(signal);
      setCatalogPresets(result.presets);
    } catch (catalogLoadError) {
      if (signal?.aborted) return;
      setCatalogError(
        catalogLoadError instanceof Error
          ? catalogLoadError.message
          : "Could not load MCP connections.",
      );
    } finally {
      if (!signal?.aborted) setCatalogLoading(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    loadCatalog(controller.signal).catch(console.error);
    return () => controller.abort();
  }, []);

  const connectPreset = async (preset: McpServerPreset) => {
    // Revoked and runtime-incompatible presets never reach setup (§§24, 35).
    const support = checkMcpPresetSupport(preset, {
      appVersion: Constants.expoConfig?.version ?? null,
      platform: Platform.OS,
    });
    // Declared dependencies configure first (§6): never half-wire a server.
    const missingDeps = findMissingMcpDependencies(
      preset,
      mcpServers.map((server) => server.id),
    );
    if (missingDeps.length > 0) {
      setError(
        `Set up ${missingDeps.join(", ")} first: "${preset.label}" depends on it.`,
      );
      return;
    }
    if (support.status === "revoked" || support.status === "requires-app-update") {
      setError(support.reason ?? "This MCP server cannot be set up.");
      return;
    }
    if (preset.authMode !== "oauth") {
      setSetupPresetId(preset.id);
      setSetupDrawerOpen(true);
      return;
    }

    setBusyKey(preset.id);
    setError(null);

    try {
      await createMcpServerOAuth({
        enabled: true,
        label: preset.label,
        oauthAllowedAuthOrigin: preset.oauthAllowedAuthOrigin,
        oauthAuthorizationUrl: preset.oauthAuthorizationUrl,
        oauthClientId: preset.oauthClientId,
        oauthScopes: preset.oauthScopes,
        oauthTokenUrl: preset.oauthTokenUrl,
        transport: preset.transport,
        url: preset.url,
      });

      router.replace("/settings/mcp/connected" as never);
    } catch (connectError) {
      if (isMcpOAuthCanceledError(connectError)) return;
      setError(
        connectError instanceof Error
          ? connectError.message
          : "Could not connect the MCP server.",
      );
    } finally {
      setBusyKey(null);
    }
  };

  const openCustomSetup = () => {
    setSetupPresetId(null);
    setSetupDrawerOpen(true);
  };

  return (
    <Container
      scroll
      contentClassName="gap-sp-4 py-sp-4"
      includeBottomTabInset={false}
    >
      <McpScreenHeader
        action={
          <Button
            className="ml-auto"
            leftIcon={<Plus color={theme.text} size={16} />}
            onPress={openCustomSetup}
            size="sm"
            variant="outline"
          >
            Add custom
          </Button>
        }
        backHref={
          mcpServers.length > 0 ? "/settings/mcp/connected" : "/settings"
        }
        title="MCP servers"
      />

      {catalogPresets.length > 0 ? (
        <>
          <SearchBox
            onChangeText={setQuery}
            placeholder="Search MCP servers"
            value={query}
          />
          {filteredPresets.length > 0 ? (
            <Card className="overflow-hidden">
              {filteredPresets.map((preset, index) => {
                const installed = mcpServers.find(
                  (server) =>
                    normalizeMcpUrl(server.url) === normalizeMcpUrl(preset.url),
                ) ?? null;
                const support = deriveMcpPresetStatus(preset, installed, {
                  appVersion: Constants.expoConfig?.version ?? null,
                  platform: Platform.OS,
                });

                return (
                  <View key={preset.id}>
                    {index > 0 ? <Separator /> : null}
                    <PresetRow
                      busy={busyKey === preset.id}
                      connected={installed !== null}
                      onPress={() => connectPreset(preset).catch(console.error)}
                      preset={preset}
                      statusLabel={
                        support.status === "installed" || support.status === "not-installed"
                          ? null
                          : (support.reason ??
                            describeDynamicUpdateStatus(support.status))
                      }
                      unavailable={
                        support.status === "revoked" ||
                        support.status === "requires-app-update"
                      }
                    />
                  </View>
                );
              })}
            </Card>
          ) : (
            <Card className="px-sp-4 py-sp-4">
              <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                {`No MCP servers match "${query}".`}
              </Text>
            </Card>
          )}
        </>
      ) : catalogLoading ? (
        <Card className="px-sp-4 py-sp-4">
          <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
            Loading preconfigured MCP servers…
          </Text>
        </Card>
      ) : (
        <Card className="px-sp-4 py-sp-4">
          <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
            No preconfigured MCP servers found. Use Add custom above to connect
            your own.
          </Text>
        </Card>
      )}

      {catalogError ? (
        <Text className="font-sans text-sm text-destructive dark:text-destructive-dark">
          {catalogError}
        </Text>
      ) : null}
      {error ? (
        <Text className="font-sans text-sm text-destructive dark:text-destructive-dark">
          {error}
        </Text>
      ) : null}

      <Drawer onOpenChange={setSetupDrawerOpen} open={setupDrawerOpen}>
        <DrawerContent showCloseButton showHandle>
          <DrawerHeader>
            <DrawerTitle>Set up MCP server</DrawerTitle>
            <DrawerDescription>
              Review the connection and authentication settings before adding
              this server.
            </DrawerDescription>
          </DrawerHeader>
          <DrawerBody contentContainerClassName="pb-sp-4">
            <McpServerForm
              key={setupPresetId ?? "custom"}
              onSaved={() => {
                setSetupDrawerOpen(false);
                router.replace("/settings/mcp/connected" as never);
              }}
              presetId={setupPresetId ?? undefined}
            />
          </DrawerBody>
        </DrawerContent>
      </Drawer>
    </Container>
  );
}

function PresetRow({
  busy,
  connected,
  onPress,
  preset,
  statusLabel,
  unavailable,
}: {
  busy: boolean;
  connected: boolean;
  onPress: () => void;
  preset: McpServerPreset;
  statusLabel: string | null;
  unavailable: boolean;
}) {
  return (
    <View className="flex-row items-center gap-sp-3 px-sp-4 py-sp-4">
      <View className="min-w-0 flex-1 gap-1">
        <Text className="font-sans text-base font-semibold text-foreground dark:text-foreground-dark">
          {preset.label}
        </Text>
        <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
          {preset.description}
        </Text>
        {preset.publisher || preset.version ? (
          <Text className="font-mono text-xs text-muted-foreground dark:text-muted-foreground-dark">
            {[preset.publisher, preset.version ? `v${preset.version}` : null]
              .filter(Boolean)
              .join(" · ")}
          </Text>
        ) : null}
        {statusLabel ? (
          <Text className="font-mono text-xs text-muted-foreground dark:text-muted-foreground-dark">
            {statusLabel}
          </Text>
        ) : null}
      </View>
      <Button
        disabled={connected || unavailable}
        loading={busy}
        onPress={onPress}
        size="sm"
        variant={connected ? "secondary" : "outline"}
      >
        {connected ? "Added" : unavailable ? "Unavailable" : "Set up"}
      </Button>
    </View>
  );
}
