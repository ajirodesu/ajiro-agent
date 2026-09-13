/**
 * IDE workspace provider (§§2, 6, 19, 41, 51, 55): the single authoritative
 * active project for Files, Editor, Terminal, Git, Agent, Composer, and
 * project tabs. Builds its own repositories handle from the SQLite context
 * (no coupling to the chat provider); persists the registry + UI state in
 * app_settings (no migration); keeps unsaved buffers in memory per project.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { eq } from "drizzle-orm";
import { useSQLiteContext } from "expo-sqlite";
import { Platform } from "react-native";

import { appSettings } from "@/core/db/schema";
import { createDrizzleDb } from "@/core/db/repositories/shared";
import type { ExternalFolderSession } from "@/core/types/app-state";
import {
  createIdeEventBus,
  type IdeEvent,
  type IdeEventBus,
  type IdeEventListener,
} from "@/modules/ide/events";
import {
  EMPTY_PROJECT_UI_STATE,
  emptyPersistedIdeState,
  getActiveProject,
  getUiState,
  lifecycleForActive,
  markDirty,
  registerProject,
  removeProject,
  sessionForProject,
  setUiState,
  touchProjectOpened,
  type IdeProject,
  type PersistedIdeState,
  type ProjectLifecycle,
  type ProjectUiState,
} from "@/modules/ide/workspace";

const PROJECTS_KEY = "ide_projects_json";
const ACTIVE_KEY = "ide_active_project_id";
const UI_STATES_KEY = "ide_ui_states_json";

export type IdeWorkspaceContextValue = {
  projects: IdeProject[];
  activeProject: IdeProject | null;
  activeSession: ExternalFolderSession | null;
  lifecycle: ProjectLifecycle;
  error: string | null;
  openProject: (input: {
    name: string;
    uri: string;
    displayName: string;
  }) => Promise<IdeProject>;
  activateProject: (projectId: string) => Promise<void>;
  closeActiveProject: () => Promise<void>;
  removeProject: (projectId: string) => Promise<void>;
  getProjectUiState: (projectId: string) => ProjectUiState;
  updateProjectUiState: (
    projectId: string,
    patch: Partial<ProjectUiState>,
  ) => void;
  setPathDirty: (projectId: string, path: string, dirty: boolean) => void;
  getBuffer: (projectId: string, path: string) => string | undefined;
  setBuffer: (projectId: string, path: string, content: string) => void;
  clearBuffer: (projectId: string, path: string) => void;
  clearProjectBuffers: (projectId: string) => void;
  subscribe: (listener: IdeEventListener) => () => void;
  emit: (event: IdeEvent) => void;
  refresh: () => Promise<void>;
};

const IdeWorkspaceContext =
  createContext<IdeWorkspaceContextValue | null>(null);

export function useIdeWorkspace(): IdeWorkspaceContextValue {
  const context = useContext(IdeWorkspaceContext);
  if (!context) {
    throw new Error("useIdeWorkspace must be used within IdeWorkspaceProvider");
  }
  return context;
}

export function IdeWorkspaceProvider({ children }: { children: ReactNode }) {
  const sqliteDb = useSQLiteContext();
  const [persisted, setPersisted] =
    useState<PersistedIdeState>(emptyPersistedIdeState);
  const [lifecycle, setLifecycle] = useState<ProjectLifecycle>("NO_PROJECT");
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const busRef = useRef<IdeEventBus | null>(null);
  if (!busRef.current) busRef.current = createIdeEventBus();
  const buffersRef = useRef(new Map<string, Map<string, string>>());
  const persistedRef = useRef(persisted);
  persistedRef.current = persisted;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const readSetting = useCallback(
    async (key: string): Promise<string | null> => {
      const db = createDrizzleDb(sqliteDb);
      const rows = await db
        .select()
        .from(appSettings)
        .where(eq(appSettings.key, key))
        .limit(1);
      return rows[0]?.value ?? null;
    },
    [sqliteDb],
  );

  const writeSetting = useCallback(
    async (key: string, value: string | null): Promise<void> => {
      const db = createDrizzleDb(sqliteDb);
      if (value === null) {
        await db.delete(appSettings).where(eq(appSettings.key, key));
        return;
      }
      await db.insert(appSettings).values({ key, value }).onConflictDoUpdate({
        target: appSettings.key,
        set: { value },
      });
    },
    [sqliteDb],
  );

  const persist = useCallback(
    (state: PersistedIdeState) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        writeSetting(PROJECTS_KEY, JSON.stringify(state.projects)).catch(
          console.error,
        );
        writeSetting(ACTIVE_KEY, state.activeProjectId ?? "").catch(
          console.error,
        );
        writeSetting(UI_STATES_KEY, JSON.stringify(state.uiStates)).catch(
          console.error,
        );
      }, 400);
    },
    [writeSetting],
  );

  const refresh = useCallback(async () => {
    try {
      const [projectsRaw, activeRaw, uiRaw] = await Promise.all([
        readSetting(PROJECTS_KEY),
        readSetting(ACTIVE_KEY),
        readSetting(UI_STATES_KEY),
      ]);
      const projects = projectsRaw
        ? (JSON.parse(projectsRaw) as IdeProject[])
        : [];
      const activeProjectId = activeRaw || null;
      const uiStates = uiRaw
        ? (JSON.parse(uiRaw) as Record<string, ProjectUiState>)
        : {};
      const next: PersistedIdeState = {
        projects: Array.isArray(projects) ? projects : [],
        activeProjectId,
        uiStates:
          uiStates && typeof uiStates === "object" ? uiStates : {},
      };
      setPersisted(next);
      setLifecycle(lifecycleForActive(next.activeProjectId, next.projects));
      setLoaded(true);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : String(loadError),
      );
      setLoaded(true);
    }
  }, [readSetting]);

  useEffect(() => {
    void refresh();
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [refresh]);

  const emit = useCallback((event: IdeEvent) => {
    busRef.current?.emit(event);
  }, []);

  const subscribe = useCallback((listener: IdeEventListener) => {
    return busRef.current?.subscribe(listener) ?? (() => {});
  }, []);

  const openProject = useCallback(
    async (input: { name: string; uri: string; displayName: string }) => {
      const now = new Date().toISOString();
      setLifecycle("LOADING_PROJECT");
      setError(null);
      try {
        let next = registerProject(persistedRef.current, input, now);
        const project = next.projects.find((entry) => entry.uri === input.uri)!;
        next = touchProjectOpened(next, project.id, now);
        next = { ...next, activeProjectId: project.id };
        setPersisted(next);
        persist(next);
        setLifecycle("PROJECT_READY");
        emit({ type: "PROJECT_OPENED", projectId: project.id });
        emit({ type: "PROJECT_SELECTED", projectId: project.id });
        return project;
      } catch (openError) {
        setLifecycle("PROJECT_ERROR");
        setError(
          openError instanceof Error ? openError.message : String(openError),
        );
        throw openError;
      }
    },
    [emit, persist],
  );

  const activateProject = useCallback(
    async (projectId: string) => {
      const current = persistedRef.current;
      if (current.activeProjectId === projectId) return;
      const project = current.projects.find((entry) => entry.id === projectId);
      if (!project) throw new Error("Project not found.");
      const previous = current.activeProjectId;
      setLifecycle("PROJECT_SWITCHING");
      const next = touchProjectOpened(
        { ...current, activeProjectId: projectId },
        projectId,
        new Date().toISOString(),
      );
      setPersisted(next);
      persist(next);
      setLifecycle("PROJECT_READY");
      emit({ type: "PROJECT_SWITCHED", fromId: previous, toId: projectId });
      emit({ type: "PROJECT_SELECTED", projectId });
    },
    [emit, persist],
  );

  const closeActiveProject = useCallback(async () => {
    const current = persistedRef.current;
    if (!current.activeProjectId) return;
    const closing = current.activeProjectId;
    const next = { ...current, activeProjectId: null };
    setPersisted(next);
    persist(next);
    buffersRef.current.delete(closing);
    setLifecycle("NO_PROJECT");
    emit({ type: "PROJECT_CLOSED", projectId: closing });
  }, [emit, persist]);

  const removeProjectById = useCallback(
    async (projectId: string) => {
      const next = removeProject(persistedRef.current, projectId);
      setPersisted(next);
      persist(next);
      buffersRef.current.delete(projectId);
      setLifecycle(lifecycleForActive(next.activeProjectId, next.projects));
      emit({ type: "PROJECT_CLOSED", projectId });
    },
    [emit, persist],
  );

  const getProjectUiState = useCallback(
    (projectId: string): ProjectUiState => getUiState(persisted, projectId),
    [persisted],
  );

  const updateProjectUiState = useCallback(
    (projectId: string, patch: Partial<ProjectUiState>) => {
      const next = setUiState(persistedRef.current, projectId, patch);
      setPersisted(next);
      persist(next);
    },
    [persist],
  );

  const setPathDirty = useCallback(
    (projectId: string, path: string, dirty: boolean) => {
      const next = markDirty(persistedRef.current, projectId, path, dirty);
      setPersisted(next);
      persist(next);
    },
    [persist],
  );

  const getBuffer = useCallback((projectId: string, path: string) => {
    return buffersRef.current.get(projectId)?.get(path);
  }, []);

  const setBuffer = useCallback(
    (projectId: string, path: string, content: string) => {
      let table = buffersRef.current.get(projectId);
      if (!table) {
        table = new Map();
        buffersRef.current.set(projectId, table);
      }
      table.set(path, content);
    },
    [],
  );

  const clearBuffer = useCallback((projectId: string, path: string) => {
    buffersRef.current.get(projectId)?.delete(path);
  }, []);

  const clearProjectBuffers = useCallback((projectId: string) => {
    buffersRef.current.delete(projectId);
  }, []);

  const activeProject = getActiveProject(persisted);
  const activeSession = useMemo(
    () =>
      activeProject
        ? sessionForProject(
            activeProject,
            Platform.OS === "ios" ? "ios" : "android",
          )
        : null,
    [activeProject],
  );

  const value = useMemo<IdeWorkspaceContextValue>(
    () => ({
      projects: persisted.projects,
      activeProject,
      activeSession,
      lifecycle: loaded ? lifecycle : "NO_PROJECT",
      error,
      openProject,
      activateProject,
      closeActiveProject,
      removeProject: removeProjectById,
      getProjectUiState,
      updateProjectUiState,
      setPathDirty,
      getBuffer,
      setBuffer,
      clearBuffer,
      clearProjectBuffers,
      subscribe,
      emit,
      refresh,
    }),
    [
      persisted,
      activeProject,
      activeSession,
      lifecycle,
      loaded,
      error,
      openProject,
      activateProject,
      closeActiveProject,
      removeProjectById,
      getProjectUiState,
      updateProjectUiState,
      setPathDirty,
      getBuffer,
      setBuffer,
      clearBuffer,
      clearProjectBuffers,
      subscribe,
      emit,
      refresh,
    ],
  );

  return (
    <IdeWorkspaceContext.Provider value={value}>
      {children}
    </IdeWorkspaceContext.Provider>
  );
}

export { EMPTY_PROJECT_UI_STATE };
