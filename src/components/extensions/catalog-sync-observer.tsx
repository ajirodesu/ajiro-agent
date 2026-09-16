/**
 * Headless extension catalog synchronization (prompt §19).
 *
 * Mounted once from the root layout so newly published extensions are
 * discovered when the app starts and whenever it returns to the foreground,
 * without the Extension Store being open. The coordinator stale-checks every
 * request, so a warm app performs no network call.
 *
 * Discovery only: this never installs, enables, or executes anything (§17,
 * §64). It synchronizes catalog metadata and nothing else.
 */
import { useEffect } from "react";
import { AppState } from "react-native";

import { syncCatalogInBackground } from "@/modules/extensions";

export function ExtensionCatalogObserver() {
  useEffect(() => {
    // Startup sync: the Store is cache-first, so this only refreshes the
    // catalog when the persisted cache has gone stale.
    void syncCatalogInBackground().catch(() => {});

    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void syncCatalogInBackground().catch(() => {});
      }
    });
    return () => {
      subscription.remove();
    };
  }, []);

  return null;
}
