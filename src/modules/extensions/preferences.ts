/**
 * Extension platform preferences (prompt §63, §64): the small set of user
 * choices that govern *discovery* rather than *execution*.
 *
 * They live in their own file next to the installed records instead of in
 * Ajiro's core settings, because they are only meaningful to the extension
 * platform and must survive independently of the Store UI.
 *
 * What they deliberately cannot do: none of these settings can make an
 * extension install, enable, or execute on its own. Catalog synchronization
 * is automatic; installation stays a user action (§17/§64).
 */
import { parseUpdateChannel, type UpdateChannel } from "@/modules/updates/extension-framework";
import { isRecord } from "./models";
import type { ExtensionPathPlan } from "./storage";
import type { ExtensionPlatform } from "./installer";

export type ExtensionPreferences = {
  /** Allow plugins to *ask* to install other plugins (still consented). */
  allowPluginInstallRequests: boolean;
  /** Show the discovery indicator when new extensions appear (§63). */
  notifyOnDiscovery: boolean;
  /**
   * Refuse packages whose publisher signature is not verified (§51). Off by
   * default, because Acode publishes no signatures: turning this on means
   * "only my own trusted publishers", not "the store is broken".
   */
  requireSignedPackages: boolean;
  /** keyId → base64 Ed25519 public key, the publishers this device trusts. */
  trustedSigningKeys: Record<string, string>;
  /**
   * Formatter selection, Acode-style (`appSettings.value.formatter[mode]`):
   * language id → owning formatter id. Chosen explicitly (or by the
   * unambiguous single-candidate rule); never inferred silently per keystroke.
   */
  formatters: Record<string, string>;
  /**
   * Selected plugin editor theme id (Acode's Settings → Editor Theme).
   * Null follows the app theme; a missing/uninstalled id falls back the
   * same way instead of breaking the editor.
   */
  editorTheme: string | null;
  /**
   * Preferred preview engine for the Run screen (plugin id of an
   * installed preview plugin, or null for the default WebView). A
   * missing/uninstalled id falls back the same way.
   */
  previewEngine: string | null;
  /**
   * Update channel (A44): which registry entries the Store offers.
   * Production default is stable; beta also shows stable, preview shows all.
   */
  updateChannel: UpdateChannel;
};

export const DEFAULT_EXTENSION_PREFERENCES: ExtensionPreferences = {
  allowPluginInstallRequests: true,
  notifyOnDiscovery: true,
  requireSignedPackages: false,
  trustedSigningKeys: {},
  formatters: {},
  editorTheme: null,
  previewEngine: null,
  updateChannel: "stable",
};

/**
 * Trusted keys are user-supplied, so they are validated here rather than
 * trusted: only non-empty string ids and values survive, and the map is
 * rebuilt so an inherited prototype cannot smuggle an entry in.
 */
function parseTrustedKeys(raw: unknown): Record<string, string> {
  if (!isRecord(raw)) return {};
  const keys: Record<string, string> = {};
  for (const [keyId, value] of Object.entries(raw)) {
    if (keyId.trim() === "" || typeof value !== "string" || value.trim() === "") {
      continue;
    }
    keys[keyId] = value.trim();
  }
  return keys;
}

/**
 * Formatter selections are user data, so they are validated here: non-empty
 * string keys and values only, bounded so a corrupt file cannot grow the
 * map without limit.
 */
const MAX_FORMATTER_SELECTIONS = 128;

export function parseFormatterSelections(raw: unknown): Record<string, string> {
  if (!isRecord(raw)) return {};
  const selections: Record<string, string> = {};
  for (const [languageId, formatterId] of Object.entries(raw)) {
    if (Object.keys(selections).length >= MAX_FORMATTER_SELECTIONS) break;
    if (
      typeof languageId === "string" &&
      languageId.trim() !== "" &&
      typeof formatterId === "string" &&
      formatterId.trim() !== ""
    ) {
      selections[languageId.trim()] = formatterId.trim();
    }
  }
  return selections;
}

export function parseExtensionPreferences(
  raw: string | null,
): ExtensionPreferences {
  if (!raw) return { ...DEFAULT_EXTENSION_PREFERENCES };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return { ...DEFAULT_EXTENSION_PREFERENCES };
    return {
      allowPluginInstallRequests:
        typeof parsed.allowPluginInstallRequests === "boolean"
          ? parsed.allowPluginInstallRequests
          : DEFAULT_EXTENSION_PREFERENCES.allowPluginInstallRequests,
      notifyOnDiscovery:
        typeof parsed.notifyOnDiscovery === "boolean"
          ? parsed.notifyOnDiscovery
          : DEFAULT_EXTENSION_PREFERENCES.notifyOnDiscovery,
      requireSignedPackages:
        typeof parsed.requireSignedPackages === "boolean"
          ? parsed.requireSignedPackages
          : DEFAULT_EXTENSION_PREFERENCES.requireSignedPackages,
      trustedSigningKeys: parseTrustedKeys(parsed.trustedSigningKeys),
      formatters: parseFormatterSelections(parsed.formatters),
      editorTheme:
        typeof parsed.editorTheme === "string" &&
        parsed.editorTheme.trim() !== ""
          ? parsed.editorTheme.trim()
          : null,
      previewEngine:
        typeof parsed.previewEngine === "string" &&
        parsed.previewEngine.trim() !== ""
          ? parsed.previewEngine.trim()
          : null,
      updateChannel:
        parseUpdateChannel(parsed.updateChannel) ??
        DEFAULT_EXTENSION_PREFERENCES.updateChannel,
    };
  } catch {
    return { ...DEFAULT_EXTENSION_PREFERENCES };
  }
}

export function createExtensionPreferencesReader(deps: {
  paths: ExtensionPathPlan;
  platform: ExtensionPlatform;
}): {
  load(): Promise<ExtensionPreferences>;
  save(patch: Partial<ExtensionPreferences>): Promise<ExtensionPreferences>;
} {
  const { paths, platform } = deps;
  let cache: ExtensionPreferences | null = null;
  let loading: Promise<ExtensionPreferences> | null = null;

  /** One shared read per instance, so concurrent callers agree on a value. */
  function load(): Promise<ExtensionPreferences> {
    if (cache) return Promise.resolve({ ...cache });
    if (!loading) {
      loading = platform
        .readText(paths.preferencesFile)
        .then((raw) => parseExtensionPreferences(raw))
        .then((parsed) => {
          cache = cache ?? parsed;
          loading = null;
          return { ...cache };
        });
    }
    return loading;
  }

  return {
    load,

    async save(patch) {
      const next = { ...(await load()), ...patch };
      cache = next;
      await platform.writeText(paths.preferencesFile, JSON.stringify(next));
      return { ...next };
    },
  };
}
