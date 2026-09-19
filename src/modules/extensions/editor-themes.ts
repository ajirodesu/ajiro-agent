/**
 * Plugin editor themes (Acode's Editor Themes API): `acode.require(
 * "editorThemes")` lets plugins register CodeMirror editor themes that
 * appear under Settings → Editor Theme and apply to the code editor.
 *
 * Only the portable `config` color map crosses the bridge (live
 * CodeMirror extension objects cannot be serialized); the app theme is
 * built from it (see `adaptPluginThemeToEditorTheme`). Registration is
 * inert data until the user selects the theme — no permission needed,
 * nothing executes. Selection persists in extension preferences.
 */

export type PluginEditorTheme = {
  id: string;
  caption: string;
  dark: boolean;
  pluginId: string;
  config: Record<string, string>;
};

const MAX_THEME_ID_LENGTH = 128;
const MAX_THEME_CAPTION_LENGTH = 120;
const MAX_THEME_CONFIG_KEYS = 64;

const HEX_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * Validate a doc-side registration; null when it must be refused. A
 * theme without usable background/foreground colors cannot be built
 * into an editor theme, so it is refused with a reason instead of
 * listing a theme that would silently not apply.
 */
export function normalizeThemeRegistration(
  pluginId: string,
  input: {
    id: unknown;
    caption: unknown;
    dark: unknown;
    config: unknown;
  },
): PluginEditorTheme | null {
  const rawId =
    typeof input.id === "string" ? input.id.trim().slice(0, MAX_THEME_ID_LENGTH) : "";
  if (!rawId) return null;
  const caption =
    typeof input.caption === "string" && input.caption.trim() !== ""
      ? input.caption.trim().slice(0, MAX_THEME_CAPTION_LENGTH)
      : rawId;
  const config: Record<string, string> = {};
  if (input.config && typeof input.config === "object" && !Array.isArray(input.config)) {
    for (const [key, value] of Object.entries(
      input.config as Record<string, unknown>,
    )) {
      if (Object.keys(config).length >= MAX_THEME_CONFIG_KEYS) break;
      // Keys are case-insensitive: the builder looks up lowercase slots.
      if (typeof key === "string" && key.trim() !== "" && typeof value === "string") {
        config[key.trim().toLowerCase()] = value;
      }
    }
  }
  const background = config.background ?? "";
  const foreground = config.foreground ?? "";
  if (!HEX_PATTERN.test(background) || !HEX_PATTERN.test(foreground)) {
    return null;
  }
  return {
    id: rawId,
    caption,
    dark: input.dark === true,
    pluginId,
    config,
  };
}

export type EditorThemeSelectionStore = {
  loadSelection(): Promise<string | null>;
  saveSelection(id: string | null): Promise<void>;
};

export function createMemoryEditorThemeSelections(
  initial: string | null = null,
): EditorThemeSelectionStore {
  let selection = initial;
  return {
    async loadSelection() {
      return selection;
    },
    async saveSelection(id) {
      selection = id;
    },
  };
}

/** Selection backed by the platform preferences file (`editorTheme`). */
export function createPreferenceEditorThemeSelections(reader: {
  load(): Promise<{ editorTheme: string | null }>;
  save(patch: { editorTheme: string | null }): Promise<unknown>;
}): EditorThemeSelectionStore {
  return {
    async loadSelection() {
      const preferences = await reader.load();
      return typeof preferences.editorTheme === "string" &&
        preferences.editorTheme !== ""
        ? preferences.editorTheme
        : null;
    },
    async saveSelection(id) {
      await reader.save({ editorTheme: id });
    },
  };
}
