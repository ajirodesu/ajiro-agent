/**
 * Central permission engine: every privileged action is evaluated here.
 *
 * Source provenance:
 * - [OPENCODE] decision vocabulary (allow / ask / deny) and session-scoped
 *   approval ("approve for this session") as publicly observable behavior.
 * - [ANTHROPIC OPEN SOURCE] sandbox-runtime patterns: secure-by-default,
 *   deny-then-allow reads, allow-only writes and network. Android has no
 *   bubblewrap/sandbox-exec for apps, so this engine enforces the same
 *   posture at the action-dispatch layer instead of the OS layer
 *   ([ANDROID-SPECIFIC IMPLEMENTATION]).
 * - [AJIRO ORIGINAL] allow_once / allow_project scopes, the action
 *   classification below, and the adapter over the existing Ajiro
 *   tool-approval setting. Presentation (the approval drawer UI) is
 *   untouched; this engine is the backend behind it.
 */

export type PermissionDecision =
  | "deny"
  | "ask"
  | "allow_once"
  | "allow_session"
  | "allow_project";

export type ActionClass =
  | "read-only"
  | "safe"
  | "network"
  | "package-install"
  | "filesystem-write"
  | "destructive"
  | "privileged";

export type PrivilegedAction = {
  /** Stable id used for session/project allow-listing (e.g. tool name). */
  id: string;
  actionClass: ActionClass;
  /** Short human-readable description shown in approval UI. */
  description: string;
  /** Optional command/check id (never a shell string). */
  command?: string;
  /** Filesystem paths the action touches, when known. */
  paths?: string[];
  /** Network domains the action contacts, when known. */
  domains?: string[];
};

export type PermissionPolicy = {
  defaultDecision: PermissionDecision;
  perClass: Partial<Record<ActionClass, PermissionDecision>>;
};

export const DEFAULT_DENY_POLICY: PermissionPolicy = {
  defaultDecision: "deny",
  perClass: {},
};

/**
 * Adapter over Ajiro's tool-approval setting ("ask" | "auto" | "allowList").
 * "ask"  -> ask for everything except read-only/safe observations.
 * "auto" -> run tools automatically, still denying destructive/privileged
 *           without an explicit rule (secure-by-default floor).
 * "allowList" -> ask-first like "ask" here; the remembered allow-list is
 *           enforced by the agent runtime's approval wrapper.
 */
export function policyFromApprovalMode(
  mode: "ask" | "auto" | "allowList",
): PermissionPolicy {
  if (mode === "allowList") {
    return policyFromApprovalMode("ask");
  }
  if (mode === "auto") {
    return {
      defaultDecision: "allow_once",
      perClass: {
        "read-only": "allow_once",
        safe: "allow_once",
        network: "allow_once",
        "filesystem-write": "allow_once",
        "package-install": "ask",
        destructive: "deny",
        privileged: "deny",
      },
    };
  }
  return {
    defaultDecision: "ask",
    perClass: {
      "read-only": "allow_once",
      safe: "allow_once",
    },
  };
}

/**
 * In-memory grants. Session grants die with the session; project grants are
 * keyed by project scope id and can be persisted by the caller. Deny always
 * wins over a stored grant at evaluation time when the policy says deny.
 */
export class PermissionStore {
  private readonly sessionAllowed = new Set<string>();
  private readonly projectAllowed = new Map<string, Set<string>>();

  allowSession(actionId: string): void {
    this.sessionAllowed.add(actionId);
  }

  allowProject(projectScope: string, actionId: string): void {
    const set = this.projectAllowed.get(projectScope) ?? new Set<string>();
    set.add(actionId);
    this.projectAllowed.set(projectScope, set);
  }

  isSessionAllowed(actionId: string): boolean {
    return this.sessionAllowed.has(actionId);
  }

  isProjectAllowed(projectScope: string, actionId: string): boolean {
    return this.projectAllowed.get(projectScope)?.has(actionId) ?? false;
  }

  clearSession(): void {
    this.sessionAllowed.clear();
  }
}

export type EvaluationContext = {
  projectScope?: string;
  store: PermissionStore;
};

/**
 * Pure evaluation: policy + stored grants -> effective decision.
 * "ask" means the caller must prompt the user (existing approval UI);
 * the prompt result should be recorded via allowSession/allowProject or
 * treated as a one-shot allow/deny by the caller.
 */
export function evaluatePermission(
  policy: PermissionPolicy,
  action: PrivilegedAction,
  context: EvaluationContext,
): PermissionDecision {
  if (
    context.projectScope &&
    context.store.isProjectAllowed(context.projectScope, action.id)
  ) {
    const base = policy.perClass[action.actionClass] ?? policy.defaultDecision;
    // A project grant never overrides an explicit deny rule.
    return base === "deny" ? "deny" : "allow_project";
  }
  if (context.store.isSessionAllowed(action.id)) {
    const base = policy.perClass[action.actionClass] ?? policy.defaultDecision;
    return base === "deny" ? "deny" : "allow_session";
  }
  return policy.perClass[action.actionClass] ?? policy.defaultDecision;
}

/** True when the action may proceed without prompting. */
export function isPreAuthorized(decision: PermissionDecision): boolean {
  return (
    decision === "allow_once" ||
    decision === "allow_session" ||
    decision === "allow_project"
  );
}
