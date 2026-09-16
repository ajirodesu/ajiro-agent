/**
 * Choose Model Modal host: binds the presentational `ModelModal` to real
 * runtime state (resolved models, providers, discovery, live catalogs,
 * context usage). Selection writes through `selectModel`, so the model
 * shown as active is exactly what the agent runtime resolves.
 */
import { useCallback, useMemo, useState } from "react";
import { useRouter } from "expo-router";

import { useConfig } from "@/hooks/use-config";
import { useLiveModelCatalog } from "@/hooks/use-live-model-catalog";
import { useModelsDevCatalog } from "@/hooks/use-models-dev-catalog";
import { useContextUsage } from "@/components/ui/context-usage";
import { invalidateLiveModelCatalog } from "@/modules/config/live-model-catalog";
import type { ModelRef } from "@/core/types/app-state";
import {
  availabilityLabel,
  buildModelDetailInfo,
  findDevModalities,
  findLiveCatalogEntry,
  formatContextWindow,
  groupModelsByProvider,
  resolveDisplayBadges,
  resolveModelAvailability,
} from "@/modules/models/model-display";
import type {
  ModelModalDetail,
  ModelModalGroup,
} from "@/components/models/model-modal";
import { ModelModal } from "@/components/models/model-modal";
import type { ModelAvailability } from "@/modules/models/model-display";

