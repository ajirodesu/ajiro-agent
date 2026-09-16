/**
 * Manual model entry helpers for provider configuration.
 *
 * When the live model fetch fails (or the provider has no listing
 * endpoint), users can add models by exact ID. These pure helpers drive
 * the fallback form: input normalization/validation plus preset lookup
 * for the per-provider manage list (edit/remove). Persistence, picker
 * selection, and request execution all flow through model presets, so a
 * manually added model behaves exactly like a fetched one.
 */
import type { ModelPreset } from "@/core/types/app-state";

/** Trimmed model ID, or `""` when the input is blank. */
export function normalizeModelIdInput(input: string): string {
  return input.trim();
}

/** Non-empty after trimming (extra whitespace is not allowed through). */
export function isModelIdValid(input: string): boolean {
  return normalizeModelIdInput(input).length > 0;
}

/** Find the stored preset backing a provider model ID, if any. */
export function findPresetForModel(
  presets: ModelPreset[],
  providerId: string,
  modelId: string,
): ModelPreset | null {
  const wanted = modelId.trim();
  return (
    presets.find(
      (preset) =>
        preset.providerId === providerId && preset.modelId === wanted,
    ) ?? null
  );
}

/** All stored presets belonging to one provider. */
export function presetsForProvider(
  presets: ModelPreset[],
  providerId: string,
): ModelPreset[] {
  return presets
    .filter((preset) => preset.providerId === providerId)
    .sort((left, right) => left.modelId.localeCompare(right.modelId));
}
