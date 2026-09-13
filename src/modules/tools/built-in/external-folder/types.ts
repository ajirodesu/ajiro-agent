import type { ToolExecutionRecord, ExternalFolderSession } from "@/core/types/app-state";

/**
 * Optional undo integration. Matches `createCheckpointService` structurally
 * so tool factories stay import-light (no native/service imports here).
 * When absent, tools behave exactly as before (no snapshots, no undo).
 */
export type CheckpointHook = {
  commitCheckpoint: (label: string) => Promise<unknown>;
  snapshotBeforeWrite: (path: string) => Promise<void>;
  undoLatestCheckpoint: () => Promise<string>;
};

export type ExternalFolderToolFactoryParams = {
  checkpoints?: CheckpointHook;
  onRecord?: (record: ToolExecutionRecord) => void;
  session: ExternalFolderSession;
};
