/**
 * Model display model (pure, unit-tested).
 *
 * Adapts the lobehub ModelSwitchPanel information architecture (provider
 * grouping, current-model indication, capability badges, context + pricing
 * detail, availability states) onto Ajiro Agent's verified metadata only:
 * - capabilities: `ResolvedModel.capabilities` (family defaults + stored
 *   hints + reasoning heuristic — the same flags the runtime executes with).
 * - audio/video: ONLY from models.dev `modalities` when available for that
 *   provider; never inferred. Structured output is not tracked in Ajiro
 *   metadata at all, so it is never displayed (prompt §11: no fabrication).
 * - context window: `ResolvedModel.contextWindow` (catalog suggestion,
 *   stored preset profile, or null = honestly unknown).
 * - pricing/max tokens: live AI Gateway catalog entries matched by id.
 * - availability: provider enabled + credential presence
 *   (`ResolvedModel.active`) + discovery status.
 * - usage: conversation token state (via `useContextUsage` in UI).
 */

import type {
  ProviderConfig,
  ResolvedModel,
} from "@/core/types/app-state";
import type { LiveCatalogModel } from "@/modules/config/live-model-catalog";
import {
  resolveModelsDevProviderKey,
  type ModelsDevProvider,
} from "@/modules/config/models-dev-catalog";

export type DisplayCapabilityKey =
  | "tools"
  | "vision"
  | "image"
  | "reasoning"
  | "audioInput"
  | "audioOutput"
  | "videoInput"
  | "videoOutput";

export interface CapabilityBadge {
  key: DisplayCapabilityKey;
  label: string;
  /** Longer accessible description for screen readers/detail. */
  description: string;
}

const BASE_BADGES: CapabilityBadge[] = [
  { key: "tools", label: "Tools", description: "Can call tools" },
  {
    key: "vision",
    label: "Vision",
    description: "Understands image input",
  },
  {
    key: "image",
    label: "Image",
    description: "Generates images",
  },
  {
    key: "reasoning",
    label: "Reasoning",
    description: "Reasoning-capable model",
  },
];

export interface VerifiedModalities {
  input: string[];
  output: string[];
}

function hasModality(modalities: VerifiedModalities | null | undefined, side: "input" | "output", name: string): boolean {
  return modalities?.[side].some((entry) => entry.toLowerCase() === name) ?? false;
}

/**
 * Badges for the compact row: verified capabilities only, stable order.
 * Audio/video appear exclusively on modalities evidence.
 */
export function resolveDisplayBadges(
  model: Pick<ResolvedModel, "capabilities" | "outputType">,
  modalities?: VerifiedModalities | null,
): CapabilityBadge[] {
  const badges: CapabilityBadge[] = [];
  if (model.capabilities.tools) badges.push(BASE_BADGES[0]!);
  if (model.capabilities.imageInput) badges.push(BASE_BADGES[1]!);
  if (model.capabilities.imageGeneration || model.outputType === "image") {
    badges.push(BASE_BADGES[2]!);
  }
  if (model.capabilities.reasoning) badges.push(BASE_BADGES[3]!);
  if (hasModality(modalities, "input", "audio")) {
    badges.push({ key: "audioInput", label: "Audio", description: "Accepts audio input" });
  }
  if (hasModality(modalities, "output", "audio")) {
    badges.push({ key: "audioOutput", label: "Audio out", description: "Produces audio output" });
  }
  if (hasModality(modalities, "input", "video")) {
    badges.push({ key: "videoInput", label: "Video", description: "Accepts video input" });
  }
  if (hasModality(modalities, "output", "video")) {
    badges.push({ key: "videoOutput", label: "Video out", description: "Produces video output" });
  }
  return badges;
}

/** 128000 → "128K", 1000000 → "1M", 8000 → "8K". Null stays null. */
export function formatContextWindow(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  if (value >= 1_000_000 && value % 1_000_000 === 0) return `${value / 1_000_000}M`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000 && value % 1000 === 0) return `${value / 1000}K`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return String(Math.round(value));
}

/** Per-million-token price: 3 → "$3.00", 0 → "Free", null → null. */
export function formatPricePerMillion(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  if (value === 0) return "Free";
  return `$${value.toFixed(2)}`;
}

/**
 * Parse a user-typed context window ("128000", "128k", "1.5M").
 * Returns null for blank/invalid input — callers treat null as unknown
 * (conservative default, never fabricated).
 */
export function parseContextWindowInput(text: string): number | null {
  const cleaned = text.trim().toLowerCase().replace(/[,_\s]+/g, "");
  if (!cleaned) return null;
  const match = /^(\d+(?:\.\d+)?)(k|m)?$/.exec(cleaned);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const multiplier = match[2] === "m" ? 1_000_000 : match[2] === "k" ? 1000 : 1;
  const value = Math.round(amount * multiplier);
  if (!Number.isSafeInteger(value) || value <= 0 || value > 100_000_000) return null;
  return value;
}

export type ModelAvailability =
  | "available"
  | "needs-key"
  | "provider-disabled"
  | "discovery-failed";

export function resolveModelAvailability(input: {
  discoveryStatus?: "connected" | "failed" | null;
  modelActive: boolean;
  providerEnabled: boolean;
}): ModelAvailability {
  if (!input.providerEnabled) return "provider-disabled";
  if (!input.modelActive) return "needs-key";
  if (input.discoveryStatus === "failed") return "discovery-failed";
  return "available";
}

