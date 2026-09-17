/**
 * Refactoring commands (§25): extract variable/constant, extract function,
 * inline variable, convert declaration, organize imports, rename.
 *
 * Validation + preview + apply + undo: `planRefactor` validates the range
 * against the adapter and returns a preview; `applyRefactor` executes a
 * planned edit through the workspace-edit machinery (same undo path as
 * quick fixes and rename).
 */
import type {
  IntelRange,
  IntelTextEdit,
  IntelWorkspaceEdit,
} from "@/modules/intel/types";
import {
  applyWorkspaceEdit,
  previewWorkspaceEdit,
  revertAppliedEdits,
  type AppliedEdit,
  type EditPreview,
} from "@/modules/intel/workspace-edit";

export type RefactorKind =
  | "extract-variable"
  | "extract-constant"
  | "extract-function"
  | "inline-variable"
  | "convert-declaration"
  | "organize-imports";

export interface RefactorPlan {
  kind: RefactorKind;
  edit: IntelWorkspaceEdit;
  preview: EditPreview[];
  /** Cursor target after apply (e.g. the rename slot TS returns). */
  renameLocation: IntelRange | null;
}

export interface RefactorBackend {
  applicableRefactors(
    uri: string,
    range: IntelRange,
  ): { name: string; description: string; actions: { name: string; description: string }[] }[];
  refactorEdits(
    uri: string,
    range: IntelRange,
    refactorName: string,
    actionName: string,
  ): { edits: IntelTextEdit[]; renameLocation: IntelRange | null };
  organizeImports(uri: string): Promise<IntelTextEdit[]>;
}

/** Map a UI-level refactor kind onto TS refactor/action names. */
export function resolveRefactorNames(
  backend: RefactorBackend,
  uri: string,
  range: IntelRange,
  kind: RefactorKind,
): { refactorName: string; actionName: string } | null {
  if (kind === "organize-imports") return null;
  const wanted =
    kind === "extract-variable" || kind === "extract-constant"
      ? /extract.*(constant|variable)/i
      : kind === "extract-function"
        ? /extract.*(function|method)/i
        : kind === "inline-variable"
          ? /inline/i
          : /convert.*(var|let|const)|convert.*declaration/i;
  for (const refactor of backend.applicableRefactors(uri, range)) {
    for (const action of refactor.actions) {
      if (wanted.test(`${refactor.name} ${refactor.description} ${action.name} ${action.description}`)) {
        // TS names the extract actions "Extract to constant in enclosing
        // scope" etc.; prefer the constant variant for both extract kinds,
        // `const` for extract-constant and `let`-style is unavailable, so
        // extract-variable maps to the same action and the caller renames.
        return { refactorName: refactor.name, actionName: action.name };
      }
    }
  }
  return null;
}

export function planRefactor(
  backend: RefactorBackend,
  files: Map<string, string>,
  uri: string,
  range: IntelRange,
  kind: RefactorKind,
): RefactorPlan | null {
  if (kind === "organize-imports") return null;
  const resolved = resolveRefactorNames(backend, uri, range, kind);
  if (!resolved) return null;
  const { edits, renameLocation } = backend.refactorEdits(uri, range, resolved.refactorName, resolved.actionName);
  if (edits.length === 0) return null;
  const edit: IntelWorkspaceEdit = {
    edits,
    summary: `${kind}: ${edits.length} edit${edits.length === 1 ? "" : "s"}`,
  };
  return { kind, edit, preview: previewWorkspaceEdit(files, edit), renameLocation };
}

export function applyRefactor(
  files: Map<string, string>,
  plan: RefactorPlan,
): { applied: AppliedEdit[]; skipped: string[]; overlapUris: string[] } {
  return applyWorkspaceEdit(files, plan.edit);
}

export function undoRefactor(files: Map<string, string>, applied: AppliedEdit[]): void {
  revertAppliedEdits(files, applied);
}
