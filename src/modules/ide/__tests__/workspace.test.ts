import { describe, expect, it, vi } from "vitest";

import { createIdeEventBus } from "@/modules/ide/events";
import {
  emptyPersistedIdeState,
  getActiveProject,
  getUiState,
  lifecycleForActive,
  markDirty,
  registerProject,
  removeProject,
  sessionForProject,
  setUiState,
  touchProjectOpened,
} from "@/modules/ide/workspace";

const NOW = "2026-01-01T00:00:00.000Z";

describe("ide event bus", () => {
  it("fans out without letting listeners break each other", () => {
    const bus = createIdeEventBus();
    const seen: string[] = [];
    bus.subscribe((event) => {
      seen.push(event.type);
    });
    bus.subscribe(() => {
      throw new Error("bad listener");
    });
    bus.emit({ type: "PROJECT_OPENED", projectId: "p1" });
    expect(seen).toEqual(["PROJECT_OPENED"]);
    expect(bus.listenerCount()).toBe(2);
  });

  it("unsubscribes cleanly", () => {
    const bus = createIdeEventBus();
    const fn = vi.fn();
    const off = bus.subscribe(fn);
    off();
    bus.emit({ type: "PROJECT_OPENED", projectId: "p1" });
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("project registry", () => {
  it("registers, deduplicates by uri, and activates", () => {
    let state = emptyPersistedIdeState();
    state = registerProject(
      state,
      { name: "App", uri: "content://a", displayName: "App" },
      NOW,
    );
    expect(state.projects.length).toBe(1);
    state = registerProject(
      state,
      { name: "App2", uri: "content://a", displayName: "App2" },
      NOW,
    );
    expect(state.projects.length).toBe(1);
    expect(state.projects[0]?.name).toBe("App2");

    const withActive = { ...state, activeProjectId: state.projects[0]!.id };
    expect(getActiveProject(withActive)?.uri).toBe("content://a");
    expect(getActiveProject(state)).toBeNull();
  });

  it("removes projects and clears dangling active ids + ui state", () => {
    let state = emptyPersistedIdeState();
    state = registerProject(
      state,
      { name: "App", uri: "content://a", displayName: "App" },
      NOW,
    );
    const id = state.projects[0]!.id;
    state = setUiState({ ...state, activeProjectId: id }, id, {
      tabs: ["a.ts"],
    });
    state = removeProject(state, id);
    expect(state.projects).toEqual([]);
    expect(state.activeProjectId).toBeNull();
    expect(state.uiStates[id]).toBeUndefined();
  });

  it("tracks ui state and dirty paths per project", () => {
    let state = emptyPersistedIdeState();
    state = setUiState(state, "p1", {
      tabs: ["a.ts"],
      activePath: "a.ts",
      expanded: ["src"],
      terminalCwd: "src",
    });
    expect(getUiState(state, "p1").tabs).toEqual(["a.ts"]);
    expect(getUiState(state, "p2").tabs).toEqual([]);
    state = markDirty(state, "p1", "a.ts", true);
    state = markDirty(state, "p1", "a.ts", true);
    expect(getUiState(state, "p1").dirtyPaths).toEqual(["a.ts"]);
    state = markDirty(state, "p1", "a.ts", false);
    expect(getUiState(state, "p1").dirtyPaths).toEqual([]);
  });

  it("derives lifecycle from the active project", () => {
    expect(lifecycleForActive(null, [])).toBe("NO_PROJECT");
    expect(lifecycleForActive("missing", [])).toBe("NO_PROJECT");
    let state = emptyPersistedIdeState();
    state = registerProject(
      state,
      { name: "App", uri: "content://a", displayName: "App" },
      NOW,
    );
    const id = state.projects[0]!.id;
    expect(lifecycleForActive(id, state.projects)).toBe("PROJECT_READY");
    const touched = touchProjectOpened(state, id, "2026-02-01T00:00:00.000Z");
    expect(touched.projects[0]?.lastOpenedAt).toBe("2026-02-01T00:00:00.000Z");
  });

  it("builds sessions for the active project", () => {
    let state = emptyPersistedIdeState();
    state = registerProject(
      state,
      { name: "App", uri: "content://a", displayName: "App" },
      NOW,
    );
    const session = sessionForProject(state.projects[0]!, "android");
    expect(session.uri).toBe("content://a");
    expect(session.sourceType).toBe("external-folder");
  });
});
