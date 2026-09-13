/**
 * Execution broker: the single choke point for privileged actions.
 *
 * Pipeline (all on-device):
 *   Tool / Terminal / Caller
 *   -> Permission Engine (evaluate; "ask" is returned, never auto-approved)
 *   -> Execution Broker (this module: provenance + dispatch)
 *   -> Runtime Selector (android_local OR linux; never remote)
 *   -> Android Local handler OR explicit Linux limitation
 *
 * Source provenance: [AJIRO ORIGINAL] broker shape and receipt; [OPENCODE]
 * tool/permission orchestration as publicly observable behavior;
 * [ANTHROPIC OPEN SOURCE] sandbox-runtime dual-isolation thinking adapted to
 * Android (filesystem scoping + domain allow-listing at dispatch time).
 */

import type { ExternalFolderSession } from "@/core/types/app-state";
import {
  evaluatePermission,
  type EvaluationContext,
  type PermissionPolicy,
  type PrivilegedAction,
} from "@/modules/permissions/engine";
import {
  selectRuntimeFor,
  type OperationKind,
  type RuntimeBackend,
} from "@/modules/runtime/device-runtime";
import type { PipelineEvent } from "@/modules/runtime/pipeline";

export type ProvenanceReceipt = {
  actionId: string;
  actionClass: PrivilegedAction["actionClass"];
  agentId: string | null;
  sessionId: string | null;
  runtime: RuntimeBackend | null;
  permission: string;
  startedAt: string;
  finishedAt: string;
  ok: boolean;
};

export type BrokerRequest = {
  action: PrivilegedAction;
  /** Maps the action onto a runtime capability. */
  operation: OperationKind;
  policy: PermissionPolicy;
  permissions: EvaluationContext;
  agentId?: string;
  sessionId?: string;
  /** SAF project session required for fs/git/exec-check operations. */
  projectSession?: ExternalFolderSession;
  /** Extra input for exec.check (command id + args). */
  execInput?: { args?: Record<string, unknown>; commandId: string; path?: string };
  signal?: AbortSignal;
  /** Optional pipeline trace sink (permission/execution stages). */
  onStage?: (event: PipelineEvent) => void;
};

export type BrokerResult = {
  ok: boolean;
  output: string | null;
  error: string | null;
  runtime: RuntimeBackend | null;
  receipt: ProvenanceReceipt;
};

function receipt(
  request: BrokerRequest,
  runtime: RuntimeBackend | null,
  permission: string,
  startedAt: string,
  ok: boolean,
): ProvenanceReceipt {
  return {
    actionId: request.action.id,
    actionClass: request.action.actionClass,
    agentId: request.agentId ?? null,
    sessionId: request.sessionId ?? null,
    runtime,
    permission,
    startedAt,
    finishedAt: new Date().toISOString(),
    ok,
  };
}

function needsProjectSession(operation: OperationKind): boolean {
  return (
    operation === "fs.read" ||
    operation === "fs.write" ||
    operation === "git" ||
    operation === "exec.check"
  );
}

/**
 * Execute one privileged action. Returns (never throws) so callers can turn
 * denials and limitations into model-facing tool results. "ask" is returned
 * as a denial-with-reason here: interactive prompting stays with the caller
 * (existing approval UI), which re-invokes after recording the grant.
 */
export async function executePrivileged(
  request: BrokerRequest,
): Promise<BrokerResult> {
  const startedAt = new Date().toISOString();
  const decision = evaluatePermission(
    request.policy,
    request.action,
    request.permissions,
  );
  request.onStage?.({
    stage: "permission_evaluated",
    at: new Date().toISOString(),
    detail: `${request.action.id}:${decision}`,
  });

  if (decision === "deny") {
    return {
      ok: false,
      output: null,
      error: `Denied by permission policy: ${request.action.description}`,
      runtime: null,
      receipt: receipt(request, null, decision, startedAt, false),
    };
  }

  if (decision === "ask") {
    return {
      ok: false,
      output: null,
      error:
        `Approval required: ${request.action.description}. ` +
        `The action was not executed.`,
      runtime: null,
      receipt: receipt(request, null, decision, startedAt, false),
    };
  }

  const permission = decision;
  const selection = selectRuntimeFor(request.operation);

  if (selection.backend === null) {
    return {
      ok: false,
      output: null,
      error: selection.limitation,
      runtime: null,
      receipt: receipt(request, null, permission, startedAt, false),
    };
  }

  if (needsProjectSession(request.operation) && !request.projectSession) {
    return {
      ok: false,
      output: null,
      error:
        `Operation "${request.operation}" needs an attached project folder. ` +
        `Open a project folder first, then retry.`,
      runtime: selection.backend,
      receipt: receipt(request, selection.backend, permission, startedAt, false),
    };
  }

  if (request.operation === "exec.check") {
    if (!request.execInput) {
      return {
        ok: false,
        output: null,
        error: "exec.check requires a command id.",
        runtime: selection.backend,
        receipt: receipt(request, selection.backend, permission, startedAt, false),
      };
    }
    try {
      // Lazy: exec pulls SAF/native-backed services that only exist on-device.
      const { runExecCommand } = await import("@/modules/tools/coding/exec");
      const result = await runExecCommand(request.projectSession!, {
        args: request.execInput.args,
        command: request.execInput.commandId as never,
        path: request.execInput.path,
      });
      request.onStage?.({
        stage: "executed",
        at: new Date().toISOString(),
        detail: `${request.action.id}:${selection.backend}`,
      });
      return {
        ok: !result.timedOut,
        output: result.output,
        error: result.timedOut ? "Command timed out." : null,
        runtime: selection.backend,
        receipt: receipt(request, selection.backend, permission, startedAt, !result.timedOut),
      };
    } catch (error) {
      return {
        ok: false,
        output: null,
        error: error instanceof Error ? error.message : String(error),
        runtime: selection.backend,
        receipt: receipt(request, selection.backend, permission, startedAt, false),
      };
    }
  }

  if (request.operation === "network.api") {
    // The broker authorizes; the actual fetch stays with the caller so URLs,
    // credentials, and response handling keep their existing code paths.
    request.onStage?.({
      stage: "executed",
      at: new Date().toISOString(),
      detail: `${request.action.id}:${selection.backend}`,
    });
    return {
      ok: true,
      output: "authorized",
      error: null,
      runtime: selection.backend,
      receipt: receipt(request, selection.backend, permission, startedAt, true),
    };
  }

  // fs.read / fs.write / git route through their existing SAF-backed
  // services; the broker contributes permission + provenance. Handler
  // registration for those services lands here as they adopt the broker.
  return {
    ok: false,
    output: null,
    error:
      `Operation "${request.operation}" is permission-cleared but has no ` +
      `broker handler yet. This is an integration gap, not a denial.`,
    runtime: selection.backend,
    receipt: receipt(request, selection.backend, permission, startedAt, false),
  };
}
