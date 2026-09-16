import { describe, expect, it } from "vitest";

import type { ResolvedModel } from "@/core/types/app-state";
import {
  buildModelDetailInfo,
  findDevModalities,
  findLiveCatalogEntry,
  formatContextWindow,
  formatPricePerMillion,
  groupModelsByProvider,
  parseContextWindowInput,
  resolveDisplayBadges,
  resolveModelAvailability,
  searchModels,
} from "@/modules/models/model-display";

function model(overrides: Partial<ResolvedModel> = {}): ResolvedModel {
  return {
    active: true,
    capabilities: { imageGeneration: false, imageInput: true, reasoning: false, tools: true },
    contextWindow: 128000,
    isDefault: false,
    isFree: false,
    label: "Model",
    modelId: "model-1",
    options: null,
    outputType: "text",
    providerAuthType: "apiKey",
    providerFamily: "anthropic",
    providerId: "anthropic",
    providerLabel: "Anthropic",
    ref: "anthropic/model-1",
    source: "suggested",
    supportsImageGeneration: false,
    supportsImageInput: true,
    supportsReasoning: false,
    supportsTools: true,
    transport: "anthropic",
    ...overrides,
  };
}

describe("model-display", () => {
  it("emits only verified capability badges in stable order", () => {
    const badges = resolveDisplayBadges(model()).map((badge) => badge.key);
    expect(badges).toEqual(["tools", "vision"]);
    const withMedia = resolveDisplayBadges(model(), {
      input: ["text", "audio", "video"],
      output: ["text"],
    }).map((badge) => badge.key);
    expect(withMedia).toContain("audioInput");
    expect(withMedia).toContain("videoInput");
    expect(withMedia).not.toContain("audioOutput");
    // No modalities, no audio/video — never inferred.
    expect(badges).not.toContain("audioInput");
  });

  it("marks image generation from outputType", () => {
    const badges = resolveDisplayBadges(
      model({ capabilities: { imageGeneration: false, imageInput: false, reasoning: false, tools: true }, outputType: "image" }),
    ).map((badge) => badge.key);
    expect(badges).toContain("image");
  });

  it("formats context windows compactly", () => {
    expect(formatContextWindow(128000)).toBe("128K");
    expect(formatContextWindow(1000000)).toBe("1M");
    expect(formatContextWindow(200000)).toBe("200K");
    expect(formatContextWindow(1500000)).toBe("1.5M");
    expect(formatContextWindow(null)).toBeNull();
    expect(formatContextWindow(-5)).toBeNull();
  });

  it("formats per-million pricing", () => {
    expect(formatPricePerMillion(3)).toBe("$3.00");
    expect(formatPricePerMillion(0)).toBe("Free");
    expect(formatPricePerMillion(null)).toBeNull();
  });

  it("resolves availability with provider state first", () => {
    expect(
      resolveModelAvailability({ discoveryStatus: "failed", modelActive: true, providerEnabled: true }),
    ).toBe("discovery-failed");
    expect(
      resolveModelAvailability({ modelActive: false, providerEnabled: true }),
    ).toBe("needs-key");
    expect(
      resolveModelAvailability({ modelActive: true, providerEnabled: false }),
    ).toBe("provider-disabled");
    expect(
      resolveModelAvailability({ modelActive: true, providerEnabled: true }),
    ).toBe("available");
  });

  it("searches name, id, provider, and badges locally", () => {
    const models = [
      model({ label: "Claude Sonnet", modelId: "claude-sonnet", providerLabel: "Anthropic" }),
      model({ label: "GPT", modelId: "gpt-1", providerId: "o", providerLabel: "OpenAI", ref: "o/gpt-1" }),
    ];
    expect(searchModels(models, () => [], "").length).toBe(2);
    expect(searchModels(models, () => [], "sonnet").length).toBe(1);
    expect(searchModels(models, () => [], "openai").length).toBe(1);
    expect(
      searchModels(models, (entry) => (entry.modelId === "gpt-1" ? [{ key: "reasoning", label: "Reasoning", description: "" }] : []), "reasoning").length,
    ).toBe(1);
  });

  it("groups by provider, sorted", () => {
    const groups = groupModelsByProvider([
      model({ providerId: "b", providerLabel: "Bravo", ref: "b/1", modelId: "1" }),
      model({ providerId: "a", providerLabel: "Alpha", ref: "a/1", modelId: "1" }),
    ]);
    expect(groups.map((group) => group.providerId)).toEqual(["a", "b"]);
  });

  it("matches live entries by id variants", () => {
    const catalog = [
      {
        contextWindow: 200000,
        id: "anthropic/claude-x",
        inputPricePerToken: 0.000003,
        maxTokens: 8192,
        name: "Claude X",
        outputPricePerToken: 0.000015,
        ownedBy: "anthropic",
        tags: ["vision"],
        type: "language",
      },
    ];
    expect(findLiveCatalogEntry(catalog, { id: "anthropic" }, "claude-x")?.name).toBe(
      "Claude X",
    );
    expect(findLiveCatalogEntry(catalog, { id: "anthropic" }, "nope")).toBeNull();
    expect(findLiveCatalogEntry([], { id: "anthropic" }, "claude-x")).toBeNull();
  });

  it("builds detail info with usage over verified max", () => {
    const detail = buildModelDetailInfo({
      live: {
        contextWindow: 128000,
        id: "x",
        inputPricePerToken: 0.000003,
        maxTokens: 4096,
        name: "X",
        outputPricePerToken: 0.000015,
        ownedBy: "a",
        tags: [],
        type: "language",
      },
      model: model(),
      usedTokens: 24000,
    });
    expect(detail.usageLabel).toBe("24K / 128K");
    expect(detail.inputPrice).toBe("$3.00");
    expect(detail.outputPrice).toBe("$15.00");
    expect(detail.maxTokensLabel).toBe("4.1K");
    const bare = buildModelDetailInfo({ model: model({ contextWindow: null }) });
    expect(bare.usageLabel).toBeNull();
    expect(bare.inputPrice).toBeNull();
  });

  it("finds verified models.dev modalities", () => {
    const catalog = {
      deepseek: {
        api: "https://api.deepseek.com/v1",
        models: {
          "deepseek-chat": {
            modalities: { input: ["text", "audio"], output: ["text"] },
          },
        },
      },
    };
    const provider = {
      baseUrl: "https://api.deepseek.com/v1",
      family: "openai-compatible" as const,
      id: "custom-deepseek",
    };
    expect(findDevModalities(catalog, provider, "deepseek-chat")).toEqual({
      input: ["text", "audio"],
      output: ["text"],
    });
    expect(findDevModalities(catalog, provider, "unknown")).toBeNull();
    expect(findDevModalities({}, provider, "deepseek-chat")).toBeNull();
  });

  it("parses user-typed context windows conservatively", () => {
    expect(parseContextWindowInput("128000")).toBe(128000);
    expect(parseContextWindowInput("128k")).toBe(128000);
    expect(parseContextWindowInput("1.5M")).toBe(1500000);
    expect(parseContextWindowInput("")).toBeNull();
    expect(parseContextWindowInput("unlimited")).toBeNull();
    expect(parseContextWindowInput("-5")).toBeNull();
    expect(parseContextWindowInput("0")).toBeNull();
  });
});
