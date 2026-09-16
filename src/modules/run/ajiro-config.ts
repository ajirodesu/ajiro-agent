/**
 * `.ajiro` project run configuration — the Replit-`.replit` equivalent.
 *
 * The file lives at the project root and is AUTO-GENERATED (never
 * hand-required): `package.json` scripts are inspected and the run script
 * is picked by priority (`dev` → `start` → `serve` → `preview`). The user
 * can switch the selected script later; re-sync preserves a still-valid
 * selection and only re-picks when scripts vanished or nothing was
 * selected, so the file never goes permanently stale as `package.json`
 * evolves.
 *
 * ```json
 * { "version": 1, "run": { "script": "dev", "command": "npm run dev" } }
 * ```
 */
export const AJIRO_FILE_NAME = ".ajiro";
export const AJIRO_VERSION = 1;

/** Preferred run scripts, highest priority first. */
export const RUN_SCRIPT_PRIORITY: readonly string[] = [
  "dev",
  "start",
  "serve",
  "preview",
];

export interface AjiroRunConfig {
  version: 1;
  run: {
    script: string | null;
    command: string | null;
  };
}

/** Pick the default run script from a `package.json` scripts map. */
export function detectRunScript(
  scripts: Record<string, string>,
): string | null {
  for (const name of RUN_SCRIPT_PRIORITY) {
    if (typeof scripts[name] === "string") return name;
  }
  return null;
}

/** Parse `package.json` text into its scripts map (throws when invalid). */
export function parsePackageScripts(text: string): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("package.json is not valid JSON.");
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    throw new Error("package.json does not contain an object.");
  }
  const scripts = (parsed as { scripts?: unknown }).scripts ?? {};
  if (typeof scripts !== "object" || scripts === null || Array.isArray(scripts)) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [name, command] of Object.entries(scripts)) {
    if (typeof command === "string") result[name] = command;
  }
  return result;
}

/** Build a fresh config from `package.json` text. */
export function generateAjiroConfig(packageJsonText: string): AjiroRunConfig {
  const script = detectRunScript(parsePackageScripts(packageJsonText));
  return {
    version: 1,
    run: {
      script,
      command: script ? `npm run ${script}` : null,
    },
  };
}

/** Parse and validate `.ajiro` text; null when missing or malformed. */
export function parseAjiroConfig(text: string | null): AjiroRunConfig | null {
  if (!text) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const run = (parsed as { run?: unknown }).run;
  if (typeof run !== "object" || run === null) return null;
  const { script, command } = run as { script?: unknown; command?: unknown };
  return {
    version: 1,
    run: {
      script: typeof script === "string" && script ? script : null,
      command: typeof command === "string" && command ? command : null,
    },
  };
}

export function serializeAjiroConfig(config: AjiroRunConfig): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}

export interface AjiroSyncResult {
  config: AjiroRunConfig;
  /** True when the file content must be (re)written. */
  changed: boolean;
  /** User-facing note, or null when nothing worth mentioning happened. */
  notice: string | null;
}

/**
 * Reconcile stored config with current `package.json` scripts:
 * - missing/malformed stored config → regenerate;
 * - stored selection still present → keep verbatim (never clobber);
 * - selection gone (or never chosen) → re-detect, or null when nothing
 *   runnable exists.
 */
export function syncAjiroConfig(
  existingText: string | null,
  packageJsonText: string,
  scripts: Record<string, string>,
): AjiroSyncResult {
  const stored = parseAjiroConfig(existingText);
  if (!stored) {
    const config = generateAjiroConfig(packageJsonText);
    return {
      config,
      changed: true,
      notice: existingText
        ? "The .ajiro file was invalid, so it was regenerated."
        : null,
    };
  }
  if (stored.run.script && typeof scripts[stored.run.script] === "string") {
    return { config: stored, changed: false, notice: null };
  }
  const script = detectRunScript(scripts);
  return {
    config: {
      version: 1,
      run: { script, command: script ? `npm run ${script}` : null },
    },
    changed: true,
    notice:
      stored.run.script != null
        ? `Run script "${stored.run.script}" is gone from package.json — .ajiro was re-synced.`
        : "The .ajiro run script was re-synced with package.json.",
  };
}
