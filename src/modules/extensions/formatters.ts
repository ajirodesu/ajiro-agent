/**
 * Formatter registry + selection (Acode `registerFormatter` family).
 *
 * Verified firsthand against Acode's current `src/lib/acode.js` and
 * `registerPrettierFormatter.js` [OPEN-SOURCE, MIT]:
 *
 * - `registerFormatter(id, extensions, format, displayName)`: `extensions`
 *   may be an array (empty/blank entries dropped, empty result means every
 *   language `"*"`) or a single non-empty string; registrations are
 *   unshifted so the newest registers first; the stored record is
 *   `{ id, name: displayName, exts, format }`.
 * - `unregisterFormatter(id)` drops every matching registration AND clears
 *   any per-mode selection pointing at it.
 * - `formatters` reads as `{ id, name: name || id, exts }[]`.
 * - `getFormatterFor(extensions)` returns `[[null, "None"], ...]` for
 *   registrations whose `exts` overlap the query or contain `"*"`.
 * - `format()` runs the *selected* formatter for the active file's mode and
 *   resolves `true`/`false` — it never throws for "no formatter".
 *
 * Two deliberate Ajiro differences (see the compatibility report):
 * 1. Acode's formatter reads the live editor itself (`editorManager`);
 *    here the host supplies `{ text, languageId, path }` and the plugin
 *    function must return the formatted text (string or Promise<string>).
 *    Stock formatter plugins written against `editorManager` are therefore
 *    `partial`, flagged by the `editorManager` static check.
 * 2. Registration replaces a previous registration with the same
 *    `(pluginId, formatterId)` pair instead of stacking duplicates, and only
 *    the owning plugin may unregister its formatter (Acode checks neither).
 *    Silent cross-plugin sabotage is not compatibility.
 */
export type FormatterRegistration = {
  pluginId: string;
  formatterId: string;
  /** Normalized lowercase extensions without dots; `["*"]` means all. */
  extensions: string[];
  displayName: string;
};

/** Acode's extension normalization, verbatim semantics. */
export function normalizeFormatterExtensions(input: unknown): string[] {
  if (Array.isArray(input)) {
    const cleaned = input
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim().toLowerCase().replace(/^\.+/, ""))
      .filter(Boolean);
    return cleaned.length > 0 ? cleaned : ["*"];
  }
  if (typeof input === "string" && input.trim()) {
    return [input.trim().toLowerCase().replace(/^\.+/, "")];
  }
  return ["*"];
}

export type FormatterRegistry = {
  register(registration: FormatterRegistration): void;
  unregister(pluginId: string, formatterId: string): boolean;
  unregisterPlugin(pluginId: string): void;
  list(): { displayName: string; extensions: string[]; formatterId: string; pluginId: string }[];
  get(formatterId: string): FormatterRegistration | null;
  clear(): void;
};

export function createFormatterRegistry(): FormatterRegistry {
  // Newest first, mirroring Acode's `unshift`.
  const registrations: FormatterRegistration[] = [];

  return {
    register(registration) {
      const index = registrations.findIndex(
        (entry) =>
          entry.pluginId === registration.pluginId &&
          entry.formatterId === registration.formatterId,
      );
      const normalized: FormatterRegistration = {
        displayName: registration.displayName,
        extensions: registration.extensions,
        formatterId: registration.formatterId,
        pluginId: registration.pluginId,
      };
      if (index >= 0) registrations[index] = normalized;
      else registrations.unshift(normalized);
    },

    unregister(pluginId, formatterId) {
      const before = registrations.length;
      for (let index = registrations.length - 1; index >= 0; index -= 1) {
        const entry = registrations[index];
        if (entry && entry.pluginId === pluginId && entry.formatterId === formatterId) {
          registrations.splice(index, 1);
        }
      }
      return registrations.length !== before;
    },

    unregisterPlugin(pluginId) {
      for (let index = registrations.length - 1; index >= 0; index -= 1) {
        if (registrations[index]?.pluginId === pluginId) registrations.splice(index, 1);
      }
    },

    list() {
      return registrations.map((entry) => ({
        displayName: entry.displayName,
        extensions: [...entry.extensions],
        formatterId: entry.formatterId,
        pluginId: entry.pluginId,
      }));
    },

    get(formatterId) {
      return registrations.find((entry) => entry.formatterId === formatterId) ?? null;
    },

    clear() {
      registrations.length = 0;
    },
  };
}

