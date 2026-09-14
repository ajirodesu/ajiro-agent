/**
 * Autonomous agent shell tool — real on-device Linux execution.
 *
 * Unlike `exec` (fixed in-process checks), `shell` runs an arbitrary bash
 * command inside the canonical Debian userspace:
 *
 *   Agent → executePrivileged → LinuxAgentRuntime.runToolCommand
 *   → TerminalBridge.executeHeadless → native PTY → PRoot → Debian bash
 *
 * Fully headless: never touches terminal UI state. Approval is owned by the
 * agent run's approval wrapper (same as every other agent tool), so this
 * tool passes an allow-once policy into the broker — the broker contributes
 * runtime routing + provenance receipts, not a second prompt. When the Linux
 * runtime is not provisioned the broker fails closed with its honest
 * limitation message.
 */
import { tool } from "ai";
import { z } from "zod";

import type { ExternalFolderSession, ToolExecutionRecord } from "@/core/types/app-state";
import { PermissionStore } from "@/modules/permissions/engine";
import { executePrivileged } from "@/modules/runtime/execution-broker";
import { createRecord, summarizeValue } from "@/modules/tools/built-in/shared";

export type ShellToolParams = {
  agentId?: string;
  sessionId?: string;
  projectSession?: ExternalFolderSession;
  onRecord?: (record: ToolExecutionRecord) => void;
};

export function createShellTool(params: ShellToolParams) {
  const shell = tool({
    description:
      "Run a bash command in the on-device Debian Linux userspace (PRoot, /workspace). " +
      "Use for file manipulation, git, builds, tests, package installs, and code generation. " +
      "Requires the Linux runtime to be provisioned; fails closed otherwise.",
    inputSchema: z.object({
      command: z.string().min(1).describe("Bash command to run in /workspace"),
      timeoutMs: z
        .number()
        .int()
        .min(1_000)
        .max(300_000)
        .optional()
        .describe("Execution timeout in milliseconds"),
    }),
    execute: async ({ command, timeoutMs }) => {
      const inputSummary = summarizeValue({ command });
      try {
        const result = await executePrivileged({
          action: {
            id: "shell",
            actionClass: "destructive",
            description: `Linux shell: ${command.slice(0, 120)}`,
            command,
          },
          operation: "exec.shell",
          // The agent run's approval wrapper already authorized this call;
          // the broker contributes routing + provenance here.
          policy: { defaultDecision: "allow_once", perClass: {} },
          permissions: { store: new PermissionStore() },
          agentId: params.agentId,
          sessionId: params.sessionId,
          projectSession: params.projectSession,
          shellInput: { command, timeoutMs },
        });
        params.onRecord?.(
          createRecord({
            toolName: "shell",
            status: result.ok ? "completed" : "failed",
            inputSummary,
            outputSummary: result.output ? summarizeValue(result.output.slice(0, 200)) : undefined,
            error: result.error ?? undefined,
          }),
        );
        return { ok: result.ok, output: result.output, error: result.error };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        params.onRecord?.(
          createRecord({ toolName: "shell", status: "failed", inputSummary, error: message }),
        );
        throw error;
      }
    },
  });
  return { tools: { shell } };
}
