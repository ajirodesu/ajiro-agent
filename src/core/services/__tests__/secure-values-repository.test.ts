import { describe, expect, it } from "vitest";

import {
  createSecureValuesRepository,
  type SecureValuesBackend,
} from "@/core/services/secure-values-repository";

function memoryBackend(): SecureValuesBackend & { size: () => number } {
  const memory = new Map<string, string>();
  return {
    async getItemAsync(key) {
      return memory.get(key) ?? null;
    },
    async setItemAsync(key, value) {
      memory.set(key, value);
    },
    async deleteItemAsync(key) {
      memory.delete(key);
    },
    size: () => memory.size,
  };
}

describe("SecureValuesRepository", () => {
  it("round-trips values per namespace without collisions", async () => {
    const backend = memoryBackend();
    const repo = createSecureValuesRepository(backend);

    await repo.setValue("a", "token", "one");
    await repo.setValue("b", "token", "two");

    expect(await repo.getValue("a", "token")).toBe("one");
    expect(await repo.getValue("b", "token")).toBe("two");
    expect(await repo.hasValue("a", "token")).toBe(true);
    expect(await repo.hasValue("a", "missing")).toBe(false);
    expect(backend.size()).toBe(2);
  });

  it("deletes values and reports absence afterwards", async () => {
    const repo = createSecureValuesRepository(memoryBackend());

    await repo.setValue("ns", "k", "v");
    await repo.deleteValue("ns", "k");

    expect(await repo.getValue("ns", "k")).toBeNull();
    expect(await repo.hasValue("ns", "k")).toBe(false);
  });

  it("rejects empty namespace/key and non-string values", async () => {
    const repo = createSecureValuesRepository(memoryBackend());

    await expect(repo.setValue("", "k", "v")).rejects.toThrow(TypeError);
    await expect(repo.getValue("ns", "")).rejects.toThrow(TypeError);
    await expect(
      repo.setValue("ns", "k", 42 as unknown as string),
    ).rejects.toThrow(TypeError);
  });
});
