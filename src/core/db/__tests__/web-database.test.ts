import { describe, expect, it } from "vitest";

import {
  assertWebDatabaseSupported,
  describeWebDatabaseBackend,
  WEB_DATABASE_BACKEND,
  WEB_DATABASE_NAME,
} from "@/core/db/web-database";

describe("web-database adapter", () => {
  it("names the shared database file", () => {
    expect(WEB_DATABASE_NAME).toBe("ajiro-agent.db");
  });

  it("describes the real web backend (wa-sqlite worker)", () => {
    expect(WEB_DATABASE_BACKEND).toBe("wa-sqlite");
    expect(describeWebDatabaseBackend()).toEqual({
      backend: "wa-sqlite",
      worker: true,
      persistence: "browser profile (OPFS/IndexedDB via wa-sqlite worker)",
    });
  });

  it("passes with a browser-like scope and fails without one", () => {
    expect(() =>
      assertWebDatabaseSupported({ window: {} }),
    ).not.toThrow();
    expect(() => assertWebDatabaseSupported({})).toThrow(
      /browser global/,
    );
  });
});
