/**
 * Staged writes (§99): high-impact actions move proposal -> validation ->
 * user review -> approval -> apply. Pure state machine; the caller performs
 * the apply step only after approval, through the execution broker.
 *
 * Source provenance: staged/approval-gate patterns follow [ANTHROPIC OPEN
 * SOURCE] commerce-agents as publicly observable safety architecture;
 * states and validation here are [AJIRO ORIGINAL].
 */
export type StagedWriteKind =
  | "filesystem-delete"
  | "filesystem-overwrite"
  | "git-force"
  | "git-branch-delete"
  | "git-push"
  | "apk-install"
  | "credential-change"
  | "mcp-privileged";

export type StagedWriteStatus =
  | "proposed"
  | "validated"
  | "awaiting-review"
  | "approved"
  | "applied"
  | "rejected"
  | "failed";

export type StagedWrite = {
  id: string;
  kind: StagedWriteKind;
  summary: string;
  detail: Record<string, unknown>;
  status: StagedWriteStatus;
  validationError: string | null;
  createdAt: string;
  updatedAt: string;
};

let nextStagedSeq = 1;

export function proposeStagedWrite(input: {
  kind: StagedWriteKind;
  summary: string;
  detail?: Record<string, unknown>;
}): StagedWrite {
  const now = new Date().toISOString();
  return {
    id: `staged-${Date.now().toString(36)}-${nextStagedSeq++}`,
    kind: input.kind,
    summary: input.summary,
    detail: input.detail ?? {},
    status: "proposed",
    validationError: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** Shape validation per kind. Returns an error string or null when valid. */
export function validateStagedWrite(write: StagedWrite): string | null {
  const detail = write.detail;
  const needsPaths = [
    "filesystem-delete",
    "filesystem-overwrite",
  ].includes(write.kind);
  if (needsPaths) {
    const paths = (detail as { paths?: unknown }).paths;
    if (!Array.isArray(paths) || paths.length === 0) {
      return "Destructive filesystem actions require a non-empty paths list.";
    }
  }
  if (write.kind === "apk-install" && typeof detail.uri !== "string") {
    return "APK installation requires a package uri.";
  }
  if (write.kind === "git-push" && typeof detail.remote !== "string") {
    return "Push requires a remote name.";
  }
  if (!write.summary.trim()) return "A human-readable summary is required.";
  return null;
}

export function advanceStagedWrite(
  write: StagedWrite,
  next: StagedWriteStatus,
  error?: string,
): StagedWrite {
  const order: StagedWriteStatus[] = [
    "proposed",
    "validated",
    "awaiting-review",
    "approved",
    "applied",
  ];
  const now = new Date().toISOString();
  if (next === "rejected" || next === "failed") {
    if (write.status === "applied") {
      throw new Error("Applied writes cannot be rejected or failed.");
    }
    return {
      ...write,
      status: next,
      validationError: error ?? write.validationError,
      updatedAt: now,
    };
  }
  const currentIndex = order.indexOf(write.status);
  const nextIndex = order.indexOf(next);
  if (currentIndex < 0 || nextIndex !== currentIndex + 1) {
    throw new Error(`Illegal staged-write transition: ${write.status} -> ${next}.`);
  }
  if (next === "validated") {
    const validationError = validateStagedWrite(write);
    if (validationError) {
      return { ...write, status: "failed", validationError, updatedAt: now };
    }
  }
  return { ...write, status: next, updatedAt: now };
}
