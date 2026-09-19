import { describe, expect, it, vi } from "vitest";

import { createAliasQueue } from "@/modules/app-icon/alias-queue";

/** Let the queued request's run microtask fire so `apply` is entered. */
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("createAliasQueue", () => {
  it("serializes calls so native writes never interleave", async () => {
    const events: string[] = [];
    const apply = vi.fn(async (suffix: string | null) => {
      events.push(`start:${suffix}`);
      // Simulate the async native component-enable write.
      await tick();
      events.push(`end:${suffix}`);
    });
    const queue = createAliasQueue(apply);

    // Real usage: theme changes arrive as separate events, so the first
    // swap is in flight (awaiting native) when the next theme arrives.
    const first = queue("ThemedIconBurnt");
    await tick();
    const second = queue("ThemedIconIndigo");
    await Promise.all([first, second]);

    expect(events).toEqual([
      "start:ThemedIconBurnt",
      "end:ThemedIconBurnt",
      "start:ThemedIconIndigo",
      "end:ThemedIconIndigo",
    ]);
  });

  it("drops superseded waiting requests and lands on the newest theme", async () => {
    const calls: (string | null)[] = [];
    const apply = vi.fn(async (suffix: string | null) => {
      calls.push(suffix);
      if (calls.length === 1) {
        // First swap in flight while the user rapid-toggles.
        await tick();
      }
    });
    const queue = createAliasQueue(apply);

    const first = queue("ThemedIconBurnt");
    await tick();
    const second = queue("ThemedIconIndigo");
    const third = queue("ThemedIconDark");
    await Promise.all([first, second, third]);

    // Indigo was superseded by dark before its turn, so it never reaches
    // native; the final swap is the last requested suffix, so the home
    // screen can never be left on a stale theme.
    expect(calls).toEqual(["ThemedIconBurnt", "ThemedIconDark"]);
  });

  it("keeps the chain alive after a rejection", async () => {
    const calls: (string | null)[] = [];
    const apply = vi.fn(async (suffix: string | null) => {
      calls.push(suffix);
      if (calls.length === 1) {
        throw new Error("native boom");
      }
    });
    const queue = createAliasQueue(apply);

    await expect(queue("ThemedIconBurnt")).rejects.toThrow("native boom");
    // A failed swap must not wedge every later theme change.
    await queue("ThemedIconIndigo");

    expect(calls).toEqual(["ThemedIconBurnt", "ThemedIconIndigo"]);
  });

  it("passes the null suffix through for the default launcher icon", async () => {
    const calls: (string | null)[] = [];
    const apply = vi.fn(async (suffix: string | null) => {
      calls.push(suffix);
    });
    const queue = createAliasQueue(apply);

    await queue(null);
    expect(calls).toEqual([null]);
  });
});
