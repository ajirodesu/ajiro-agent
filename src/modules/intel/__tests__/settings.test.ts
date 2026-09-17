import { describe, expect, it } from "vitest";

import {
  createMemoryIntelSettingsStore,
  DEFAULT_INTEL_SETTINGS,
  normalizeIntelSettings,
} from "@/modules/intel/settings";

describe("intel settings", () => {
  it("normalizes unknown input to defaults", () => {
    expect(normalizeIntelSettings(null)).toEqual(DEFAULT_INTEL_SETTINGS);
    expect(normalizeIntelSettings({ aiCompletionEnabled: true }).aiCompletionEnabled).toBe(true);
  });

  it("drops wrong-typed values and clamps ranges", () => {
    const settings = normalizeIntelSettings({
      tabSize: 99,
      fontSize: "big",
      formatOnSaveLanguages: ["ts", 42],
      maxCompletionItems: 0,
    });
    expect(settings.tabSize).toBe(8);
    expect(settings.fontSize).toBe(DEFAULT_INTEL_SETTINGS.fontSize);
    expect(settings.formatOnSaveLanguages).toEqual(["ts"]);
    expect(settings.maxCompletionItems).toBe(5);
  });

  it("memory store persists and notifies", async () => {
    const store = createMemoryIntelSettingsStore();
    const seen: boolean[] = [];
    const unsubscribe = store.subscribe((settings) => {
      seen.push(settings.inlayHintsEnabled);
    });
    await store.save({ ...DEFAULT_INTEL_SETTINGS, inlayHintsEnabled: true });
    expect((await store.load()).inlayHintsEnabled).toBe(true);
    expect(seen).toEqual([true]);
    unsubscribe();
    await store.save({ ...DEFAULT_INTEL_SETTINGS, inlayHintsEnabled: false });
    expect(seen).toEqual([true]);
  });
});
