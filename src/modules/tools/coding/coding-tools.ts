/**
 * The coding tool surface: exec (allow-listed in-process checks) + local git.
 * Both operate on the conversation's granted external folder (SAF project
 * root). Registered from agent-run when a folder session is active.
 *
 * Author: AjiroDesu
 */
import { tool } from "ai";
import { z } from "zod";

import { createRecord, summarizeValue } from "@/modules/tools/built-in/shared";
import type { ToolExecutionRecord , ExternalFolderSession } from "@/core/types/app-state";
import { createGitTools } from "@/modules/tools/git/git-tools";
import {
  EXEC_COMMAND_DESCRIPTIONS,
  EXEC_COMMAND_IDS,
  runExecCommand,
} from "@/modules/tools/coding/exec";

export type CodingToolFactoryParams = {
  execEnabled: boolean;
  gitEnabled: boolean;
  onRecord?: (record: ToolExecutionRecord) => void;
  session: ExternalFolderSession;
};

export function createCodingTools(params: CodingToolFactoryParams) {
  const tools: Record<string, unknown> = {};

  if (params.execEnabled) {
    const commandEnum = z.enum(EXEC_COMMAND_IDS as [string, ...string[]]);
    const descriptionList = EXEC_COMMAND_IDS.map(
      (id) => `- ${id}: ${EXEC_COMMAND_DESCRIPTIONS[id]}`,
    ).join("\n");

    tools.exec = tool({
      description: `Run an allow-listed, in-process check against the project (fast, always available). Fixed commands:\n${descriptionList}\nUse path to scope the check to a subfolder (empty = project root). For arbitrary bash (builds, tests, installs), use the shell tool when the Linux runtime is provisioned.`,
      inputSchema: z.object({
        args: z.record(z.string(), z.unknown()).optional(),
        command: commandEnum.describe("One of the fixed allow-listed commands"),
        path: z
          .string()
          .optional()
          .describe("Relative folder to scope the check to (empty = root)"),
      }),
      execute: async ({ args, command, path }) => {
        const inputSummary = summarizeValue({ args, command, path });

        try {
          const output = await runExecCommand(params.session, {
            args: args as Record<string, unknown>,
            command: command as (typeof EXEC_COMMAND_IDS)[number],
            path,
          });
          params.onRecord?.(
            createRecord({
              toolName: "exec",
              status: "completed",
              inputSummary,
              outputSummary: summarizeValue(output.output.slice(0, 200)),
            }),
          );
          return output;
        } catch (error) {
          params.onRecord?.(
            createRecord({
              toolName: "exec",
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

  if (params.gitEnabled) {
    const gitTools = createGitTools({
      onRecord: params.onRecord,
      session: params.session,
    });

    for (const [name, gitTool] of Object.entries(gitTools.tools)) {
      tools[name] = tool({
        description: gitTool.description,
        inputSchema: z.object({
          depth: z.number().int().min(1).max(50).optional(),
          message: z.string().optional(),
          name: z.string().optional(),
          action: z.enum(["create", "list"]).optional(),
          path: z.string().optional(),
        }),
        execute: async (input) => gitTool.execute(input),
      });
    }
  }

  return { tools };
}
