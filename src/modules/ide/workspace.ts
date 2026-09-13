/**
 * IDE workspace core (§§2, 6, 19, 41, 51, 55): ONE authoritative active
 * project shared by Composer, Files, Editor, Terminal, Git, and Agent.
 *
 * - Project registry persisted through an injected SettingsStore (backed by
 *   app_settings on device, in-memory in tests) — no migration needed.
 * - Explicit lifecycle: NO_PROJECT / LOADING_PROJECT / PROJECT_READY /
 *   PROJECT_ERROR / PROJECT_SWITCHING, shared by every subsystem.
 * - Per-project UI state (tabs, active path, expanded folders, terminal cwd)
 *   keyed by project id so switching never leaks state between projects.
 * - Unsaved editor buffers live outside React state in a caller-owned map;
 *   the store only tracks their paths (dirty flags) for protection prompts.
 *
 * Source provenance: lifecycle + registry shape [AJIRO ORIGINAL]; tab/tree
 * session-restore discipline follows Persian-Bot's useAdminFileManager
 * [OPEN-SOURCE IMPLEMENTATION, MIT].
 */
import type { ExternalFolderSession } from "@/core/types/app-state";

export type IdeProject = {
  id: string;
  name: string;
  uri: string;
  displayName: string;
  lastOpenedAt: string;
  createdAt: string;
};

export type ProjectLifecycle =
  | "NO_PROJECT"
  | "LOADING_PROJECT"
  | "PROJECT_READY"
  | "PROJECT_ERROR"
  | "PROJECT_SWITCHING";

export type ProjectUiState = {
  tabs: string[];
  activePath: string | null;
  expanded: string[];
  terminalCwd: string;
  dirtyPaths: string[];
};

export const EMPTY_PROJECT_UI_STATE: ProjectUiState = {
  tabs: [],
  activePath: null,
  expanded: [],
  terminalCwd: "",
  dirtyPaths: [],
};

export type PersistedIdeState = {
  projects: IdeProject[];
  activeProjectId: string | null;
  uiStates: Record<string, ProjectUiState>;
};

export type SettingsStore = {
  load: () => Promise<PersistedIdeState | null>;
  save: (state: PersistedIdeState) => Promise<void>;
};

export function emptyPersistedIdeState(): PersistedIdeState {
  return { projects: [], activeProjectId: null, uiStates: {} };
}

let projectSeq = 1;

export function projectIdForUri(uri: string): string {
  let hash = 7;
  for (const char of uri) {
    hash = (hash * 31 + char.charCodeAt(0)) | 0;
  }
  return `project-${Math.abs(hash).toString(36)}-${projectSeq++}`;
}

export function registerProject(
  state: PersistedIdeState,
  input: { name: string; uri: string; displayName: string },
  nowIso: string,
): PersistedIdeState {
  const existing = state.projects.find(
    (project) => project.uri === input.uri,
  );
  if (existing) {
    return {
      ...state,
      projects: state.projects.map((project) =>
        project.id === existing.id
          ? {
              ...project,
              name: input.name || project.name,
              displayName: input.displayName || project.displayName,
              lastOpenedAt: nowIso,
            }
          : project,
      ),
    };
  }
  const project: IdeProject = {
    id: projectIdForUri(input.uri),
    name: input.name,
    uri: input.uri,
    displayName: input.displayName,
    lastOpenedAt: nowIso,
    createdAt: nowIso,
  };
  return {
    ...state,
    projects: [...state.projects, project],
  };
}

export function removeProject(
  state: PersistedIdeState,
  projectId: string,
): PersistedIdeState {
  const uiStates = { ...state.uiStates };
  delete uiStates[projectId];
  return {
    projects: state.projects.filter((project) => project.id !== projectId),
    activeProjectId:
      state.activeProjectId === projectId ? null : state.activeProjectId,
    uiStates,
  };
}

export function touchProjectOpened(
  state: PersistedIdeState,
  projectId: string,
  nowIso: string,
): PersistedIdeState {
  return {
    ...state,
    projects: state.projects.map((project) =>
      project.id === projectId
        ? { ...project, lastOpenedAt: nowIso }
        : project,
    ),
  };
}

export function getActiveProject(
  state: PersistedIdeState,
): IdeProject | null {
  return (
    state.projects.find((project) => project.id === state.activeProjectId) ??
    null
  );
}

export function getUiState(
  state: PersistedIdeState,
  projectId: string,
): ProjectUiState {
  return state.uiStates[projectId] ?? { ...EMPTY_PROJECT_UI_STATE };
}

export function setUiState(
  state: PersistedIdeState,
  projectId: string,
  patch: Partial<ProjectUiState>,
): PersistedIdeState {
  return {
    ...state,
    uiStates: {
      ...state.uiStates,
      [projectId]: { ...getUiState(state, projectId), ...patch },
    },
  };
}

export function markDirty(
  state: PersistedIdeState,
  projectId: string,
  path: string,
  dirty: boolean,
): PersistedIdeState {
  const current = getUiState(state, projectId);
  const dirtyPaths = dirty
    ? current.dirtyPaths.includes(path)
      ? current.dirtyPaths
      : [...current.dirtyPaths, path]
    : current.dirtyPaths.filter((entry) => entry !== path);
  return setUiState(state, projectId, { dirtyPaths });
}

/** Session object the rest of the app (mirror, agent, terminal) consumes. */
export function sessionForProject(
  project: IdeProject,
  platform: ExternalFolderSession["platform"] = "android",
): ExternalFolderSession {
  return {
    uri: project.uri,
    displayName: project.displayName,
    platform,
    sourceType: "external-folder",
    grantedAt: project.createdAt,
  };
}

export function lifecycleForActive(
  activeProjectId: string | null,
  projects: IdeProject[],
): ProjectLifecycle {
  if (!activeProjectId) return "NO_PROJECT";
  return projects.some((project) => project.id === activeProjectId)
    ? "PROJECT_READY"
    : "NO_PROJECT";
}
