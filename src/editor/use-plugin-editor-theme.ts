/**
 * Reactive selected plugin editor theme (Settings → Editor Theme).
 * Reads the bridge status snapshot and refreshes on every status change,
 * so install/uninstall/select apply to open editors without remounts.
 * Null means "follow the app theme".
 */
import { useEffect, useMemo, useState } from "react";

import { getPluginRuntimeBridge } from "@/modules/extensions";
import type { PluginEditorTheme } from "@/modules/extensions/editor-themes";

function currentSelection(): PluginEditorTheme | null {
  try {
    const status = getPluginRuntimeBridge().status();
    return (
      status.editorThemes.themes.find(
        (theme) => theme.id === status.editorThemes.selected,
      ) ?? null
    );
  } catch {
    return null;
  }
}

export function usePluginEditorTheme(): PluginEditorTheme | null {
  const [theme, setTheme] = useState<PluginEditorTheme | null>(() =>
    currentSelection(),
  );
  useEffect(() => {
    const bridge = getPluginRuntimeBridge();
    setTheme(currentSelection());
    return bridge.subscribe(() => {
      setTheme(currentSelection());
    });
  }, []);
  return theme;
}

/** All registered plugin editor themes for the picker UI. */
export function usePluginEditorThemes(): PluginEditorTheme[] {
  const [themes, setThemes] = useState<PluginEditorTheme[]>(() => {
    try {
      return getPluginRuntimeBridge().status().editorThemes.themes;
    } catch {
      return [];
    }
  });
  useEffect(() => {
    const bridge = getPluginRuntimeBridge();
    const refresh = () => {
      try {
        setThemes(bridge.status().editorThemes.themes);
      } catch {
        // Bridge unavailable (web preview): no plugin themes.
      }
    };
    refresh();
    return bridge.subscribe(refresh);
  }, []);
  return themes;
}

export function useSetPluginEditorTheme(): (
  id: string | null,
) => Promise<void> {
  return useMemo(
    () => async (id: string | null) => {
      await getPluginRuntimeBridge().host.setEditorThemeSelection(id);
    },
    [],
  );
}
