/**
 * Plugins — the Ajiro Extension Store (Acode-compatible, prompt §28/§35).
 *
 * Replaces the old MCP shortcut content in the sidebar: Explore +
 * Installed sections, search, categories, detail views with honest
 * compatibility reports, install/update/uninstall with permission
 * consent, local ZIP + remote URL installs, and cache-first registry
 * synchronization that keeps working offline.
 */
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import {
  Brush,
  ChevronLeft,
  CircleAlert,
  Download,
  ExternalLink,
  FileUp,
  Fingerprint,
  ListChecks,
  Package,
  Play,
  Puzzle,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Terminal,
  Trash2,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import Markdown, { MarkdownIt } from "react-native-markdown-display";

import { Container } from "@/components/shared/container";
import { Button } from "@/components/ui/button";
import { AppHeader, CircleIconButton } from "@/components/ui/chrome";
import { withAlpha } from "@/components/ui/chrome-spec";
import { Card } from "@/components/ui/card";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { useTheme } from "@/hooks/use-theme";
import {
  acknowledgeNewExtensions,
  buildCatalogSearchIndex,
  formatChordId,
  BUNDLED_SEED_CATALOG,
  CATALOG_STATE_FILTERS,
  compareExtensionVersions,
  compatibilityLabel,
  DEFAULT_EXTENSION_PREFERENCES,
  deriveExtensionInstallState,
  filterCatalogEntries,
  findUpdateAvailable,
  checkServerUpdates,
  getExtensionStore,
  getPluginRuntimeBridge,
  describeDependencyIssues,
  isSafePluginPath,
  languageIdsForExtensions,
  listCategories,
  listFeaturedExtensions,
  signatureLabel,
  signaturePolicyMessage,
  subscribeCatalog,
  subscribeExtensionEvents,
  syncCatalogInBackground,
  type CatalogStateFilter,
  type ExtensionDiagnostic,
  type ExtensionMetadata,
  type ExtensionPackageSource,
  type ExtensionPermissionKey,
  type ExtensionPreferences,
  type FormatterRegistration,
  type InstalledExtensionRecord,
  type RegisteredPluginCommand,
  type RegistrySyncStatus,
} from "@/modules/extensions";
import { EXTENSION_TO_MODE_KEY } from "@/editor/editorLanguages";
import { PERMISSION_LABELS } from "@/modules/extensions/permissions";
import { pluginDataDir, pluginDir } from "@/modules/extensions/storage";

type InstallConsent = {
  pending: ExtensionPermissionKey[];
  source: ExtensionPackageSource;
};

/** How the catalog is ordered (§29) and how much of it is rendered (§66). */
type CatalogSort = "name" | "recent" | "version";

const CATALOG_PAGE_SIZE = 20;

const SORT_LABELS: Record<CatalogSort, string> = {
  name: "Name",
  recent: "Recently updated",
  version: "Newest version",
};

const STATE_FILTER_LABELS: Record<CatalogStateFilter, string> = {
  all: "All",
  broken: "Broken",
  disabled: "Disabled",
  enabled: "Enabled",
  revoked: "Revoked",
  "update-available": "Update available",
};

/**
 * Ordering is a view concern, so it lives here rather than in the catalog
 * module: the cached catalog keeps registry order (§18), and the Store
 * decides how to present it.
 */
function sortCatalogEntries(
  entries: ExtensionMetadata[],
  sort: CatalogSort,
): ExtensionMetadata[] {
  const sorted = [...entries];
  switch (sort) {
    case "recent":
      sorted.sort((left, right) =>
        (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""),
      );
      return sorted;
    case "version":
      sorted.sort(
        (left, right) =>
          compareExtensionVersions(right.version, left.version) ||
          left.name.localeCompare(right.name),
      );
      return sorted;
    default:
      sorted.sort((left, right) => left.name.localeCompare(right.name));
      return sorted;
  }
}

/**
 * An extension's icon (§61). The installed package wins — it is the version
 * actually on disk — and only a plain https registry thumbnail is accepted
 * otherwise, so a manifest can never point the image loader at a local file
 * or a javascript: URL.
 */
function extensionIconUri(
  entry: ExtensionMetadata,
  record: InstalledExtensionRecord | null,
  installedPath: string | null,
): string | null {
  const manifestIcon =
    record && typeof record.manifest.icon === "string" ? record.manifest.icon : null;
  if (manifestIcon && isSafePluginPath(manifestIcon) && installedPath) {
    return `${installedPath}/${manifestIcon}`;
  }
  if (entry.icon && /^https:\/\//i.test(entry.icon)) return entry.icon;
  return null;
}

/**
 * README/changelog rendering (prompt §60). react-native-markdown-display
 * renders to native Text nodes, so plugin markdown can never execute
 * JavaScript; link presses are restricted to http(s) so a manifest cannot
 * hand the user a `javascript:`/`intent:` payload.
 */
const MARKDOWN_PARSER = MarkdownIt({ breaks: true, linkify: true });

function openExternalLink(link: string): boolean {
  if (!/^https?:\/\//i.test(link)) return false;
  void Linking.openURL(link).catch(() => {});
  return true;
}

function createExtensionMarkdownStyles(theme: ReturnType<typeof useTheme>) {
  return {
    blockquote: {
      borderColor: theme.border,
      borderLeftWidth: 3,
      color: theme.textSecondary,
      marginBottom: 10,
      paddingLeft: 10,
    },
    body: { color: theme.text, fontSize: 14, lineHeight: 21, margin: 0 },
    bullet_list: { marginBottom: 8 },
    bullet_list_content: { flex: 1 },
    bullet_list_icon: { color: theme.text, marginRight: 8 },
    code_block: {
      backgroundColor: theme.backgroundElement,
      borderRadius: 10,
      color: theme.text,
      fontFamily: "monospace",
      fontSize: 12,
      lineHeight: 18,
      padding: 10,
    },
    code_inline: {
      backgroundColor: theme.backgroundSelected,
      borderRadius: 6,
      color: theme.text,
      fontFamily: "monospace",
      fontSize: 12,
      paddingHorizontal: 4,
    },
    fence: {
      backgroundColor: theme.backgroundElement,
      borderRadius: 10,
      color: theme.text,
      fontFamily: "monospace",
      fontSize: 12,
      lineHeight: 18,
      padding: 10,
    },
    heading1: { color: theme.text, fontSize: 19, fontWeight: "700", marginBottom: 6 },
    heading2: { color: theme.text, fontSize: 17, fontWeight: "700", marginBottom: 6 },
    heading3: { color: theme.text, fontSize: 15, fontWeight: "700", marginBottom: 4 },
    hr: { backgroundColor: theme.border, height: 1, marginVertical: 10 },
    link: { color: theme.accent, textDecorationLine: "underline" },
    ordered_list: { marginBottom: 8 },
    ordered_list_icon: { color: theme.text, marginRight: 8 },
    paragraph: { marginBottom: 10, marginTop: 0 },
    strong: { fontWeight: "700" },
  } satisfies StyleSheet.NamedStyles<Record<string, unknown>>;
}

function StateBadge({ state }: { state: string }) {
  const theme = useTheme();
  const colors: Record<string, string> = {
    Compatible: theme.text,
    "Installed": theme.text,
    "Partial": theme.accent,
    "Update available": theme.accent,
    "Unsupported": theme.destructive,
    Unknown: theme.textSecondary,
    Broken: theme.destructive,
    Disabled: theme.textSecondary,
  };
  if (state === "Not installed" || state === "Compatible") return null;
  return (
    <Text
      className="font-mono text-xs"
      style={{ color: colors[state] ?? theme.textSecondary }}
    >
      {state}
    </Text>
  );
}

function SectionSwitch({
  section,
  setSection,
}: {
  section: "explore" | "installed";
  setSection: (section: "explore" | "installed") => void;
}) {
  const theme = useTheme();
  const options = ["explore", "installed"] as const;
  return (
    <View className="flex-row gap-sp-2">
      {options.map((option) => {
        const active = section === option;
        return (
          <Pressable
            key={option}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            className="flex-1 items-center rounded-full py-2"
            onPress={() => setSection(option)}
            style={{
              backgroundColor: active
                ? withAlpha(theme.accent, 0.2)
                : theme.backgroundSelected,
              borderWidth: active ? 1 : 0,
              borderColor: theme.accent,
            }}
          >
            <Text
              className="font-sans text-sm font-medium capitalize"
              style={{ color: active ? theme.text : theme.textSecondary }}
            >
              {option}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function FilterChip({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      className="rounded-full px-sp-3 py-1"
      style={({ pressed }) => ({
        borderWidth: active ? 1 : 0,
        borderColor: active ? theme.accent : "transparent",
        backgroundColor: active
          ? withAlpha(theme.accent, 0.18)
          : "transparent",
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text
        className="font-sans text-xs"
        style={{ color: active ? theme.text : theme.textSecondary }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** Manifest/registry icon with a package-puzzle fallback (§61). */
function ExtensionIcon({
  size = 44,
  uri,
}: {
  size?: number;
  uri: string | null;
}) {
  const theme = useTheme();
  return (
    <View
      className="items-center justify-center overflow-hidden rounded-xl"
      style={{ height: size, width: size, backgroundColor: theme.backgroundSelected }}
    >
      {uri ? (
        <Image
          cachePolicy="disk"
          contentFit="cover"
          source={{ uri }}
          style={{ height: size, width: size }}
        />
      ) : (
        <Puzzle color={theme.text} size={Math.round(size / 2)} strokeWidth={2} />
      )}
    </View>
  );
}

function ExtensionCard({
  entry,
  iconUri,
  onPress,
  state,
}: {
  entry: ExtensionMetadata;
  iconUri: string | null;
  onPress: () => void;
  state: string;
}) {
  return (
    <Pressable
      accessibilityLabel={`${entry.name}. ${state}`}
      accessibilityRole="button"
      onPress={onPress}
    >
      <Card className="px-sp-3 py-sp-2">
        <View className="flex-row items-center gap-sp-3">
          <ExtensionIcon uri={iconUri} />
          <View className="min-w-0 flex-1 gap-1">
            <View className="flex-row items-center justify-between gap-sp-2">
              <Text
                className="min-w-0 flex-1 font-sans text-base font-semibold text-foreground dark:text-foreground-dark"
                numberOfLines={1}
              >
                {entry.name}
              </Text>
              <StateBadge state={state} />
            </View>
            <Text
              className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark"
              numberOfLines={2}
            >
              {entry.description ?? entry.id}
            </Text>
            <Text className="font-mono text-xs text-muted-foreground dark:text-muted-foreground-dark">
              v{entry.version}
              {entry.author?.name ? ` · ${entry.author.name}` : ""}
              {entry.category ? ` · ${entry.category}` : ""}
            </Text>
          </View>
        </View>
      </Card>
    </Pressable>
  );
}

export default function ExtensionsScreen() {
  const router = useRouter();
  const theme = useTheme();

  // Process-wide store: one catalog cache writer, one acode runtime.
  const store = useMemo(() => getExtensionStore(), []);
  // The DOM bridge that executes installed plugins (§35/§48). It also owns
  // plugin commands and the persisted diagnostics log.
  const bridge = useMemo(() => getPluginRuntimeBridge(), []);

  const [section, setSection] = useState<"explore" | "installed">("explore");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [entries, setEntries] = useState<ExtensionMetadata[]>(BUNDLED_SEED_CATALOG);
  const [records, setRecords] = useState<InstalledExtensionRecord[]>([]);
  const [syncStatus, setSyncStatus] = useState<RegistrySyncStatus>("idle");
  const [newCount, setNewCount] = useState(0);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [consent, setConsent] = useState<InstallConsent | null>(null);
  /** Dependency issues from the last blocked or resolved plan (§53). */
  const [dependencyIssues, setDependencyIssues] = useState<string[]>([]);
  const [urlOpen, setUrlOpen] = useState(false);
  const [urlValue, setUrlValue] = useState("");
  const [readme, setReadme] = useState<string | null>(null);
  const [changelog, setChangelog] = useState<string | null>(null);
  const [uninstallTarget, setUninstallTarget] = useState<ExtensionMetadata | null>(null);
  const [rollbackAvailable, setRollbackAvailable] = useState(false);
  const [sort, setSort] = useState<CatalogSort>("name");
  // Installed view narrowing (§28): enabled / disabled / broken / update.
  const [stateFilter, setStateFilter] = useState<CatalogStateFilter>("all");
  const [pageLimit, setPageLimit] = useState(CATALOG_PAGE_SIZE);
  const [preferences, setPreferences] = useState<ExtensionPreferences>(
    DEFAULT_EXTENSION_PREFERENCES,
  );
  /** Registry-reported newer versions the synced catalog does not show (§19). */
  const [serverUpdates, setServerUpdates] = useState<Map<string, string>>(
    new Map(),
  );
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  // Trusted publisher keys are typed in by the user (§51): nothing is
  // trusted by default, and Acode publishes no keys to seed from.
  const [keyIdInput, setKeyIdInput] = useState("");
  const [keyValueInput, setKeyValueInput] = useState("");
  const [diagnostics, setDiagnostics] = useState<ExtensionDiagnostic[]>([]);
  const [pluginSettings, setPluginSettings] = useState<Record<string, unknown> | null>(
    null,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [commands, setCommands] = useState<RegisteredPluginCommand[]>([]);
  /**
   * Formatter registrations mirrored from the runtime document (§50): the
   * full list resolves persisted per-language selections to names, while the
   * detail view filters down to the open plugin.
   */
  const [allFormatters, setAllFormatters] = useState<FormatterRegistration[]>([]);
  /** Chords claimed by more than one plugin command (§45). */
  const [bindingConflicts, setBindingConflicts] = useState<Set<string>>(new Set());
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);

  const refreshRecords = async () => {
    const next = await store.manager.listInstalled();
    setRecords(next);
    await store.runtime.refreshStateFromRecords();
    return next;
  };

  /**
   * Server update hints (§19): Acode's per-plugin check-update probe behind
   * catalog version comparison, for updates the synced catalog missed.
   */
  const refreshServerUpdates = async (installed: InstalledExtensionRecord[]) => {
    const hints = await checkServerUpdates(store.provider, installed).catch(
      () => new Map<string, string>(),
    );
    setServerUpdates(hints);
    return hints;
  };

  /**
   * Diagnostics and commands for whatever the user is looking at, refreshed
   * live: `plugin-log` fires for every bridged console line and
   * `commands-changed` for every registration inside the document (§45/§57).
   */
  const refreshDetailPanels = useCallback(
    async (pluginId: string) => {
      const [logs, settings] = await Promise.all([
        bridge.listDiagnostics(pluginId).catch(() => []),
        store.deps.platform
          .readText(
            `${pluginDataDir(store.deps.paths, pluginId, "settings")}/settings.json`,
          )
          .catch(() => null)
          .then((raw) => {
            if (!raw) return {};
            try {
              const parsed: unknown = JSON.parse(raw);
              return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
                ? (parsed as Record<string, unknown>)
                : {};
            } catch {
              return {};
            }
          }),
      ]);
      setDiagnostics([...logs].reverse().slice(0, 40));
      setPluginSettings(settings);
      setCommands(bridge.commands.list().filter((item) => item.pluginId === pluginId));
      setAllFormatters(bridge.host.listFormatters());
      setBindingConflicts(
        new Set(bridge.commands.conflicts().map((conflict) => conflict.chordId)),
      );
    },
    [bridge, store.deps.paths, store.deps.platform],
  );

  const setPluginSetting = async (pluginId: string, key: string, value: unknown) => {
    const file = `${pluginDataDir(store.deps.paths, pluginId, "settings")}/settings.json`;
    const current = pluginSettings ?? {};
    const next = { ...current, [key]: value };
    setPluginSettings(next);
    await store.deps.platform.writeText(file, JSON.stringify(next));
    setNotice(`extensions.${pluginId}.${key} saved.`);
  };

  const clearPluginDiagnostics = async (pluginId: string) => {
    await bridge.clearDiagnostics(pluginId);
    await refreshDetailPanels(pluginId);
    setNotice(`Diagnostics for ${pluginId} cleared.`);
  };

  /**
   * Stale-checked sync shared with the startup/foreground coordinator (§19),
   * so opening the Store cannot race a background sync on the same cache.
   */
  const syncSafely = async (force = false) => {
    const snapshot = await syncCatalogInBackground({ force });
    return {
      entries: snapshot.entries,
      newCount: snapshot.newCount,
      status: snapshot.status,
    };
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Cache-first: render the persisted catalog instantly, then SWR.
      const cached = await store.persistence.load();
      if (cancelled) return;
      if (cached?.entries.length) setEntries(cached.entries);
      await refreshRecords();
      const result = await syncSafely();
      if (cancelled) return;
      setEntries(result.entries);
      setSyncStatus(result.status);
      setNewCount(result.newCount);
      // Revocation sweep (§24), same as the manual refresh path.
      const disabledRevoked = await store.manager
        .reconcileRevoked(result.entries)
        .catch(() => []);
      await refreshServerUpdates(await refreshRecords());
      if (disabledRevoked.length > 0) {
        setNotice(
          `${disabledRevoked.length} extension(s) were disabled: revoked by the registry.`,
        );
      }
      // The user is looking at the Store, so the discovery indicator no
      // longer needs to draw attention to it (§63).
      acknowledgeNewExtensions();
    })().catch((loadError) => {
      if (!cancelled) {
        setError(
          loadError instanceof Error ? loadError.message : "Could not load extensions.",
        );
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live Store updates (§21): a background sync that finishes while the Store
  // is open repaints it — no reopen, no restart.
  useEffect(
    () =>
      subscribeCatalog((snapshot) => {
        if (snapshot.entries.length > 0) setEntries(snapshot.entries);
        setSyncStatus(snapshot.status);
      }),
    [],
  );

  // Extension preferences gate discovery notifications and plugin-initiated
  // installs (§63/§64); they never gate execution of what is already enabled.
  useEffect(() => {
    let cancelled = false;
    store.preferences
      .load()
      .then((next) => {
        if (!cancelled) setPreferences(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [store.preferences]);

  const savePreference = async (patch: Partial<ExtensionPreferences>) => {
    const next = await store.preferences.save(patch).catch(() => null);
    if (next) setPreferences(next);
    return next;
  };

  /**
   * Add a publisher key to the trust store. The value is stored verbatim:
   * whether it is a usable Ed25519 key is decided by verification, which
   * reports "malformed" rather than trusting a typo.
   */
  const trustSigningKey = async () => {
    const keyId = keyIdInput.trim();
    const value = keyValueInput.trim();
    if (!keyId || !value) return;
    const saved = await savePreference({
      trustedSigningKeys: { ...preferences.trustedSigningKeys, [keyId]: value },
    });
    if (!saved) {
      setError("The trusted key could not be saved.");
      return;
    }
    setKeyIdInput("");
    setKeyValueInput("");
    setNotice(`Signing key "${keyId}" is now trusted for new installs.`);
  };

  const forgetSigningKey = async (keyId: string) => {
    const next = { ...preferences.trustedSigningKeys };
    delete next[keyId];
    await savePreference({ trustedSigningKeys: next });
    setNotice(`Signing key "${keyId}" is no longer trusted.`);
  };

  /**
   * Per-language formatter defaults (§50): persisted in preferences and
   * honored by format dispatch, so an explicit choice survives restarts
   * while "Automatic" keeps Acode's first-candidate behavior.
   */
  const selectFormatter = async (languageId: string, formatterId: string) => {
    const saved = await savePreference({
      formatters: { ...preferences.formatters, [languageId]: formatterId },
    });
    if (!saved) {
      setError("The formatter choice could not be saved.");
      return;
    }
    setNotice(`Default formatter for ${languageId} saved.`);
  };

  const clearFormatter = async (languageId: string) => {
    const next = { ...preferences.formatters };
    delete next[languageId];
    const saved = await savePreference({ formatters: next });
    if (!saved) {
      setError("The formatter choice could not be cleared.");
      return;
    }
    setNotice(`Default formatter for ${languageId} cleared.`);
  };

  /**
   * Update candidates from both sources (§19/§26): catalog version
   * comparison first, server check-update hints behind it. Every id here is
   * actionable — updating re-downloads the latest registry package.
   */
  const updateIds = useMemo(() => {
    // Channel-gated (§44): updates on channels the user did not opt into
    // are not offered. Revoked entries never surface (§24).
    const ids = findUpdateAvailable(entries, records, preferences.updateChannel);
    for (const [pluginId, version] of serverUpdates) {
      const record = records.find((item) => item.id === pluginId);
      const entry = entries.find((item) => item.id === pluginId);
      if (entry?.revoked) continue;
      if (
        record &&
        compareExtensionVersions(version, record.version) > 0
      ) {
        ids.add(pluginId);
      }
    }
    return ids;
  }, [entries, records, serverUpdates, preferences.updateChannel]);

  // Diagnostics, settings, commands, and formatters follow the open detail
  // view.
  useEffect(() => {
    if (!detailId) {
      setDiagnostics([]);
      setPluginSettings(null);
      setCommands([]);
      setAllFormatters([]);
      return;
    }
    void refreshDetailPanels(detailId).catch(() => {});
    const unsubscribe = subscribeExtensionEvents((event) => {
      if (
        (event.type === "plugin-log" ||
          event.type === "diagnostics-changed" ||
          event.type === "commands-changed" ||
          event.type === "broken") &&
        ("pluginId" in event ? event.pluginId === detailId : true)
      ) {
        void refreshDetailPanels(detailId).catch(() => {});
      }
    });
    return unsubscribe;
  }, [detailId, records, refreshDetailPanels]);

  // A new query, category, section, sort, or state filter starts paging from
  // the top (§66).
  useEffect(() => {
    setPageLimit(CATALOG_PAGE_SIZE);
  }, [category, query, section, sort, stateFilter]);

  const runSync = async () => {
    setBusyKey("sync");
    setError(null);
    try {
      const result = await syncSafely(true);
      setEntries(result.entries);
      setSyncStatus(result.status);
      setNewCount(result.newCount);
      // Revocation sweep (§24): disable anything the fresh catalog revoked,
      // then re-read records so the lists show it immediately.
      const disabledRevoked = await store.manager
        .reconcileRevoked(result.entries)
        .catch(() => []);
      await refreshServerUpdates(await refreshRecords());
      if (disabledRevoked.length > 0) {
        setNotice(
          `${disabledRevoked.length} extension(s) were disabled: revoked by the registry.`,
        );
      } else if (result.status === "offline") {
        setNotice("Registry unreachable — showing the cached catalog.");
      } else if (result.newCount > 0) {
        setNotice(`${result.newCount} new extension(s) discovered.`);
      } else {
        setNotice(null);
      }
    } finally {
      setBusyKey(null);
    }
  };

  const sourceFor = (entry: ExtensionMetadata): ExtensionPackageSource =>
    entry.download?.kind === "url"
      ? { kind: "url", url: entry.download.url }
      : { kind: "registry", pluginId: entry.id };

  /**
   * Dependencies waiting to be installed ahead of the requested extension,
   * and the request to resume once they are done (§53). Kept in refs because
   * each step re-enters `runInstall` through the consent drawer.
   */
  const dependencyQueueRef = useRef<
    { label: string; source: ExtensionPackageSource }[]
  >([]);
  const pendingRootRef = useRef<{
    label: string;
    source: ExtensionPackageSource;
  } | null>(null);

  /**
   * Continue a dependency-first install. Consent is deliberately *not*
   * carried over: approving one dependency's capabilities must never approve
   * the next package's, so every package prompts for itself.
   */
  const continueInstallQueue = async (): Promise<boolean> => {
    const next = dependencyQueueRef.current.shift();
    if (next) {
      await runInstall(next.source, next.label, undefined);
      return true;
    }
    const root = pendingRootRef.current;
    if (root) {
      pendingRootRef.current = null;
      await runInstall(root.source, root.label, undefined);
      return true;
    }
    return false;
  };

  const runInstall = async (
    source: ExtensionPackageSource,
    label: string,
    acceptedPermissions?: ExtensionPermissionKey[],
  ) => {
    setBusyKey(label);
    setError(null);
    setNotice(null);
    try {
      const outcome = await store.manager.install(source, {
        acceptedPermissions,
      });
      if (outcome.status === "needs-permissions") {
        setConsent({ pending: outcome.pending, source });
        return;
      }
      if (outcome.status === "signature-rejected") {
        // A refused signature is not a validation error the user can shrug
        // off: say which check failed and how to trust the signer (§51).
        setError(
          `${outcome.manifest.id} was not installed. ${signaturePolicyMessage(
            outcome.verdict,
          )}`,
        );
        return;
      }
      if (outcome.status === "needs-app-update") {
        // A plugin that needs native functionality this install lacks
        // (§36): name exactly what is missing and point at the app update
        // (§42), instead of installing something that cannot run.
        setError(
          `${outcome.manifest.id} needs a newer Ajiro Agent (missing: ${outcome.missingCapabilities.join(", ")}). Update the app to install it.`,
        );
        return;
      }
      if (outcome.status === "needs-dependencies") {
        // The plan says what the package actually needs, and whether the
        // requirement can even be satisfied (§53). Dependencies are installed
        // first, each through its own consent prompt.
        const plan =
          source.kind === "registry"
            ? await store.manager.planInstall(source.pluginId).catch(() => null)
            : null;
        const issues = plan ? describeDependencyIssues(plan.issues) : [];
        setDependencyIssues(issues);
        if (plan && plan.installOrder.length > 0) {
          pendingRootRef.current = { label, source };
          dependencyQueueRef.current = plan.installOrder.map((entry) => ({
            label: `dep:${entry.id}`,
            source: { kind: "registry", pluginId: entry.id },
          }));
          setNotice(
            `Installing ${plan.installOrder.length} required extension${
              plan.installOrder.length === 1 ? "" : "s"
            } first.`,
          );
          if (await continueInstallQueue()) return;
        }
        setError(
          `This extension requires: ${outcome.missing.join(", ")}.${
            issues.length > 0 ? ` ${issues.join(" ")}` : " Install the dependencies first."
          }`,
        );
        return;
      }
      await refreshRecords();
      // Finish a dependency-first run before reporting success (§53).
      if (await continueInstallQueue()) return;
      setDependencyIssues([]);
      setConsent(null);
      setUrlOpen(false);
      setNotice(`${outcome.record.id} installed. Enable it to activate.`);
      setDetailId(null);
    } catch (installError) {
      setError(
        installError instanceof Error
          ? installError.message
          : "The extension package failed validation and was rejected.",
      );
    } finally {
      setBusyKey(null);
    }
  };

  const pickLocalZip = async () => {
    const { getDocumentAsync } = await import("expo-document-picker");
    const result = await getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: false,
      type: "*/*",
    });
    if (result.canceled || result.assets.length === 0) return;
    await runInstall({ kind: "file", uri: result.assets[0].uri }, "local-zip");
  };

  const toggleEnabled = async (record: InstalledExtensionRecord) => {
    setBusyKey(`toggle:${record.id}`);
    setError(null);
    setNotice(null);
    try {
      if (record.enabled) {
        await store.manager.disable(record.id);
        setNotice(`${record.id} disabled. Its files are still installed.`);
      } else {
        await store.manager.enable(record.id);
        setNotice(`${record.id} enabled.`);
      }
    } catch (toggleError) {
      // Compatibility is re-checked on every activation (§34): a plugin that
      // fails to initialize is marked broken instead of crashing the app.
      setError(
        toggleError instanceof Error
          ? toggleError.message
          : `${record.id} failed to activate.`,
      );
    } finally {
      await refreshRecords();
      setBusyKey(null);
    }
  };

  const confirmUninstall = async () => {
    const target = uninstallTarget;
    if (!target) return;
    setBusyKey(`remove:${target.id}`);
    setError(null);
    try {
      await store.manager.uninstall(target.id);
      await refreshRecords();
      setNotice(`${target.id} uninstalled.`);
      setUninstallTarget(null);
      setDetailId(null);
    } catch (uninstallError) {
      setError(
        uninstallError instanceof Error
          ? uninstallError.message
          : `${target.id} could not be uninstalled.`,
      );
    } finally {
      setBusyKey(null);
    }
  };

  /** Retry after a crash: clear the persisted broken mark (§43/§52). */
  const clearBrokenMark = async (pluginId: string) => {
    setBusyKey(`recover:${pluginId}`);
    setError(null);
    try {
      await store.manager.clearBrokenMark(pluginId);
      await refreshRecords();
      setNotice(`${pluginId} can be enabled again.`);
    } catch (recoverError) {
      setError(
        recoverError instanceof Error
          ? recoverError.message
          : `${pluginId} could not be cleared.`,
      );
    } finally {
      setBusyKey(null);
    }
  };

  /**
   * Update every extension with a newer compatible version (§33). Failures
   * are collected rather than aborting the batch: one broken extension must
   * not stop the others from updating.
   */
  const updateAll = async () => {
    const updates = updateIds;
    if (updates.size === 0) {
      setNotice("Everything is up to date.");
      return;
    }
    setBusyKey("update-all");
    setError(null);
    setNotice(null);
    const failures: string[] = [];
    let updated = 0;
    try {
      for (const pluginId of updates) {
        try {
          // Transient network failures are retried with backoff so one flaky
          // download cannot fail a whole batch (§33).
          await store.manager.updateWithRetry(pluginId, {
            attempts: 3,
            baseDelayMs: 600,
          });
          updated += 1;
        } catch (updateError) {
          failures.push(
            `${pluginId}: ${
              updateError instanceof Error ? updateError.message : "failed"
            }`,
          );
        }
      }
      await refreshRecords();
      setNotice(
        `${updated} of ${updates.size} extension(s) updated.${
          failures.length ? " Failures are listed below." : ""
        }`,
      );
      if (failures.length > 0) setError(failures.join("\n"));
    } finally {
      setBusyKey(null);
    }
  };

  /** Restore the version an update replaced (§33). */
  const rollbackExtension = async (pluginId: string) => {
    setBusyKey(`rollback:${pluginId}`);
    setError(null);
    try {
      const record = await store.manager.rollback(pluginId);
      await refreshRecords();
      setNotice(`Rolled back to v${record.version}. Enable it to activate.`);
    } catch (rollbackError) {
      setError(
        rollbackError instanceof Error
          ? rollbackError.message
          : `${pluginId} could not be rolled back.`,
      );
    } finally {
      setBusyKey(null);
    }
  };

  const detail = entries.find((entry) => entry.id === detailId) ?? null;
  const detailRecord = records.find((record) => record.id === detailId) ?? null;
  /**
   * Formatters for the open plugin, with per-language rows derived from the
   * editor extension table (§50). The name lookup spans every plugin so a
   * persisted default owned by another plugin still resolves.
   */
  const detailFormatters = useMemo(
    () =>
      detailId
        ? allFormatters.filter((item) => item.pluginId === detailId)
        : [],
    [allFormatters, detailId],
  );
  const formatterNameById = useMemo(() => {
    const names = new Map<string, string>();
    for (const item of allFormatters) {
      names.set(item.formatterId, item.displayName || item.formatterId);
    }
    return names;
  }, [allFormatters]);
  // Hoisted so the JSX closures below keep the non-null narrowing.
  const detailRepository = detail?.repository ?? null;
  // Hoisted for the drawers rendered outside the detail branch, where
  // TypeScript has already narrowed `detail` to null.
  const detailName = detail?.name ?? "Extension";
  const detailPluginId = detail?.id ?? null;

  /**
   * README + changelog come out of the installed package (§60), so they are
   * available offline and always describe the version on disk. For entries
   * that are not installed, fall back to inline registry markdown: the live
   * registry carries `changelogs` as text (verified firsthand), and a value
   * containing a newline is prose, never a package path.
   */
  useEffect(() => {
    if (!detail) {
      setReadme(null);
      setChangelog(null);
      return;
    }
    if (!detailRecord) {
      const inline = (value: string | null) =>
        value && value.includes("\n") ? value.slice(0, 20_000) : null;
      setReadme(inline(detail.readme));
      setChangelog(inline(detail.changelog));
      return;
    }
    let cancelled = false;
    const doc = (key: "changelogs" | "readme") => {
      const value = detailRecord.manifest[key];
      return typeof value === "string" && value ? value : null;
    };
    const load = async (name: string | null) => {
      if (!name) return null;
      const text = await store.deps.platform.readText(
        `${pluginDir(store.deps.paths, detail.id)}/${name}`,
      );
      return text ? text.slice(0, 20_000) : null;
    };
    Promise.all([load(doc("readme")), load(doc("changelogs"))])
      .then(([readmeText, changelogText]) => {
        if (cancelled) return;
        setReadme(readmeText);
        setChangelog(changelogText);
      })
      .catch(() => {
        if (cancelled) return;
        setReadme(null);
        setChangelog(null);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailId, detailRecord?.updatedAt]);

  /** Does this extension have a version it can roll back to? (§33) */
  useEffect(() => {
    if (!detailId) {
      setRollbackAvailable(false);
      return;
    }
    let cancelled = false;
    store.manager
      .hasRollbackPoint(detailId)
      .then((available) => {
        if (!cancelled) setRollbackAvailable(available);
      })
      .catch(() => {
        if (!cancelled) setRollbackAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, [detailId, records, store.manager]);

  const stateLabel = (entry: ExtensionMetadata) => {
    const state = deriveExtensionInstallState(entry, records);
    // Revocation wins over update hints: a revoked extension is never
    // offered an update (§24).
    if (state === "revoked") return "Revoked";
    if (state !== "update-available" && updateIds.has(entry.id)) {
      return "Update available";
    }
    switch (state) {
      case "installed":
        return "Installed";
      case "installed-broken":
        return "Broken";
      case "installed-disabled":
        return "Disabled";
      case "update-available":
        return "Update available";
      default:
        return "Not installed";
    }
  };

  const markdownStyles = useMemo(
    () => createExtensionMarkdownStyles(theme),
    [theme],
  );

  const categories = useMemo(() => listCategories(entries), [entries]);
  // Search is indexed once per catalog revision, not per keystroke (§66).
  const searchIndex = useMemo(() => buildCatalogSearchIndex(entries), [entries]);
  const matched = useMemo(
    () =>
      filterCatalogEntries(entries, records, {
        category,
        channel: preferences.updateChannel,
        installedOnly: section === "installed",
        query,
        searchIndex,
        state: section === "installed" ? stateFilter : null,
      }),
    [
      category,
      entries,
      preferences.updateChannel,
      records,
      query,
      searchIndex,
      section,
      stateFilter,
    ],
  );
  /**
   * The state filter derives from catalog comparison only, so server-only
   * update hints are unioned back in: they passed the same newer-version
   * check when they were recorded (§19).
   */
  const matchedWithServerUpdates = useMemo(() => {
    if (
      section !== "installed" ||
      stateFilter !== "update-available" ||
      serverUpdates.size === 0
    ) {
      return matched;
    }
    const seen = new Set(matched.map((entry) => entry.id));
    const extra = entries.filter(
      (entry) =>
        !seen.has(entry.id) &&
        updateIds.has(entry.id) &&
        records.some((item) => item.id === entry.id),
    );
    return [...matched, ...extra];
  }, [entries, matched, records, section, serverUpdates.size, stateFilter, updateIds]);
  // Featured shelf (§28): presentation-only ordering, shown on the unsearched
  // Explore view so it can never displace a search result.
  const featured = useMemo(
    () =>
      section === "explore" && !query.trim() && !category
        ? listFeaturedExtensions(entries)
        : [],
    [category, entries, query, section],
  );
  // Sorting and paging happen here so the catalog cache stays untouched (§66).
  const ordered = useMemo(
    () => sortCatalogEntries(matchedWithServerUpdates, sort),
    [matchedWithServerUpdates, sort],
  );
  const visible = useMemo(
    () => ordered.slice(0, pageLimit),
    [ordered, pageLimit],
  );
  const updateCount = updateIds.size;
  const detailIconUri = useMemo(
    () =>
      detail
        ? extensionIconUri(
            detail,
            detailRecord,
            detailRecord ? pluginDir(store.deps.paths, detailRecord.id) : null,
          )
        : null,
    [detail, detailRecord, store.deps.paths],
  );

  if (detail) {
    const record = detailRecord;
    return (
      <Container contentClassName="gap-sp-4 py-sp-4" includeBottomTabInset={false} scroll>
        <AppHeader
          left={
            <CircleIconButton accessibilityLabel="Back" onPress={() => setDetailId(null)}>
              <ChevronLeft color={theme.text} size={20} strokeWidth={2} />
            </CircleIconButton>
          }
          title={detail.name}
        />
        <Card className="gap-sp-3 px-sp-4 py-sp-4">
          <View className="flex-row items-center gap-sp-3">
            <ExtensionIcon size={48} uri={detailIconUri} />
            <View className="min-w-0 flex-1">
              <Text className="font-sans text-lg font-semibold text-foreground dark:text-foreground-dark">
                {detail.name}
              </Text>
              <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                v{detail.version} ·{" "}
                {detail.author?.name ?? detail.author?.github ?? "Unknown author"}
              </Text>
            </View>
          </View>
          {detail.description ? (
            <Text className="font-sans text-sm text-foreground dark:text-foreground-dark">
              {detail.description}
            </Text>
          ) : null}
          <View className="gap-1">
            {detail.keywords.length > 0 ? (
              <Text className="font-mono text-xs text-muted-foreground dark:text-muted-foreground-dark">
                Keywords: {detail.keywords.join(", ")}
              </Text>
            ) : null}
            {detail.license ? (
              <Text className="font-mono text-xs text-muted-foreground dark:text-muted-foreground-dark">
                License: {detail.license}
              </Text>
            ) : null}
            <Text className="font-mono text-xs text-muted-foreground dark:text-muted-foreground-dark">
              ID: {detail.id}
            </Text>
          </View>
          {record ? (
            <>
              <Separator />
              <View className="flex-row items-center gap-sp-2">
                <ShieldCheck color={theme.text} size={16} strokeWidth={2} />
                <Text className="font-sans text-xs font-semibold text-foreground dark:text-foreground-dark">
                  Compatibility: {compatibilityLabel(record.compatibility.level)}
                </Text>
              </View>
              {record.compatibility.reasons.map((reason) => (
                <Text
                  key={reason}
                  className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark"
                >
                  • {reason}
                </Text>
              ))}
              <Separator />
              {/* Publisher signature (§51): the verdict recorded when this
                  very package was installed, or an honest "not recorded". */}
              <View className="flex-row items-center gap-sp-2">
                <Fingerprint
                  color={
                    record.signature?.status === "verified"
                      ? theme.text
                      : theme.textSecondary
                  }
                  size={16}
                  strokeWidth={2}
                />
                <Text className="font-sans text-xs font-semibold text-foreground dark:text-foreground-dark">
                  {signatureLabel(record.signature?.status ?? "unsigned")}
                </Text>
              </View>
              <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                {record.signature?.detail ??
                  "No signature verdict was recorded for this version. Reinstall or update it to check its publisher signature."}
              </Text>
              {preferences.requireSignedPackages &&
              record.signature?.status !== "verified" ? (
                <Text className="font-sans text-xs text-destructive dark:text-destructive-dark">
                  You require signed packages, so this extension cannot be
                  updated until its signing key is trusted or that preference is
                  turned off.
                </Text>
              ) : null}
            </>
          ) : null}
          {record?.runtimeState === "broken" ? (
            <>
              <Separator />
              <View className="flex-row items-center gap-sp-2">
                <CircleAlert color={theme.destructive} size={16} strokeWidth={2} />
                <Text className="flex-1 font-sans text-xs font-semibold text-destructive dark:text-destructive-dark">
                  This extension was marked broken after it failed to initialize.
                </Text>
              </View>
              {record.runtimeError ? (
                <Text
                  className="font-mono text-xs text-muted-foreground dark:text-muted-foreground-dark"
                  selectable
                >
                  {record.runtimeError}
                </Text>
              ) : null}
              <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                {rollbackAvailable
                  ? "Retry the current version, or restore the version the last update replaced."
                  : "Clear the mark to allow another activation attempt."}
              </Text>
              <View className="flex-row flex-wrap gap-sp-2">
                <Button
                  loading={busyKey === `recover:${detail.id}`}
                  onPress={() => clearBrokenMark(detail.id)}
                  variant="outline"
                >
                  Clear broken mark
                </Button>
                {rollbackAvailable ? (
                  <Button
                    leftIcon={<Trash2 color={theme.textSecondary} size={16} />}
                    loading={busyKey === `rollback:${detail.id}`}
                    onPress={() => rollbackExtension(detail.id)}
                    variant="outline"
                  >
                    Roll back
                  </Button>
                ) : null}
              </View>
            </>
          ) : null}
          {record && !record.enabled ? (
            <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
              Disabled — the package stays installed, but its plugin code does
              not run.
            </Text>
          ) : null}
          {(() => {
            // Server-reported update the synced catalog does not show (§19):
            // only when the catalog itself shows no update, so the two
            // sources never double-report.
            if (!record || !detail) return null;
            const reported = serverUpdates.get(detail.id);
            if (
              !reported ||
              compareExtensionVersions(reported, record.version) <= 0
            ) {
              return null;
            }
            const catalogEntry = entries.find(
              (entry) => entry.id === detail.id,
            );
            if (
              catalogEntry &&
              compareExtensionVersions(catalogEntry.version, record.version) > 0
            ) {
              return null;
            }
            return (
              <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                The registry reports v{reported} while the synced catalog
                shows v{record.version} — Update all downloads the latest.
              </Text>
            );
          })()}

          {/* Plugin commands (§45): registered inside the runtime document and
              mirrored here, so they can be listed and run from the app. */}
          {commands.length > 0 ? (
            <>
              <Separator />
              <View className="flex-row items-center gap-sp-2">
                <ListChecks color={theme.text} size={16} strokeWidth={2} />
                <Text className="font-sans text-xs font-semibold text-foreground dark:text-foreground-dark">
                  Commands ({commands.length})
                </Text>
              </View>
              {commands.map((command) => (
                <View
                  className="flex-row items-center gap-sp-2"
                  key={command.name}
                >
                  <View className="min-w-0 flex-1">
                    <Text className="font-mono text-xs text-foreground dark:text-foreground-dark">
                      {command.name}
                    </Text>
                    {command.description ? (
                      <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                        {command.description}
                      </Text>
                    ) : null}
                    {command.chordId ? (
                      <Text className="font-mono text-xs text-muted-foreground dark:text-muted-foreground-dark">
                        {formatChordId(command.chordId)}
                        {bindingConflicts.has(command.chordId)
                          ? " — conflicted, never dispatched"
                          : ""}
                      </Text>
                    ) : command.bindKey ? (
                      <Text className="font-mono text-xs text-muted-foreground dark:text-muted-foreground-dark">
                        {Object.entries(command.bindKey)
                          .map(([modifier, key]) => `${modifier}+${key}`)
                          .join(", ")}{" "}
                        — not bound on this device
                      </Text>
                    ) : null}
                  </View>
                  <Button
                    disabled={!command.executable}
                    leftIcon={<Play color={theme.textSecondary} size={14} />}
                    onPress={() => {
                      if (!bridge.runCommand(command.name)) {
                        setError(
                          "The plugin runtime document is not running, so the command could not be executed.",
                        );
                      }
                    }}
                    variant="outline"
                  >
                    Run
                  </Button>
                </View>
              ))}
              <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                Commands live inside the plugin runtime document and are only
                available while it is running.
              </Text>
            </>
          ) : null}

          {/* Plugin formatters (§50): registered inside the runtime document,
              with a per-language default that persists in preferences. */}
          {detailFormatters.length > 0 ? (
            <>
              <Separator />
              <View className="flex-row items-center gap-sp-2">
                <Brush color={theme.text} size={16} strokeWidth={2} />
                <Text className="font-sans text-xs font-semibold text-foreground dark:text-foreground-dark">
                  Formatters ({detailFormatters.length})
                </Text>
              </View>
              {detailFormatters.map((formatter) => (
                <View className="gap-sp-1" key={formatter.formatterId}>
                  <Text className="font-mono text-xs text-foreground dark:text-foreground-dark">
                    {formatter.displayName || formatter.formatterId}
                  </Text>
                  <Text className="font-mono text-xs text-muted-foreground dark:text-muted-foreground-dark">
                    {formatter.extensions.join(", ")}
                  </Text>
                  {languageIdsForExtensions(
                    formatter.extensions,
                    EXTENSION_TO_MODE_KEY,
                  ).map((languageId) => {
                    const selected = preferences.formatters[languageId] ?? null;
                    const selectedName = selected
                      ? (formatterNameById.get(selected) ?? selected)
                      : null;
                    const isDefault = selected === formatter.formatterId;
                    return (
                      <View
                        className="flex-row items-center gap-sp-2"
                        key={languageId}
                      >
                        <View className="min-w-0 flex-1">
                          <Text className="font-mono text-xs text-foreground dark:text-foreground-dark">
                            {languageId}
                          </Text>
                          <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                            {isDefault
                              ? "This formatter is the default"
                              : selectedName
                                ? `Default: ${selectedName}`
                                : "Default: automatic"}
                          </Text>
                        </View>
                        {isDefault ? (
                          <Button
                            onPress={() => void clearFormatter(languageId)}
                            variant="outline"
                          >
                            Clear
                          </Button>
                        ) : (
                          <Button
                            onPress={() =>
                              void selectFormatter(
                                languageId,
                                formatter.formatterId,
                              )
                            }
                            variant="outline"
                          >
                            Use as default
                          </Button>
                        )}
                      </View>
                    );
                  })}
                </View>
              ))}
              <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                Formatters live inside the plugin runtime document and are only
                available while it is running. Clearing a default restores
                Acode&apos;s automatic choice.
              </Text>
            </>
          ) : null}

          {/* Plugin settings (§59): namespaced per extension, stored next to
              its other private data, and cleared when it is uninstalled. */}
          {record && pluginSettings && Object.keys(pluginSettings).length > 0 ? (
            <>
              <Separator />
              <Pressable
                accessibilityRole="button"
                onPress={() => setSettingsOpen(true)}
                style={({ pressed }) => (pressed ? { opacity: 0.75 } : null)}
              >
                <View className="flex-row items-center gap-sp-2">
                  <Settings2 color={theme.text} size={16} strokeWidth={2} />
                  <Text className="flex-1 font-sans text-xs font-semibold text-foreground dark:text-foreground-dark">
                    Settings ({Object.keys(pluginSettings).length})
                  </Text>
                  <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                    Edit
                  </Text>
                </View>
              </Pressable>
            </>
          ) : null}

          {/* Diagnostics (§52/§57): persisted plugin output and shutdown
              reasons, so a failure is diagnosable after a restart. */}
          {record && (diagnostics.length > 0 || record.runtimeError) ? (
            <>
              <Separator />
              <Pressable
                accessibilityRole="button"
                onPress={() => setDiagnosticsOpen(true)}
                style={({ pressed }) => (pressed ? { opacity: 0.75 } : null)}
              >
                <View className="flex-row items-center gap-sp-2">
                  <Terminal color={theme.text} size={16} strokeWidth={2} />
                  <Text className="flex-1 font-sans text-xs font-semibold text-foreground dark:text-foreground-dark">
                    Diagnostics ({diagnostics.length})
                  </Text>
                  <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                    View
                  </Text>
                </View>
              </Pressable>
              <Text
                className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark"
                numberOfLines={2}
              >
                {diagnostics[0]?.message ?? record.runtimeError}
              </Text>
            </>
          ) : null}
          {readme ? (
            <>
              <Separator />
              <Text className="font-sans text-xs font-semibold text-foreground dark:text-foreground-dark">
                README
              </Text>
              <Markdown
                markdownit={MARKDOWN_PARSER}
                onLinkPress={(link) => openExternalLink(link)}
                style={markdownStyles}
              >
                {readme}
              </Markdown>
            </>
          ) : null}
          {changelog ? (
            <>
              <Separator />
              <Text className="font-sans text-xs font-semibold text-foreground dark:text-foreground-dark">
                Changelog
              </Text>
              <Markdown
                markdownit={MARKDOWN_PARSER}
                onLinkPress={(link) => openExternalLink(link)}
                style={markdownStyles}
              >
                {changelog}
              </Markdown>
            </>
          ) : null}
        </Card>

        {detail.revoked ? (
          <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
            Revoked by the registry — this extension cannot be installed,
            updated, or re-enabled. Uninstall removes it entirely.
          </Text>
        ) : null}
        <View className="flex-row flex-wrap gap-sp-2">
          {!record && !detail.revoked ? (
            <Button
              leftIcon={<Download color={theme.accentForeground} size={16} />}
              loading={busyKey === `install:${detail.id}`}
              onPress={() => runInstall(sourceFor(detail), `install:${detail.id}`)}
            >
              Install
            </Button>
          ) : null}
          {record && stateLabel(detail) === "Update available" ? (
            <Button
              leftIcon={<Download color={theme.accentForeground} size={16} />}
              loading={busyKey === `install:${detail.id}`}
              onPress={() => runInstall(sourceFor(detail), `install:${detail.id}`)}
            >
              Update to v{detail.version}
            </Button>
          ) : null}
          {record && (record.enabled || !detail.revoked) ? (
            <>
              <Button
                loading={busyKey === `toggle:${detail.id}`}
                onPress={() => toggleEnabled(record)}
                variant={record.enabled ? "outline" : "default"}
              >
                {record.enabled ? "Disable" : "Enable"}
              </Button>
              <Button
                leftIcon={<Trash2 color={theme.textSecondary} size={16} />}
                onPress={() => setUninstallTarget(detail)}
                variant="outline"
              >
                Uninstall
              </Button>
            </>
          ) : null}
          {record && detail.revoked && !record.enabled ? (
            <Button
              leftIcon={<Trash2 color={theme.textSecondary} size={16} />}
              onPress={() => setUninstallTarget(detail)}
              variant="outline"
            >
              Uninstall
            </Button>
          ) : null}
          {detailRepository ? (
            <Button
              onPress={() => Linking.openURL(detailRepository).catch(() => {})}
              variant="outline"
            >
              <View className="flex-row items-center gap-sp-2">
                <ExternalLink color={theme.text} size={16} />
                <Text className="font-sans text-sm">Open source</Text>
              </View>
            </Button>
          ) : null}
        </View>

        {error ? (
          <Text className="font-sans text-sm text-destructive dark:text-destructive-dark">
            {error}
          </Text>
        ) : null}
      </Container>
    );
  }

  return (
    <>
      <Container contentClassName="gap-sp-4 py-sp-4" includeBottomTabInset={false} scroll>
        <AppHeader
          left={
            <CircleIconButton accessibilityLabel="Back" onPress={() => router.back()}>
              <ChevronLeft color={theme.text} size={20} strokeWidth={2} />
            </CircleIconButton>
          }
          title="Plugins"
          right={
            <View className="flex-row items-center gap-sp-2">
              <CircleIconButton
                accessibilityLabel="Extension preferences"
                onPress={() => setPreferencesOpen(true)}
              >
                <Settings2 color={theme.text} size={20} strokeWidth={2} />
              </CircleIconButton>
              <CircleIconButton accessibilityLabel="Refresh catalog" onPress={runSync}>
                {busyKey === "sync" ? (
                  <ActivityIndicator size="small" color={theme.text} />
                ) : (
                  <RefreshCw color={theme.text} size={20} strokeWidth={2} />
                )}
              </CircleIconButton>
            </View>
          }
        />

        {newCount > 0 && preferences.notifyOnDiscovery ? (
          <Card className="flex-row items-center gap-sp-2 px-sp-3 py-sp-2">
            <Package color={theme.accent} size={16} />
            <Text className="flex-1 font-sans text-xs text-foreground dark:text-foreground-dark">
              {newCount} new extension{newCount === 1 ? "" : "s"} discovered from the
              registry.
            </Text>
          </Card>
        ) : null}

        <SectionSwitch section={section} setSection={setSection} />

        <View className="flex-row items-center gap-sp-2">
          <Search color={theme.textSecondary} size={18} strokeWidth={2} />
          <View className="flex-1">
            <Input
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setQuery}
              placeholder={
                section === "installed" ? "Search installed" : "Search extensions"
              }
              value={query}
            />
          </View>
          {syncStatus === "offline" ? (
            <CircleAlert color={theme.textSecondary} size={20} />
          ) : null}
        </View>

        {categories.length > 0 ? (
          <View className="flex-row flex-wrap gap-sp-2">
            <FilterChip
              active={category === null}
              label="All"
              onPress={() => setCategory(null)}
            />
            {categories.map((item) => (
              <FilterChip
                active={category === item}
                key={item}
                label={item}
                onPress={() => setCategory(item)}
              />
            ))}
          </View>
        ) : null}

        {/* Sorting (§29). The catalog cache keeps registry order; this only
            changes presentation. */}
        <View className="flex-row flex-wrap items-center gap-sp-2">
          <SlidersHorizontal color={theme.textSecondary} size={14} strokeWidth={2} />
          {(Object.keys(SORT_LABELS) as CatalogSort[]).map((option) => (
            <FilterChip
              active={sort === option}
              key={option}
              label={SORT_LABELS[option]}
              onPress={() => setSort(option)}
            />
          ))}
        </View>

        {/* Installed-state filters (§28). Sorting cannot express "show me the
            broken ones", so state gets its own row when it can matter. */}
        {section === "installed" ? (
          <View className="flex-row flex-wrap items-center gap-sp-2">
            {CATALOG_STATE_FILTERS.map((option) => (
              <FilterChip
                active={stateFilter === option}
                key={option}
                label={STATE_FILTER_LABELS[option]}
                onPress={() => setStateFilter(option)}
              />
            ))}
          </View>
        ) : null}

        {notice ? (
          <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
            {notice}
          </Text>
        ) : null}
        {error ? (
          <Text className="font-sans text-sm text-destructive dark:text-destructive-dark">
            {error}
          </Text>
        ) : null}

        {/* Dependency report (§53): what a package needs, and why a plan
            could not be resolved. */}
        {dependencyIssues.length > 0 ? (
          <Card className="gap-sp-1 px-sp-4 py-sp-3">
            <Text className="font-sans text-xs font-medium text-foreground dark:text-foreground-dark">
              Dependency report
            </Text>
            {dependencyIssues.map((line) => (
              <Text
                className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark"
                key={line}
              >
                {line}
              </Text>
            ))}
          </Card>
        ) : null}

        {updateCount > 0 && section === "installed" ? (
          <Card className="gap-sp-2 px-sp-4 py-sp-3">
            <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
              {updateCount} extension{updateCount === 1 ? "" : "s"} can be
              updated. Updating an enabled extension re-activates it; the
              replaced version is kept until the new one loads.
            </Text>
            <View className="flex-row">
              <Button
                leftIcon={<RotateCcw color={theme.accentForeground} size={16} />}
                loading={busyKey === "update-all"}
                onPress={() => {
                  void updateAll();
                }}
              >
                Update all
              </Button>
            </View>
          </Card>
        ) : null}

        {/* Featured shelf (§28). The registry publishes no featured flag, so
            this is a deterministic presentation order (see listFeatured...);
            it only appears on the unsearched Explore view. */}
        {featured.length > 0 ? (
          <View className="gap-sp-2">
            <Text className="font-sans text-xs font-medium uppercase text-muted-foreground dark:text-muted-foreground-dark">
              Featured
            </Text>
            {featured.slice(0, 4).map((entry) => {
              const record = records.find((item) => item.id === entry.id) ?? null;
              return (
                <ExtensionCard
                  entry={entry}
                  iconUri={extensionIconUri(
                    entry,
                    record,
                    record ? pluginDir(store.deps.paths, record.id) : null,
                  )}
                  key={`featured-${entry.id}`}
                  onPress={() => setDetailId(entry.id)}
                  state={stateLabel(entry)}
                />
              );
            })}
          </View>
        ) : null}

        {visible.length === 0 ? (
          <Card className="px-sp-4 py-sp-4">
            <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
              {section === "installed"
                ? stateFilter === "all"
                  ? "No extensions installed yet. Explore the store to get started."
                  : `No installed extensions are ${STATE_FILTER_LABELS[stateFilter].toLowerCase()}.`
                : query
                  ? "No extensions match your search."
                  : "The catalog is empty."}
            </Text>
          </Card>
        ) : (
          <View className="gap-sp-2">
            {visible.map((entry) => {
              const record = records.find((item) => item.id === entry.id) ?? null;
              return (
                <ExtensionCard
                  entry={entry}
                  iconUri={extensionIconUri(
                    entry,
                    record,
                    record ? pluginDir(store.deps.paths, record.id) : null,
                  )}
                  key={entry.id}
                  onPress={() => setDetailId(entry.id)}
                  state={stateLabel(entry)}
                />
              );
            })}
            {ordered.length > visible.length ? (
              <Button
                onPress={() => setPageLimit((current) => current + CATALOG_PAGE_SIZE)}
                variant="outline"
              >
                Show {Math.min(CATALOG_PAGE_SIZE, ordered.length - visible.length)} more
                (of {ordered.length})
              </Button>
            ) : null}
          </View>
        )}

        <View className="flex-row flex-wrap gap-sp-2">
          <Button
            leftIcon={<FileUp color={theme.textSecondary} size={16} />}
            loading={busyKey === "local-zip"}
            onPress={pickLocalZip}
            variant="outline"
          >
            Install from file
          </Button>
          <Button
            leftIcon={<ExternalLink color={theme.textSecondary} size={16} />}
            onPress={() => setUrlOpen(true)}
            variant="outline"
          >
            Install from URL
          </Button>
        </View>

        <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
          New extensions appear here automatically as the registry publishes
          them. Installing and enabling are always your choice.
        </Text>
      </Container>

      {/* Permission consent (§50): capabilities are shown before anything is
          written to disk or executed. */}
      <Drawer
        onOpenChange={(open) => {
          if (!open) setConsent(null);
        }}
        open={consent !== null}
      >
        <DrawerContent showCloseButton showHandle>
          <DrawerHeader>
            <DrawerTitle>Permissions</DrawerTitle>
            <DrawerDescription>
              This extension asks for the following capabilities. Ajiro grants
              nothing above this list, and nothing runs until you enable it.
            </DrawerDescription>
          </DrawerHeader>
          <DrawerBody contentContainerClassName="gap-sp-2 pb-sp-4">
            {consent?.pending.map((key) => (
              <View className="flex-row items-center gap-sp-2" key={key}>
                <ShieldCheck color={theme.text} size={16} strokeWidth={2} />
                <View className="min-w-0 flex-1">
                  <Text className="font-sans text-sm text-foreground dark:text-foreground-dark">
                    {key}
                  </Text>
                  <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                    {PERMISSION_LABELS[key]}
                  </Text>
                </View>
              </View>
            ))}
          </DrawerBody>
          <DrawerFooter>
            <Button
              loading={busyKey === "consent"}
              onPress={() => {
                if (!consent) return;
                void runInstall(consent.source, "consent", consent.pending);
              }}
            >
              Allow and install
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      {/* Remote ZIP install (§14): downloaded, validated, and only then
          staged — remote code is never executed. */}
      <Drawer
        onOpenChange={(open) => {
          setUrlOpen(open);
          if (!open) setUrlValue("");
        }}
        open={urlOpen}
      >
        <DrawerContent showCloseButton showHandle>
          <DrawerHeader>
            <DrawerTitle>Install from URL</DrawerTitle>
            <DrawerDescription>
              Paste a direct link to an Acode-compatible plugin ZIP. The package
              is downloaded, validated, and shown for confirmation before it is
              installed.
            </DrawerDescription>
          </DrawerHeader>
          <DrawerBody contentContainerClassName="gap-sp-3 pb-sp-4">
            <Input
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              onChangeText={setUrlValue}
              placeholder="https://example.com/plugin.zip"
              value={urlValue}
            />
            {urlValue && !/^https:\/\//i.test(urlValue.trim()) ? (
              <Text className="font-sans text-xs text-destructive dark:text-destructive-dark">
                Only https:// links are accepted.
              </Text>
            ) : null}
          </DrawerBody>
          <DrawerFooter>
            <Button
              disabled={!/^https:\/\//i.test(urlValue.trim())}
              loading={busyKey === "remote-url"}
              onPress={() =>
                runInstall(
                  { kind: "url", url: urlValue.trim() },
                  "remote-url",
                )
              }
            >
              Download and validate
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      {/* Extension preferences (§63/§64). These govern discovery and
          consent — never whether installed code runs. */}
      <Drawer
        onOpenChange={setPreferencesOpen}
        open={preferencesOpen}
      >
        <DrawerContent showCloseButton showHandle>
          <DrawerHeader>
            <DrawerTitle>Extension preferences</DrawerTitle>
            <DrawerDescription>
              Discovery is automatic; running code is always your decision.
            </DrawerDescription>
          </DrawerHeader>
          <DrawerBody contentContainerClassName="gap-sp-4 pb-sp-4">
            <View className="flex-row items-start gap-sp-3">
              <Switch
                onValueChange={(value) => {
                  void savePreference({ notifyOnDiscovery: value });
                }}
                value={preferences.notifyOnDiscovery}
              />
              <View className="min-w-0 flex-1">
                <Text className="font-sans text-sm text-foreground dark:text-foreground-dark">
                  Show new extension notices
                </Text>
                <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                  Indicate in the sidebar when the registry publishes
                  extensions you have not seen yet.
                </Text>
              </View>
            </View>
            <View className="flex-row items-start gap-sp-3">
              <Switch
                onValueChange={(value) => {
                  void savePreference({ allowPluginInstallRequests: value });
                }}
                value={preferences.allowPluginInstallRequests}
              />
              <View className="min-w-0 flex-1">
                <Text className="font-sans text-sm text-foreground dark:text-foreground-dark">
                  Allow extensions to request installs
                </Text>
                <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                  A plugin may ask to install another extension. You still
                  approve every request and see its capabilities first.
                </Text>
              </View>
            </View>
            {/* Update channel (§44): higher-risk channels never leak into a
                lower one. Production default is stable. */}
            <View className="gap-sp-2">
              <Text className="font-sans text-sm text-foreground dark:text-foreground-dark">
                Update channel
              </Text>
              <View className="flex-row gap-sp-2">
                {(["stable", "beta", "preview"] as const).map((channel) => (
                  <Button
                    key={channel}
                    onPress={() => {
                      void savePreference({ updateChannel: channel });
                    }}
                    variant={preferences.updateChannel === channel ? "default" : "outline"}
                  >
                    {channel[0]?.toUpperCase() + channel.slice(1)}
                  </Button>
                ))}
              </View>
              <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                Beta also offers stable releases; preview offers everything.
              </Text>
            </View>

            <Separator />

            {/* Publisher signatures (§51). Acode itself publishes no
                signatures, so the default posture is "record, do not
                refuse" — requiring them means "only the publishers I trust". */}
            <View className="flex-row items-start gap-sp-3">
              <Switch
                onValueChange={(value) => {
                  void savePreference({ requireSignedPackages: value });
                }}
                value={preferences.requireSignedPackages}
              />
              <View className="min-w-0 flex-1">
                <Text className="font-sans text-sm text-foreground dark:text-foreground-dark">
                  Require signed packages
                </Text>
                <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                  Refuse any package whose publisher signature is not verified
                  by a key you trust. Most Acode plugins are unsigned and will
                  be refused while this is on.
                </Text>
              </View>
            </View>

            <Text className="font-sans text-xs font-semibold text-foreground dark:text-foreground-dark">
              Trusted signing keys ({Object.keys(preferences.trustedSigningKeys).length})
            </Text>
            {Object.entries(preferences.trustedSigningKeys).map(([keyId, value]) => (
              <View className="flex-row items-center gap-sp-2" key={keyId}>
                <View className="min-w-0 flex-1">
                  <Text className="font-mono text-xs text-foreground dark:text-foreground-dark">
                    {keyId}
                  </Text>
                  <Text
                    className="font-mono text-xs text-muted-foreground dark:text-muted-foreground-dark"
                    numberOfLines={1}
                  >
                    {value}
                  </Text>
                </View>
                <Button
                  onPress={() => {
                    void forgetSigningKey(keyId);
                  }}
                  variant="outline"
                >
                  Remove
                </Button>
              </View>
            ))}
            <Input
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setKeyIdInput}
              placeholder="Key id, e.g. ajiros.publisher"
              value={keyIdInput}
            />
            <Input
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setKeyValueInput}
              placeholder="Base64 Ed25519 public key"
              value={keyValueInput}
            />
            <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
              A package is verified against the exact contents that were
              downloaded, so a signature cannot be reused for a different
              version or a tampered archive.
            </Text>
            <Button
              disabled={!keyIdInput.trim() || !keyValueInput.trim()}
              onPress={() => {
                void trustSigningKey();
              }}
              variant="outline"
            >
              Trust this key
            </Button>
          </DrawerBody>
        </DrawerContent>
      </Drawer>

      {/* Plugin settings (§59): stored as extensions.<pluginId>.<key>, so a
          plugin can never collide with Ajiro's own settings. */}
      <Drawer onOpenChange={setSettingsOpen} open={settingsOpen}>
        <DrawerContent showCloseButton showHandle>
          <DrawerHeader>
            <DrawerTitle>{detailName} settings</DrawerTitle>
            <DrawerDescription>
              Saved for this extension only, as {"extensions."}
              {detailPluginId}.{"<key>"}, and deleted when you uninstall it.
            </DrawerDescription>
          </DrawerHeader>
          <DrawerBody contentContainerClassName="gap-sp-3 pb-sp-4">
            {Object.entries(pluginSettings ?? {}).map(([key, value]) => (
              <View className="gap-1" key={key}>
                <Text className="font-mono text-xs text-muted-foreground dark:text-muted-foreground-dark">
                  extensions.{detailPluginId}.{key}
                </Text>
                {typeof value === "boolean" ? (
                  <View className="flex-row items-center gap-sp-2">
                    <Switch
                      onValueChange={(next) => {
                        if (detailPluginId) {
                          void setPluginSetting(detailPluginId, key, next);
                        }
                      }}
                      value={value}
                    />
                    <Text className="font-sans text-sm text-foreground dark:text-foreground-dark">
                      {value ? "On" : "Off"}
                    </Text>
                  </View>
                ) : (
                  <Input
                    autoCapitalize="none"
                    autoCorrect={false}
                    defaultValue={
                      typeof value === "string" ? value : JSON.stringify(value)
                    }
                    onEndEditing={(event) => {
                      if (!detailPluginId) return;
                      const text = event.nativeEvent.text;
                      if (typeof value === "number") {
                        const parsed = Number(text);
                        if (Number.isFinite(parsed)) {
                          void setPluginSetting(detailPluginId, key, parsed);
                        }
                        return;
                      }
                      void setPluginSetting(detailPluginId, key, text);
                    }}
                  />
                )}
              </View>
            ))}
            <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
              A plugin writes these itself, so they appear once it has run and
              saved something.
            </Text>
          </DrawerBody>
        </DrawerContent>
      </Drawer>

      {/* Diagnostics (§52/§57): the persisted log for one extension. */}
      <Drawer onOpenChange={setDiagnosticsOpen} open={diagnosticsOpen}>
        <DrawerContent showCloseButton showHandle>
          <DrawerHeader>
            <DrawerTitle>{detailName} diagnostics</DrawerTitle>
            <DrawerDescription>
              Plugin console output, refused operations, and initialization
              failures. Kept across restarts, newest first.
            </DrawerDescription>
          </DrawerHeader>
          <DrawerBody contentContainerClassName="gap-sp-2 pb-sp-4">
            {diagnostics.length === 0 ? (
              <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
                Nothing logged yet.
              </Text>
            ) : (
              diagnostics.map((entry, index) => (
                <View className="gap-1" key={`${entry.at}-${index}`}>
                  <Text className="font-mono text-xs text-muted-foreground dark:text-muted-foreground-dark">
                    {entry.at} · {entry.level}
                  </Text>
                  <Text
                    className="font-mono text-xs text-foreground dark:text-foreground-dark"
                    selectable
                  >
                    {entry.message}
                  </Text>
                </View>
              ))
            )}
          </DrawerBody>
          <DrawerFooter>
            <Button
              disabled={diagnostics.length === 0}
              onPress={() => {
                if (detailPluginId) void clearPluginDiagnostics(detailPluginId);
              }}
              variant="outline"
            >
              Clear log
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      {/* Uninstall confirmation (§47): removes the package and its private
          data, never unrelated Ajiro data. */}
      <Drawer
        onOpenChange={(open) => {
          if (!open) setUninstallTarget(null);
        }}
        open={uninstallTarget !== null}
      >
        <DrawerContent showCloseButton showHandle>
          <DrawerHeader>
            <DrawerTitle>Uninstall {uninstallTarget?.name}</DrawerTitle>
            <DrawerDescription>
              The plugin is deactivated, its files are deleted, and its private
              settings, cache, and storage are cleared. This cannot be undone.
            </DrawerDescription>
          </DrawerHeader>
          <DrawerFooter>
            <Button
              leftIcon={<Trash2 color={theme.accentForeground} size={16} />}
              loading={busyKey === `remove:${uninstallTarget?.id}`}
              onPress={confirmUninstall}
            >
              Uninstall
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </>
  );
}






