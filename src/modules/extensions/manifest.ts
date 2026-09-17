/**
 * Acode plugin.json manifest parser + validator.
 *
 * Field set follows the official manifest documentation
 * (https://docs.acode.app/docs/plugin-essentials/manifest) and the current
 * Acode installer behavior (installPlugin.js), including its patch
 * semantics: when the manifest's `main` / `icon` / `readme` files are not
 * present in the package, Acode falls back to `main.js` / `icon.png` /
 * `readme.md`. Unknown fields are preserved so updates round-trip.
 *
 * Source provenance: [OPEN-SOURCE, MIT] Acode manifest docs + installer;
 * validation hardening (path security, ID rules) is [AJIRO ORIGINAL].
 */
import { isRecord } from "./models";

export type AcodePluginManifest = {
  /** Raw manifest with unknown fields preserved. */
  raw: Record<string, unknown>;
  $schema: string | null;
  id: string;
  name: string;
  main: string;
  version: string;
  readme: string | null;
  icon: string | null;
  files: string[];
  minVersionCode: number | null;
  price: number;
  license: string | null;
  keywords: string[];
  changelogs: string | null;
  contributors: { github: string | null; name: string; role: string | null }[];
  repository: string | null;
  author: {
    email: string | null;
    github: string | null;
    name: string;
    url: string | null;
  } | null;
  /** Acode installer extension: list of plugin ids this plugin needs. */
  dependencies: string[];
  /**
   * Ajiro extension: native capabilities the plugin needs (Dynamic Updates
   * prompt §36). Unknown to Acode, preserved like any manifest field, and
   * checked at install time — a missing capability refuses with Requires
   * App Update rather than installing a plugin that cannot run.
   */
  nativeCapabilities: string[];
};

/** Acode falls back to these defaults when manifest files are missing. */
export const ACODE_DEFAULT_MAIN = "main.js";
export const ACODE_DEFAULT_ICON = "icon.png";
export const ACODE_DEFAULT_README = "readme.md";

const MAX_MANIFEST_BYTES = 256 * 1024;

export class ManifestError extends Error {}

function fail(message: string): never {
  throw new ManifestError(message);
}

function optionalString(
  record: Record<string, unknown>,
  key: string,
  maxLength = 2048,
): string | null {
  const value = record[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    fail(`Manifest field "${key}" must be a string.`);
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLength) {
    fail(`Manifest field "${key}" is too long.`);
  }
  return trimmed;
}

function optionalNumber(
  record: Record<string, unknown>,
  key: string,
): number | null {
  const value = record[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(`Manifest field "${key}" must be a number.`);
  }
  return value;
}

function stringList(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    fail(`Manifest field "${key}" must be an array of strings.`);
  }
  return (value as string[]).map((entry) => entry.trim()).filter(Boolean);
}

/**
 * Package-relative asset paths must stay inside the package: no absolute
 * paths, no `..` segments, no backslash tricks, no drive/URL forms.
 * Returns the normalized forward-slash path.
 */
export function normalizePackagePath(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) fail(`${label} must not be empty.`);
  if (trimmed.includes("\\")) fail(`${label} must use forward slashes.`);
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    fail(`${label} must be a package-relative path.`);
  }
  if (trimmed.startsWith("/")) {
    fail(`${label} must not be an absolute path.`);
  }
  const segments = trimmed.split("/");
  for (const segment of segments) {
    if (segment === "..") fail(`${label} must not traverse upward ("..").`);
  }
  const normalized = segments
    .filter((segment) => segment && segment !== ".")
    .join("/");
  if (!normalized) fail(`${label} is not a valid package path.`);
  if (normalized.includes("\0")) fail(`${label} contains an invalid character.`);
  return normalized;
}

/** Acode plugin ids are used as directory names; keep them filesystem-safe. */
export function validatePluginId(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) fail("Manifest field \"id\" must not be empty.");
  if (trimmed.length > 128) fail("Manifest field \"id\" is too long.");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(trimmed)) {
    fail(
      "Manifest field \"id\" must contain only letters, digits, dots, dashes, and underscores.",
    );
  }
  if (trimmed.includes("..")) {
    fail("Manifest field \"id\" must not contain path separators.");
  }
  return trimmed;
}

/** Semver-ish: numeric dot components, optional prerelease/build suffix. */
export function validatePluginVersion(value: string): string {
  const trimmed = value.trim();
  if (!/^\d+(\.\d+){0,3}([-+].+)?$/.test(trimmed)) {
    fail("Manifest field \"version\" must look like a version (e.g. 1.0.0).");
  }
  return trimmed;
}