export function ComposerModelModal({
  onOpenChange,
  open,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const router = useRouter();
  const {
    activeModelRef,
    activeProviderIds,
    availableModels,
    currentModel,
    providerModelDiscovery,
    providers,
    refresh,
    selectModel,
    updateProvider,
  } = useConfig();
  const liveCatalog = useLiveModelCatalog();
  const devCatalog = useModelsDevCatalog();
  const usage = useContextUsage();

  const [detailRef, setDetailRef] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const providersById = useMemo(
    () => new Map(providers.map((provider) => [provider.id, provider])),
    [providers],
  );

  const groups: ModelModalGroup[] = useMemo(() => {
    const dev = devCatalog.data ?? null;
    const withModels = groupModelsByProvider(availableModels);
    const covered = new Set(withModels.map((group) => group.providerId));
    // Providers with zero suggestions still get a group so misconfigured
    // providers are visible (with a settings path) instead of vanishing.
    for (const provider of providersById.values()) {
      if (!covered.has(provider.id)) {
        withModels.push({
          models: [],
          providerId: provider.id,
          providerLabel: provider.label,
        });
      }
    }
    return withModels
      .sort((left, right) => left.providerLabel.localeCompare(right.providerLabel))
      .map((group) => {
      const provider = providersById.get(group.providerId);
      const discovery = providerModelDiscovery[group.providerId];
      return {
        discoveryError:
          discovery?.status === "failed" ? (discovery.error ?? "Refresh failed.") : null,
        enabled: provider?.enabled ?? true,
        hasCredential: activeProviderIds.includes(group.providerId),
        models: group.models.map((model) => {
          const modalities =
            dev && provider
              ? findDevModalities(dev, provider, model.modelId)
              : null;
          const availability = resolveModelAvailability({
            discoveryStatus: discovery?.status ?? null,
            modelActive: model.active,
            providerEnabled: provider?.enabled ?? true,
          });
          return {
            availability,
            availabilityNote:
              availabilityLabel(availability) ?? discovery?.error ?? null,
            badges: resolveDisplayBadges(model, modalities).map((badge) => ({
              key: badge.key,
              label: badge.label,
            })),
            contextLabel: formatContextWindow(model.contextWindow),
            custom: model.source === "custom",
            free: model.isFree,
            label: model.label,
            modelId: model.modelId,
            ref: model.ref,
            selected: currentModel?.ref === model.ref,
          };
        }),
        providerId: group.providerId,
        providerLabel: group.providerLabel,
      };
    });
  }, [
    activeProviderIds,
    availableModels,
    currentModel,
    devCatalog.data,
    providerModelDiscovery,
    providersById,
  ]);

  const detail: ModelModalDetail | null = useMemo(() => {
    if (!detailRef) return null;
    const model = availableModels.find((entry) => entry.ref === detailRef);
    if (!model) return null;
    const provider = providersById.get(model.providerId);
    const live =
      liveCatalog.data && provider
        ? findLiveCatalogEntry(liveCatalog.data, provider, model.modelId)
        : null;
    const modalities =
      devCatalog.data && provider ? findDevModalities(devCatalog.data, provider, model.modelId) : null;
    const info = buildModelDetailInfo({
      live,
      model,
      modalities,
      usedTokens: usage.usedTokens,
    });
    const availability: ModelAvailability = resolveModelAvailability({
      discoveryStatus: providerModelDiscovery[model.providerId]?.status ?? null,
      modelActive: model.active,
      providerEnabled: provider?.enabled ?? true,
    });
    return {
      availabilityNote: availabilityLabel(availability),
      badges: info.badges,
      contextLabel: info.contextWindowLabel,
      custom: model.source === "custom",
      free: model.isFree,
      inputPrice: info.inputPrice,
      label: model.label,
      maxTokensLabel: info.maxTokensLabel,
      modelId: model.modelId,
      outputPrice: info.outputPrice,
      outputType: model.outputType,
      providerLabel: model.providerLabel,
      ref: model.ref,
      usageLabel: info.usageLabel,
    };
  }, [
    availableModels,
    detailRef,
    devCatalog.data,
    liveCatalog.data,
    providerModelDiscovery,
    providersById,
    usage.usedTokens,
  ]);

  const staleBanner =
    activeModelRef && currentModel && activeModelRef !== currentModel.ref
      ? {
          currentLabel: currentModel.label,
          onFix: () => {
            selectModel(currentModel.ref).catch((error: unknown) => {
              setNotice(error instanceof Error ? error.message : "Could not switch model.");
            });
          },
          requestedLabel: activeModelRef,
        }
      : null;

  const handleSelectModel = useCallback(
    (ref: string) => {
      setNotice(null);
      selectModel(ref as ModelRef)
        .then(() => {
          onOpenChange(false);
        })
        .catch((error: unknown) => {
          setNotice(error instanceof Error ? error.message : "Could not switch model.");
        });
    },
    [onOpenChange, selectModel],
  );

  const handleToggleProviderEnabled = useCallback(
    (providerId: string, enabled: boolean) => {
      setNotice(null);
      updateProvider(providerId, { enabled }).catch((error: unknown) => {
        setNotice(error instanceof Error ? error.message : "Could not update provider.");
      });
    },
    [updateProvider],
  );

  const handleRefreshModels = useCallback(() => {
    setRefreshing(true);
    setNotice(null);
    invalidateLiveModelCatalog();
    refresh()
      .catch((error: unknown) => {
        setNotice(error instanceof Error ? error.message : "Refresh failed.");
      })
      .finally(() => {
        setRefreshing(false);
      });
  }, [refresh]);

  const goProviders = useCallback(
    (params?: { addProvider?: string; provider?: string }) => {
      onOpenChange(false);
      router.push({ params, pathname: "/settings/providers" });
    },
    [onOpenChange, router],
  );

  return (
    <ModelModal
      detail={detail}
      groups={groups}
      notice={notice}
      onAddProvider={() => goProviders({ addProvider: "1" })}
      onOpenChange={(next) => {
        if (!next) {
          setDetailRef(null);
          setNotice(null);
        }
        onOpenChange(next);
      }}
      onOpenDetail={setDetailRef}
      onOpenProviderSettings={(providerId) => goProviders({ provider: providerId })}
      onRefreshModels={handleRefreshModels}
      onSelectModel={handleSelectModel}
      onToggleProviderEnabled={handleToggleProviderEnabled}
      open={open}
      refreshing={refreshing}
      staleBanner={staleBanner}
    />
  );
}
