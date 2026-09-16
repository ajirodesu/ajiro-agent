import { describe, expect, it } from "vitest";

import { resolveConfiguredModel } from "@/modules/providers/catalog";

const PROVIDER = {
  authType: "apiKey" as const,
  family: "openai-compatible" as const,
  id: "custom",
  label: "Custom",
};

describe("resolveConfiguredModel stored profile", () => {
  it("prefers catalog context windows, then stored preset profiles", () => {
    const catalogued = resolveConfiguredModel({
      active: true,
      definition: { id: "m", kind: "chat", label: "M", contextWindow: 64000 },
      isDefault: false,
      modelId: "m",
      provider: PROVIDER,
    });
    expect(catalogued?.contextWindow).toBe(64000);

    const stored = resolveConfiguredModel({
      active: true,
      isDefault: false,
      modelId: "m",
      preset: {
        createdAt: "",
        id: "p",
        isDefault: false,
        label: null,
        modelId: "m",
        options: {
          __ajiroAgentModelProfile: { contextWindow: 32000 },
        },
        providerId: "custom",
        updatedAt: "",
      },
      provider: PROVIDER,
    });
    expect(stored?.contextWindow).toBe(32000);

    const unknown = resolveConfiguredModel({
      active: true,
      isDefault: false,
      modelId: "m",
      preset: {
        createdAt: "",
        id: "p",
        isDefault: false,
        label: null,
        modelId: "m",
        options: null,
        providerId: "custom",
        updatedAt: "",
      },
      provider: PROVIDER,
    });
    expect(unknown?.contextWindow).toBeNull();
  });

  it("honors explicit stored capabilities for custom models", () => {
    const verified = resolveConfiguredModel({
      active: true,
      isDefault: false,
      modelId: "m",
      preset: {
        createdAt: "",
        id: "p",
        isDefault: false,
        label: null,
        modelId: "m",
        options: {
          __ajiroAgentModelProfile: {
            capabilities: {
              imageGeneration: false,
              imageInput: true,
              reasoning: false,
              tools: false,
            },
          },
        },
        providerId: "custom",
        updatedAt: "",
      },
      provider: PROVIDER,
    });
    expect(verified?.supportsImageInput).toBe(true);
    expect(verified?.supportsTools).toBe(false);
    expect(verified?.supportsReasoning).toBe(false);
  });
});