function parseAuthor(value: unknown) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") {
    const name = value.trim();
    if (!name) return null;
    return { email: null, github: null, name, url: null };
  }
  if (!isRecord(value)) fail("Manifest field \"author\" must be an object.");
  const name = optionalString(value, "name", 120) ?? "";
  return {
    email: optionalString(value, "email", 200),
    github: optionalString(value, "github", 120),
    name,
    url: optionalString(value, "url", 2048),
  };
}

function parseContributors(value: unknown) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    fail("Manifest field \"contributors\" must be an array.");
  }
  return (value as unknown[]).map((entry) => {
    if (!isRecord(entry)) fail("Manifest contributors must be objects.");
    return {
      github: optionalString(entry, "github", 120),
      name: optionalString(entry, "name", 120) ?? "",
      role: optionalString(entry, "role", 120),
    };
  });
}

/**
 * Parse and validate a raw Acode plugin.json. `packageFiles` (entry names
 * inside the package, when known) enables Acode's fallback patching for
 * main/icon/readme. Pass `null` when the package contents are unknown.
 */
export function parsePluginManifest(
  rawText: string,
  packageFiles: string[] | null = null,
): AcodePluginManifest {
  if (rawText.length > MAX_MANIFEST_BYTES) {
    fail("plugin.json is too large.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    fail("plugin.json is not valid JSON.");
  }
  if (!isRecord(parsed)) fail("plugin.json must be a JSON object.");

  const id = validatePluginId(
    optionalString(parsed, "id", 128) ?? fail("Manifest field \"id\" is required."),
  );
  const name = optionalString(parsed, "name", 120);
  if (!name) fail("Manifest field \"name\" is required.");
  const version = validatePluginVersion(
    optionalString(parsed, "version", 32) ??
      fail("Manifest field \"version\" is required."),
  );

  let main = optionalString(parsed, "main", 512);
  let icon = optionalString(parsed, "icon", 512);
  let readme = optionalString(parsed, "readme", 512);

  if (packageFiles) {
    const files = new Set(packageFiles);
    // Real manifests declare asset paths like "./src/main.js" while archive
    // entries never carry the leading "./" — resolve through the stripped
    // form before falling back to Acode's defaults, and keep the resolved
    // path so later reads hit the file that is actually there.
    const resolveAsset = (value: string | null, fallback: string): string => {
      if (value && files.has(value)) return value;
      if (value) {
        const stripped = value.replace(/^\.\//, "");
        if (stripped !== value && files.has(stripped)) return stripped;
      }
      return fallback;
    };
    main = resolveAsset(main, ACODE_DEFAULT_MAIN);
    icon = resolveAsset(icon, ACODE_DEFAULT_ICON);
    readme = resolveAsset(readme, ACODE_DEFAULT_README);
    if (!files.has(main)) {
      fail(`Entry point "${main}" is missing from the plugin package.`);
    }
  }

  const files = stringList(parsed, "files").map((entry) =>
    normalizePackagePath(entry, `Manifest files entry "${entry}"`),
  );

  const minVersionCode = optionalNumber(parsed, "minVersionCode");
  if (minVersionCode !== null && (!Number.isInteger(minVersionCode) || minVersionCode < 0)) {
    fail("Manifest field \"minVersionCode\" must be a non-negative integer.");
  }

  const price = optionalNumber(parsed, "price") ?? 0;
  if (price < 0 || price > 10000) {
    fail("Manifest field \"price\" must be between 0 and 10000 (INR).");
  }

  return {
    $schema: optionalString(parsed, "$schema", 2048),
    author: parseAuthor(parsed.author),
    changelogs: optionalString(parsed, "changelogs", 512),
    contributors: parseContributors(parsed.contributors),
    dependencies: stringList(parsed, "dependencies").map((entry) =>
      validatePluginId(entry),
    ),
    files,
    icon: icon ? normalizePackagePath(icon, "Manifest icon") : null,
    id,
    keywords: stringList(parsed, "keywords").slice(0, 32),
    license: optionalString(parsed, "license", 120),
    main: normalizePackagePath(main ?? ACODE_DEFAULT_MAIN, "Manifest main"),
    minVersionCode,
    name,
    nativeCapabilities: stringList(parsed, "nativeCapabilities").map((entry) => {
      if (!entry || entry.length > 64) {
        fail("Manifest nativeCapabilities must list capability names.");
      }
      return entry;
    }),
    price,
    raw: parsed,
    readme: readme ? normalizePackagePath(readme, "Manifest readme") : null,
    repository: optionalString(parsed, "repository", 2048),
    version,
  };
}

/** Normalize a manifest author into a display label. */
export function authorLabel(
  author: {
    email: string | null;
    github: string | null;
    name: string;
    url: string | null;
  } | null,
): string {
  if (!author) return "Unknown author";
  if (author.name) return author.name;
  if (author.github) return `@${author.github}`;
  return "Unknown author";
}


