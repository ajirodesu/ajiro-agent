import { tool } from "ai";
import { z } from "zod";

import { createExternalFolderService } from "@/core/services/external-folder/external-folder-service";
import { createRecord, summarizeValue } from "@/modules/tools/built-in/shared";
import type { ExternalFolderToolFactoryParams } from "@/modules/tools/built-in/external-folder/types";

export function createDeleteEntryTool({
  checkpoints,
  onRecord,
  session,
}: ExternalFolderToolFactoryParams) {
  const service = createExternalFolderService();

  return tool({
    description: "Delete a file or folder inside the granted external folder.",
    inputSchema: z.object({
      path: z.string().trim().min(1),
      recursive: z.boolean().default(false),
    }),
    execute: async ({ path, recursive }) => {
      const inputSummary = summarizeValue({ path, recursive });

      try {
        await checkpoints?.snapshotBeforeWrite(path);
        const output = await service.deleteEntry(session, path, recursive);
        await checkpoints?.commitCheckpoint(`deleteEntry ${path}`);

        onRecord?.(
          createRecord({
            toolName: "deleteEntry",
            status: "completed",
            inputSummary,
            outputSummary: summarizeValue(output),
          }),
        );

        return output;
      } catch (error) {
        onRecord?.(
          createRecord({
            toolName: "deleteEntry",
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
