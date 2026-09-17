import { describe, expect, it, vi } from "vitest";

import {
  createLatestRunner,
  createRequestManager,
  debounceShared,
  isCancelError,
} from "@/modules/intel/cancellation";

describe("request manager", () => {
  it("issues monotonic ids and tracks versions", () => {
    const manager = createRequestManager(() => 7);
    const first = manager.createRequest();
    const second = manager.createRequest(9);
    expect(second.requestId).toBeGreaterThan(first.requestId);
    expect(first.documentVersion).toBe(7);
    expect(second.documentVersion).toBe(9);
    expect(first.isStale(7)).toBe(false);
    expect(first.isStale(8)).toBe(true);
  });

  it("cancel marks stale and throws a named error", () => {
    const manager = createRequestManager();
    const request = manager.createRequest(1);
    request.cancel();
    expect(request.cancelled).toBe(true);
    expect(request.isStale(1)).toBe(true);
    expect(() => request.throwIfCancelled()).toThrowError(/cancelled/i);
    try {
      request.throwIfCancelled();
    } catch (error) {
      expect(isCancelError(error)).toBe(true);
    }
  });

  it("cancelAll cancels outstanding requests", () => {
    const manager = createRequestManager();
    const request = manager.createRequest(1);
    manager.cancelAll();
    expect(request.cancelled).toBe(true);
  });
});

describe("latest runner", () => {
  it("delivers only the newest resolution", async () => {
    const runner = createLatestRunner();
    let resolveFirst!: (value: string) => void;
    const first = new Promise<string>((resolve) => {
      resolveFirst = resolve;
    });
    const firstPromise = runner.run(() => first);
    const secondPromise = runner.run(() => Promise.resolve("second"));
    resolveFirst("first");
    expect(await firstPromise).toBeNull();
    expect(await secondPromise).toBe("second");
  });

  it("reports superseded ids", async () => {
    const onSuperseded = vi.fn();
    const runner = createLatestRunner({ onSuperseded });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const stale = runner.run(async () => {
      await gate;
      return "stale";
    });
    const fresh = runner.run(() => Promise.resolve("fresh"));
    release();
    expect(await stale).toBeNull();
    expect(await fresh).toBe("fresh");
    expect(onSuperseded).toHaveBeenCalledTimes(1);
  });
});

describe("debounceShared", () => {
  it("resolves all callers with the last invocation", async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const debounced = debounceShared(50, (value: string) => {
        calls += 1;
        return Promise.resolve(`done:${value}`);
      });
      const first = debounced("a");
      const second = debounced("b");
      await vi.advanceTimersByTimeAsync(60);
      expect(await first).toBe("done:b");
      expect(await second).toBe("done:b");
      expect(calls).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