/**
 * `getFormatterFor` answer shape, Acode-compatible: a leading "None" option
 * followed by one `[id, name]` pair per matching registration.
 */
export function formatterOptionsFor(
  registrations: { displayName: string; extensions: string[]; formatterId: string }[],
  extensions: string[],
): [string | null, string][] {
  const wanted = new Set(
    extensions
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim().toLowerCase().replace(/^\.+/, ""))
      .filter(Boolean),
  );
  const options: [string | null, string][] = [[null, "None"]];
  for (const registration of registrations) {
    const supports =
      registration.extensions.includes("*") ||
      registration.extensions.some((extension) => wanted.has(extension));
    if (supports) {
      options.push([registration.formatterId, registration.displayName || registration.formatterId]);
    }
  }
  return options;
}

/**
 * Map formatter-declared extensions onto editor language ids via an
 * extension table such as EXTENSION_TO_MODE_KEY. Dotted (".js"), bare
 * ("js"), and wildcard ("*") entries are accepted; "*" maps to every
 * language present in the table.
 */
export function languageIdsForExtensions(
  extensions: readonly string[],
  extensionToLanguage: Readonly<Record<string, string>>,
): string[] {
  if (extensions.some((extension) => extension.trim() === "*")) {
    return [...new Set(Object.values(extensionToLanguage))].sort();
  }
  const languages = new Set<string>();
  for (const extension of extensions) {
    const bare = extension.trim().toLowerCase().replace(/^\.+/, "");
    if (!bare) continue;
    const language =
      extensionToLanguage[`.${bare}`] ?? extensionToLanguage[bare];
    if (language) languages.add(language);
  }
  return [...languages].sort();
}

export type FormatterSelectionStore = {
  loadSelections(): Promise<Record<string, string>>;
  saveSelections(selections: Record<string, string>): Promise<void>;
};

export function createMemoryFormatterSelections(
  initial: Record<string, string> = {},
): FormatterSelectionStore & { selections: Record<string, string> } {
  let selections = { ...initial };
  return {
    get selections() {
      return { ...selections };
    },
    async loadSelections() {
      return { ...selections };
    },
    async saveSelections(next) {
      selections = { ...next };
    },
  };
}

/** Drop selections whose formatter no longer exists. Returns the survivors. */
export function pruneFormatterSelections(
  selections: Record<string, string>,
  knownIds: Set<string>,
): Record<string, string> {
  const pruned: Record<string, string> = {};
  for (const [languageId, formatterId] of Object.entries(selections)) {
    if (knownIds.has(formatterId)) pruned[languageId] = formatterId;
  }
  return pruned;
}

/**
 * Selection store backed by the platform preferences file (`formatters`
 * map). Reads go through the shared preferences reader so the Store UI,
 * the host, and tests always agree; writes replace only the map.
 */
export function createPreferenceFormatterSelections(reader: {
  load(): Promise<{ formatters: Record<string, string> }>;
  save(patch: { formatters: Record<string, string> }): Promise<unknown>;
}): FormatterSelectionStore {
  return {
    async loadSelections() {
      const preferences = await reader.load();
      return { ...preferences.formatters };
    },
    async saveSelections(selections) {
      await reader.save({ formatters: { ...selections } });
    },
  };
}

/**
 * Language id (grammar key, e.g. `typescript`) → file extensions a
 * formatter may declare, derived by inverting the editor's own
 * extension table so the two can never drift apart.
 */
export function extensionsForLanguageId(
  languageId: string,
  extensionToKey: Record<string, string>,
): string[] {
  const wanted = languageId.trim().toLowerCase();
  if (!wanted) return [];
  const extensions = new Set<string>();
  for (const [extension, key] of Object.entries(extensionToKey)) {
    if (key.toLowerCase() === wanted) {
      const cleaned = extension.trim().toLowerCase().replace(/^\.+/, "");
      if (cleaned) extensions.add(cleaned);
    }
  }
  return [...extensions].sort();
}

/** True when a registration can format the given language. */
export function formatterSupportsLanguage(
  registration: { extensions: string[] },
  extensions: string[],
): boolean {
  if (registration.extensions.includes("*")) return true;
  const wanted = new Set(extensions);
  return registration.extensions.some((extension) => wanted.has(extension));
}