export function availabilityLabel(availability: ModelAvailability): string | null {
  switch (availability) {
    case "available":
      return null;
    case "needs-key":
      return "Needs API key";
    case "provider-disabled":
      return "Provider disabled";
    case "discovery-failed":
      return "Refresh failed";
  }
}

/** Local filter over resolved models (no network): name, id, provider, badges. */
export function searchModels(
  models: ResolvedModel[],
  badgesFor: (model: ResolvedModel) => CapabilityBadge[],
  query: string,
): ResolvedModel[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return models;
  return models.filter((model) => {
    const badges = badgesFor(model)
      .map((badge) => badge.label)
      .join(" ");
    return [model.label, model.modelId, model.providerLabel, badges].some((field) =>
      field.toLowerCase().includes(needle),
    );
  });
}

export interface ProviderModelGroup {
  providerId: string;
  providerLabel: string;
  models: ResolvedModel[];
}

export function groupModelsByProvider(models: ResolvedModel[]): ProviderModelGroup[] {
  const groups = new Map<string, ProviderModelGroup>();
  for (const model of models) {
    const group = groups.get(model.providerId) ?? {
      models: [],
      providerId: model.providerId,
      providerLabel: model.providerLabel,
    };
    group.models.push(model);
    groups.set(model.providerId, group);
  }
  return [...groups.values()].sort((left, right) =>
    left.providerLabel.localeCompare(right.providerLabel),
  );
}

/**
 * Match a resolved model back to its live-catalog entry (for pricing and
 * max tokens, which are dropped before `ResolvedModel`). Mirrors the
 * owner-prefix logic in `getCatalogModelDefinitionsForProvider`; first
 * match wins, null when unverifiable.
 */
export function findLiveCatalogEntry(
  catalog: LiveCatalogModel[],
  provider: Pick<ProviderConfig, "id">,
  modelId: string,
): LiveCatalogModel | null {
  const language = catalog.filter((entry) => entry.type === "language");
  const pool =
    provider.id === "openrouter"
      ? language
      : language.filter((entry) => {
          const plain = entry.id.startsWith(`${entry.ownedBy}/`)
            ? entry.id.slice(entry.ownedBy.length + 1)
            : entry.id;
          return (
            entry.id === modelId ||
            plain === modelId ||
            entry.id.split("/").pop() === modelId
          );
        });
  if (provider.id === "openrouter") {
    return pool.find((entry) => entry.id === modelId) ?? null;
  }
  return pool[0] ?? null;
}

export interface ModelDetailInfo {
  badges: CapabilityBadge[];
  contextWindow: number | null;
  contextWindowLabel: string | null;
  inputPrice: string | null;
  maxTokens: number | null;
  maxTokensLabel: string | null;
  outputPrice: string | null;
  usageLabel: string | null;
}

/**
 * Verified models.dev modalities for one model (audio/video evidence).
 * Null when the provider has no catalog entry or the model is unknown —
 * callers then hide audio/video instead of guessing.
 */
export function findDevModalities(
  catalog: Record<string, ModelsDevProvider>,
  provider: Pick<ProviderConfig, "baseUrl" | "family" | "id">,
  modelId: string,
): VerifiedModalities | null {
  const key = resolveModelsDevProviderKey(catalog, provider as ProviderConfig);
  if (!key) return null;
  const models = catalog[key]?.models ?? {};
  for (const [entryKey, entry] of Object.entries(models)) {
    const id = entry.id?.trim() || entryKey;
    if (id !== modelId) continue;
    return {
      input: Array.isArray(entry.modalities?.input)
        ? entry.modalities.input.filter((item): item is string => typeof item === "string")
        : [],
      output: Array.isArray(entry.modalities?.output)
        ? entry.modalities.output.filter((item): item is string => typeof item === "string")
        : [],
    };
  }
  return null;
}

/** Build detail info; every field is either verified or null (hidden). */
export function buildModelDetailInfo(input: {
  live?: LiveCatalogModel | null;
  maxTokens?: number | null;
  model: ResolvedModel;
  modalities?: VerifiedModalities | null;
  usedTokens?: number | null;
}): ModelDetailInfo {
  const contextWindow = input.model.contextWindow;
  const maxTokens = input.maxTokens ?? input.live?.maxTokens ?? null;
  const used = input.usedTokens ?? null;
  const usedLabel =
    used === null ? null : (formatContextWindow(used) ?? String(used));
  const maxLabel = formatContextWindow(contextWindow);
  return {
    badges: resolveDisplayBadges(input.model, input.modalities),
    contextWindow,
    contextWindowLabel: maxLabel,
    inputPrice:
      input.live && input.live.inputPricePerToken !== null
        ? formatPricePerMillion(input.live.inputPricePerToken * 1_000_000)
        : null,
    maxTokens,
    maxTokensLabel: maxTokens !== null ? formatContextWindow(maxTokens) : null,
    outputPrice:
      input.live && input.live.outputPricePerToken !== null
        ? formatPricePerMillion(input.live.outputPricePerToken * 1_000_000)
        : null,
    usageLabel:
      usedLabel && maxLabel
        ? `${usedLabel} / ${maxLabel}`
        : (usedLabel ?? null),
  };
}
