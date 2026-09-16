import { describe, expect, it } from "vitest";

import {
  findPresetForModel,
  isModelIdValid,
  normalizeModelIdInput,
  presetsForProvider,
} from "@/modules/config/manual-models";
import type { ModelPreset } from "@/core/types/app-state";

const preset = (overrides: Partial<ModelPreset> = {}): ModelPreset => ({
  id: "preset-1",
  providerId: "openai",
  modelId: "gpt-4o",
  label: "GPT-4o",
  isDefault: false,
  options: null,
  createdAt: "2026-09-15T12:00:00.000Z",
  updatedAt: "2026-09-15T12:00:00.000Z",
  ...overrides,
});

describe("manual-models", () => {
  it("trims input and rejects blanks", () => {
    expect(normalizeModelIdInput("  gpt-4o  ")).toBe("gpt-4o");
    expect(normalizeModelIdInput("   ")).toBe("");
    expect(isModelIdValid("claude-sonnet-4-6")).toBe(true);
    expect(isModelIdValid("  ")).toBe(false);
    expect(isModelIdValid("")).toBe(false);
  });

  it("finds the preset backing a model ID", () => {
    const presets = [
      preset(),
      preset({ id: "preset-2", providerId: "anthropic", modelId: "x" }),
    ];
    expect(findPresetForModel(presets, "openai", "gpt-4o")?.id).toBe(
      "preset-1",
    );
    expect(findPresetForModel(presets, "openai", "  gpt-4o ")).not.toBeNull();
    expect(findPresetForModel(presets, "openai", "missing")).toBeNull();
    expect(findPresetForModel(presets, "other", "gpt-4o")).toBeNull();
  });

  it("lists one provider's presets sorted by model ID", () => {
    const presets = [
      preset({ id: "b", modelId: "z-model" }),
      preset({ id: "a", modelId: "a-model" }),
      preset({ id: "c", providerId: "other", modelId: "m" }),
    ];
    expect(presetsForProvider(presets, "openai").map((p) => p.id)).toEqual([
      "a",
      "b",
    ]);
  });
});
