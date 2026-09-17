/**
 * AI error-fixing + AI code-action workflows (§37, §38).
 *
 * Pure orchestration around an injected proposer (the host's agent
 * runtime): collect diagnostic context → propose → diff preview → approve
 * → apply → re-diagnose. The engine never calls a model or the network
 * itself, and never applies without approval.
 */
import type { IntelDiagnostic, IntelRange } from "@/modules/intel/types";
import {
  applyWorkspaceEdit,
  previewWorkspaceEdit,
  type AppliedEdit,
  type EditPreview,
} from "@/modules/intel/workspace-edit";

export interface FixContext {
  uri: string;
  diagnostic: IntelDiagnostic;
  /** Surrounding lines (bounded by the host). */
  contextText: string;
  contextRange: IntelRange;
  relatedImports: string[];
}

export interface ProposedPatch {
  /** Unified-style hunks for the approval UI. */
  preview: EditPreview[];
  edits: { uri: string; range: IntelRange; newText: string }[];
  explanation: string;
}

export interface AiFixProposer {
  propose(context: FixContext): Promise<ProposedPatch | null>;
}

export interface AiFixSession {
  context: FixContext;
  proposal: ProposedPatch | null;
  applied: AppliedEdit[];
}

export function collectFixContext(
  uri: string,
  text: string,
  diagnostic: IntelDiagnostic,
  contextLines = 12,
  relatedImports: string[] = [],
): FixContext {
  const lines = text.split("\n");
  const startLine = Math.max(1, diagnostic.range.start.line - contextLines);
  const endLine = Math.min(lines.length, diagnostic.range.end.line + contextLines);
  return {
    uri,
    diagnostic,
    contextText: lines.slice(startLine - 1, endLine).join("\n"),
    contextRange: {
      start: { line: startLine, column: 1 },
      end: { line: endLine, column: (lines[endLine - 1] ?? "").length + 1 },
    },
    relatedImports,
  };
}

export async function proposeFix(
  proposer: AiFixProposer,
  context: FixContext,
): Promise<AiFixSession> {
  const proposal = await proposer.propose(context);
  return { context, proposal, applied: [] };
}

export function applyProposal(
  files: Map<string, string>,
  session: AiFixSession,
): { applied: AppliedEdit[]; skipped: string[]; overlapUris: string[] } | null {
  if (!session.proposal) return null;
  const result = applyWorkspaceEdit(files, {
    edits: session.proposal.edits,
    summary: session.proposal.explanation,
  });
  session.applied = result.applied;
  return result;
}

export function previewProposal(
  files: Map<string, string>,
  session: AiFixSession,
): EditPreview[] {
  if (!session.proposal) return [];
  return previewWorkspaceEdit(files, {
    edits: session.proposal.edits,
    summary: session.proposal.explanation,
  });
}

export const AI_CODE_ACTION_IDS = [
  "ai.explain-error",
  "ai.fix-error",
  "ai.explain-code",
  "ai.refactor-code",
  "ai.optimize-code",
  "ai.generate-docs",
  "ai.generate-tests",
  "ai.add-missing-imports",
  "ai.improve-types",
] as const;

export type AiCodeActionId = (typeof AI_CODE_ACTION_IDS)[number];

export function aiActionLabel(action: AiCodeActionId): string {
  switch (action) {
    case "ai.explain-error":
      return "Explain this error";
    case "ai.fix-error":
      return "Fix this error";
    case "ai.explain-code":
      return "Explain this code";
    case "ai.refactor-code":
      return "Refactor this code";
    case "ai.optimize-code":
      return "Optimize this code";
    case "ai.generate-docs":
      return "Generate documentation";
    case "ai.generate-tests":
      return "Generate tests";
    case "ai.add-missing-imports":
      return "Add missing imports";
    case "ai.improve-types":
      return "Improve types";
  }
}
