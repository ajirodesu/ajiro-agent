import { tool } from "ai";
import { z } from "zod";

import { createRecord, summarizeValue } from "@/modules/tools/built-in/shared";
import type { ExternalFolderToolFactoryParams } from "@/modules/tools/built-in/external-folder/types";

/**
 * Undo the latest checkpointed change set for the project (file undo,
 * §68). Restores previous contents (or deletes agent-created files).
 * Dropped for read-only agents via MUTATING_BUILT_IN_TOOL_NAMES.
 */
export function createUndoTool({
  checkpoints,
  onRecord,
}: ExternalFolderToolFactoryParams) {
  return tool({
    description:
      "Undo the most recent checkpointed file change made by the agent in this project. Restores previous file contents.",
    inputSchema: z.object({}),
    execute: async () => {
      const inputSummary = summarizeValue({});

      try {
        if (!checkpoints) {
          throw new Error("Undo is unavailable: no project session attached.");
        }
        const output = await checkpoints.undoLatestCheckpoint();

        onRecord?.(
          createRecord({
            toolName: "undo",
            status: "completed",
            inputSummary,
            outputSummary: summarizeValue(output),
          }),
        );

        return { result: output };
      } catch (error) {
        onRecord?.(
          createRecord({
            toolName: "undo",
            status: "failed",
            inputSummary,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        throw error;
      }
    },
  });
}
