/**
 * Coding harness settings. Stored in app_settings via ConfigRepository so the
 * values survive restarts and sync across screens.
 *
 * Author: AjiroDesu
 */
import type { ExternalFolderSession } from "@/core/types/app-state";

export type CodingExecCommandId =
  | "typecheck-js"
  | "lint-js"
  | "grep-count"
  | "file-stats"
  | "git-status";

export type CodingSettings = {
  /** Master switch for the exec tool (in-process allow-listed checks). */
  execEnabled: boolean;
  /** Master switch for local git tools (isomorphic-git over SAF). */
  gitEnabled: boolean;
  /** Auto-run configured checks after edits and feed failures back. */
  verifyEnabled: boolean;
  /** Which allow-listed checks the verify loop runs after edits. */
  verifyCommands: CodingExecCommandId[];
  /** Max verify-loop iterations before surfacing failures to the user. */
  verifyMaxRetries: number;
  /** Default approval mode for coding tools ("ask" | "auto"). */
  approvalMode: "ask" | "auto";
};

export const DEFAULT_CODING_SETTINGS: CodingSettings = {
  execEnabled: true,
  gitEnabled: true,
  verifyEnabled: false,
  verifyCommands: ["typecheck-js"],
  verifyMaxRetries: 3,
  approvalMode: "ask",
};

const SETTINGS_KEY = "coding_settings_v1";

function asBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function asStringArray(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) {
    return fallback;
  }

  return value.filter((item): item is string => typeof item === "string");
}

export function normalizeCodingSettings(
  input: Partial<CodingSettings> | null | undefined,
): CodingSettings {
  const raw = input ?? {};

  return {
    execEnabled: asBoolean(raw.execEnabled, DEFAULT_CODING_SETTINGS.execEnabled),
    gitEnabled: asBoolean(raw.gitEnabled, DEFAULT_CODING_SETTINGS.gitEnabled),
    verifyEnabled: asBoolean(
      raw.verifyEnabled,
      DEFAULT_CODING_SETTINGS.verifyEnabled,
    ),
    verifyCommands: asStringArray(
      raw.verifyCommands,
      DEFAULT_CODING_SETTINGS.verifyCommands,
    ) as CodingExecCommandId[],
    verifyMaxRetries:
      typeof raw.verifyMaxRetries === "number" && raw.verifyMaxRetries >= 1
        ? Math.min(raw.verifyMaxRetries, 10)
        : DEFAULT_CODING_SETTINGS.verifyMaxRetries,
    approvalMode: raw.approvalMode === "auto" ? "auto" : "ask",
  };
}

export function parseCodingSettings(value: string | null | undefined) {
  if (!value) {
    return DEFAULT_CODING_SETTINGS;
  }

  try {
    return normalizeCodingSettings(JSON.parse(value) as Partial<CodingSettings>);
  } catch {
    return DEFAULT_CODING_SETTINGS;
  }
}

export function serializeCodingSettings(settings: CodingSettings) {
  return JSON.stringify(settings);
}

export const CODING_SETTINGS_DB_KEY = SETTINGS_KEY;

/**
 * Per-project settings keyed by the granted folder URI. Lets a user keep an
 * allow-list per project instead of one global list. Stored as JSON under
 * `projectSettingsKey(session)` — extending this shape needs no migration.
 */
export type ProjectCodingSettings = CodingSettings & {
  projectUri: string;
  projectName: string;
  /** Skill ids pinned to this project (project scope). */
  skillIds?: string[];
};

export function normalizeProjectCodingSettings(
  input: Partial<ProjectCodingSettings> | null | undefined,
): ProjectCodingSettings {
  const raw = input ?? {};
  const base = normalizeCodingSettings(raw);
  const skillIds = Array.isArray(raw.skillIds)
    ? Array.from(
        new Set(
          raw.skillIds.filter(
            (id): id is string => typeof id === "string" && id.length > 0,
          ),
        ),
      )
    : [];
  return {
    ...base,
    projectName: typeof raw.projectName === "string" ? raw.projectName : "",
    projectUri: typeof raw.projectUri === "string" ? raw.projectUri : "",
    skillIds,
  };
}

export function parseProjectCodingSettings(
  value: string | null | undefined,
): ProjectCodingSettings | null {
  if (!value) return null;
  try {
    return normalizeProjectCodingSettings(
      JSON.parse(value) as Partial<ProjectCodingSettings>,
    );
  } catch {
    return null;
  }
}

export function serializeProjectCodingSettings(settings: ProjectCodingSettings) {
  return JSON.stringify(settings);
}

export function projectSettingsKey(session: ExternalFolderSession) {
  return `coding_project_${session.uri}`;
}
