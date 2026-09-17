import { describe, expect, it, vi } from "vitest";

import { createDocumentManager } from "@/modules/intel/documents";

describe("document manager", () => {
  it("opens with version 1 and dirty state", () => {
    const manager = createDocumentManager();
    const state = manager.open("file:///a.ts", "typescript", "const x = 1;");
    expect(state.version).toBe(1);
    expect(state.dirty).toBe(true);
    expect(manager.getText("file:///a.ts")).toBe("const x = 1;");
  });

  it("applies incremental changes and bumps versions", () => {
    const manager = createDocumentManager();
    manager.open("file:///a.ts", "typescript", "hello world");
    // Replace "world" (offsets 6..11) with "there".
    const next = manager.update("file:///a.ts", [{ from: 6, to: 11, insert: "there" }], null);
    expect(next?.text).toBe("hello there");
    expect(next?.version).toBe(2);
    expect(next?.dirty).toBe(true);
  });

  it("full sync replaces text and skips identical updates", () => {
    const manager = createDocumentManager();
    manager.open("file:///a.ts", "typescript", "abc");
    const same = manager.update("file:///a.ts", null, "abc");
    expect(same?.version).toBe(1);
    const changed = manager.update("file:///a.ts", null, "abcd");
    expect(changed?.version).toBe(2);
    expect(changed?.text).toBe("abcd");
  });

  it("setClean only clears the exact saved version", () => {
    const manager = createDocumentManager();
    manager.open("file:///a.ts", "typescript", "a");
    manager.setClean("file:///a.ts", 1);
    expect(manager.get("file:///a.ts")?.dirty).toBe(false);
    manager.update("file:///a.ts", null, "ab");
    manager.setClean("file:///a.ts", 1);
    expect(manager.get("file:///a.ts")?.dirty).toBe(true);
  });

  it("update on unknown uri returns null; close removes", () => {
    const events = { onOpen: vi.fn(), onChange: vi.fn(), onClose: vi.fn() };
    const manager = createDocumentManager(events);
    expect(manager.update("file:///missing.ts", null, "x")).toBeNull();
    manager.open("file:///a.ts", "typescript", "x");
    expect(events.onOpen).toHaveBeenCalledWith("file:///a.ts");
    manager.close("file:///a.ts");
    expect(manager.has("file:///a.ts")).toBe(false);
    expect(events.onClose).toHaveBeenCalledWith("file:///a.ts");
  });

  it("stores diagnostics and flags", () => {
    const manager = createDocumentManager();
    manager.open("file:///a.ts", "typescript", "x");
    manager.setDiagnostics("file:///a.ts", []);
    manager.setSemanticReady("file:///a.ts", true);
    manager.setIndexed("file:///a.ts", true);
    const state = manager.get("file:///a.ts");
    expect(state?.semanticReady).toBe(true);
    expect(state?.indexed).toBe(true);
    expect(manager.uris()).toEqual(["file:///a.ts"]);
  });
});
