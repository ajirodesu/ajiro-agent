/**
 * Web database adapter. The on-device database is expo-sqlite; on Web
 * Preview the same `SQLiteDatabase` interface is served by expo-sqlite's
 * web backend, which runs wa-sqlite (SQLite compiled to WASM) in a worker
 * with browser-profile persistence — no native module, no custom SQL
 * engine in this repo. (Deviation note: the plan named sql.js; upstream
 * expo-sqlite web targets wa-sqlite, so this adapter describes and guards
 * the actual backend instead of shipping a redundant engine.)
 *
 * This module is side-effect free and node-testable: it only names the
 * database and describes the backend. Opening stays with `SQLiteProvider`.
 */

export const WEB_DATABASE_NAME = "ajiro-agent.db";

export const WEB_DATABASE_BACKEND = "wa-sqlite" as const;

export type WebDatabaseSupport = {
  readonly backend: typeof WEB_DATABASE_BACKEND;
  readonly worker: boolean;
  readonly persistence: string;
};

export function describeWebDatabaseBackend(): WebDatabaseSupport {
  return {
    backend: WEB_DATABASE_BACKEND,
    worker: true,
    persistence: "browser profile (OPFS/IndexedDB via wa-sqlite worker)",
  };
}

/**
 * Fail fast with a typed error when evaluated without a browser global
 * (SSR / prerender workers), where the WASM worker cannot load. Accepts an
 * injectable scope so unit tests do not depend on globals.
 */
export function assertWebDatabaseSupported(
  scope: Record<string, unknown> = globalThis as unknown as Record<
    string,
    unknown
  >,
): void {
  if (typeof scope.window === "undefined") {
    throw new Error(
      "Web database needs a browser global (wa-sqlite worker cannot load during SSR/prerender).",
    );
  }
}
