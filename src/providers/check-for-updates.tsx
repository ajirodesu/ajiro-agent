"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AppState, Linking } from "react-native";

import {
  type AvailableRelease,
  checkForGitHubReleaseUpdate,
  installAvailableRelease,
} from "@/modules/updates/github-release";
import {
  applyOtaUpdate,
  checkForCompatibleUpdate,
  downloadOtaUpdate,
} from "@/modules/updates/ota";

type OtaState = {
  /** A compatible app-layer update is staged and waits for a safe restart. */
  staged: boolean;
};

type UpdateContextType = {
  release: AvailableRelease | null;
  checking: boolean;
  installing: boolean;
  bannerDismissed: boolean;
  checkForUpdates: () => Promise<void>;
  installUpdate: () => Promise<void>;
  dismissUpdate: () => void;
  /** Compatible OTA update state (§40); null when none or unsupported. */
  ota: OtaState | null;
  /** Restart into the staged OTA update. No-op unless staged. */
  restartForOtaUpdate: () => Promise<void>;
};

const UpdateContext = createContext<UpdateContextType | null>(null);

export function UpdateProvider({ children }: { children: React.ReactNode }) {
  const dismissedTagRef = useRef<string | null>(null);

  const [release, setRelease] = useState<AvailableRelease | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [ota, setOta] = useState<OtaState | null>(null);

  const checkForUpdates = useCallback(async () => {
    try {
      setChecking(true);

      const nextRelease = await checkForGitHubReleaseUpdate();

      if (nextRelease?.tagName !== dismissedTagRef.current) {
        setRelease(nextRelease);
      }

      // OTA app-layer updates (§40): only runtime-compatible updates are
      // staged, and only for application on a safe restart. No-op on
      // installs whose native binary predates expo-updates.
      const compatible = await checkForCompatibleUpdate().catch(() => null);
      if (compatible?.available && compatible.compatible) {
        const staged = await downloadOtaUpdate().catch(() => false);
        setOta(staged ? { staged: true } : null);
      } else {
        setOta(null);
      }
    } catch (error) {
      console.warn(error);
    } finally {
      setChecking(false);
    }
  }, []);

  const restartForOtaUpdate = useCallback(async () => {
    if (!ota?.staged) return;
    await applyOtaUpdate();
  }, [ota]);

  const installUpdate = useCallback(async () => {
    if (!release) return;

    try {
      setInstalling(true);
      await installAvailableRelease(release);
    } catch (error) {
      console.error(error);
      await Linking.openURL(release.url);
    } finally {
      setInstalling(false);
    }
  }, [release]);

  const dismissUpdate = useCallback(() => {
    if (!release) return;

    dismissedTagRef.current = release.tagName;
    setBannerDismissed(true);
  }, [release]);

  useEffect(() => {
    checkForUpdates();

    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        checkForUpdates();
      }
    });

    return () => subscription.remove();
  }, [checkForUpdates]);

  return (
    <UpdateContext.Provider
      value={{
        bannerDismissed,
        release,
        checking,
        installing,
        checkForUpdates,
        installUpdate,
        dismissUpdate,
        ota,
        restartForOtaUpdate,
      }}
    >
      {children}
    </UpdateContext.Provider>
  );
}

export function useUpdate() {
  const context = useContext(UpdateContext);

  if (!context) {
    throw new Error("useUpdate must be used inside UpdateProvider");
  }

  return context;
}
