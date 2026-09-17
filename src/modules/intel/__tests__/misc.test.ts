import { describe, expect, it } from "vitest";

import { capabilitiesFor, semanticLanguages } from "@/modules/intel/capabilities";
import { createIntelPluginRegistry } from "@/modules/intel/plugins";
import { averageMs, createIntelPerf } from "@/modules/intel/perf";
import { createInlineCompletionController } from "@/modules/intel/inline";
import { createAiCompletionManager, toAiCompletionItems } from "@/modules/intel/ai-completion";

describe("capabilities matrix honesty", () => {
  it("claims semantic only where a real engine exists", () => {
    expect(capabilitiesFor("typescript").semantic).toBe(true);
    expect(capabilitiesFor("tsx").semantic).toBe(true);
    for (const language of ["python", "go", "rust", "kotlin", "java", "cpp"]) {
      expect(capabilitiesFor(language).semantic).toBe(false);
    }
    expect(semanticLanguages()).toEqual(
      expect.arrayContaining(["typescript", "javascript", "tsx", "jsx"]),
    );
    expect(capabilitiesFor("klingon").note).toMatch(/unknown/i);
  });
});

describe("plugin registry", () => {
  it("registers, filters, and unregisters providers", () => {
    const registry = createIntelPluginRegistry();
    const unregister = registry.registerCompletion({
      id: "test",
      languageIds: ["typescript"],
      provide: () => Promise.resolve([]),
    });
    expect(registry.completionsFor("typescript")).toHaveLength(1);
    expect(registry.completionsFor("python")).toHaveLength(0);
    unregister();
    expect(registry.completionsFor("typescript")).toHaveLength(0);
  });

  it("prefers language-specific formatters over generic ones", () => {
    const registry = createIntelPluginRegistry();
    registry.registerFormatter({ id: "generic", languageIds: "all", format: () => Promise.resolve(null) });
    registry.registerFormatter({ id: "ts", languageIds: ["typescript"], format: () => Promise.resolve(null) });
    expect(registry.formatterFor("typescript")?.id).toBe("ts");
    expect(registry.formatterFor("python")?.id).toBe("generic");
    expect(registry.formatterFor("go")?.id).toBe("generic");
  });
});

describe("perf instrumentation", () => {
  it("records samples and counters", async () => {
    const perf = createIntelPerf();
    await perf.time("completion", () => Promise.resolve(1));
    perf.count("stale", 2);
    const snapshot = perf.snapshot();
    expect(snapshot.operations.completion?.samples).toBe(1);
    expect(averageMs(snapshot.operations.completion!)).toBeGreaterThanOrEqual(0);
    expect(snapshot.counters.stale).toBe(2);
    perf.reset();
    expect(perf.snapshot().operations).toEqual({});
  });
});

describe("inline ghost controller", () => {
  it("offers, accepts, and invalidates on edit", () => {
    const controller = createInlineCompletionController();
    controller.offer([{ id: 1, text: "hello()", source: "ai" }]);
    expect(controller.state().ghost).toBe("hello()");
    const accepted = controller.accept();
    expect(accepted?.text).toBe("hello()");
    expect(controller.state().ghost).toBe("");
  });

  it("accepts word-by-word and cycles suggestions", () => {
    const controller = createInlineCompletionController();
    controller.offer([
      { id: 1, text: "fooBar(x)", source: "semantic" },
      { id: 2, text: "fooBaz(x)", source: "semantic" },
    ]);
    expect(controller.acceptWord()?.text).toBe("fooBar");
    expect(controller.state().ghost).toBe("(x)");
    controller.reject();
    controller.offer([
      { id: 1, text: "a", source: "ai" },
      { id: 2, text: "b", source: "ai" },
    ]);
    controller.next();
    expect(controller.state().suggestionId).toBe(2);
    controller.previous();
    expect(controller.state().suggestionId).toBe(1);
    controller.onDocumentChange(2, 0);
    expect(controller.state().ghost).toBe("");
  });
});

describe("AI completion separation", () => {
  it("stays off without a provider and tags its category", async () => {
    const manager = createAiCompletionManager({ enabled: true });
    expect(manager.isEnabled()).toBe(false);
    manager.setProvider({ id: "test", suggest: () => Promise.resolve([{ text: "x = 1" }]) });
    expect(manager.isEnabled()).toBe(true);
    const result = await manager.request("f.ts", "typescript", "const value = ", 14, 3);
    expect(result.texts).toEqual(["x = 1"]);
    const items = toAiCompletionItems(result.texts);
    expect(items[0]?.source).toBe("ai");
    manager.setEnabled(false);
    expect(manager.isEnabled()).toBe(false);
  });
});
