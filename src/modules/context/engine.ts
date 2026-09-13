/**
 * Context engine (§24): token accounting, relevance selection, truncation,
 * and restoration over assembled context sources. Summarization/compaction
 * primitives already exist (context/summarizer, compaction); this module is
 * the budgeting/selecting layer that decides what fits.
 *
 * Source provenance: [AJIRO ORIGINAL]; budgeting follows publicly observable
 * agent context practices (relevance order, hard truncation, restore points).
 */
export type ContextSource = {
  id: string;
  kind:
    | "conversation"
    | "instructions"
    | "memory"
    | "skill"
    | "plugin"
    | "mcp"
    | "tool"
    | "file"
    | "terminal"
    | "git"
    | "task"
    | "plan"
    | "attachment"
    | "subagent";
  text: string;
  /** Lower runs first when the budget is tight. */
  priority: number;
  /** Never drop even over budget (system instructions, active task). */
  pinned?: boolean;
};

export type AssembledContext = {
  sources: ContextSource[];
  totalTokens: number;
  budgetTokens: number;
  truncated: string[];
};

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Assemble sources within a token budget: pinned first, then by priority.
 * Over-budget unpinned sources are dropped (recorded in `truncated`);
 * oversized single sources are hard-truncated from the end.
 */
export function assembleContext(
  sources: ContextSource[],
  budgetTokens: number,
  maxSourceTokens = 8000,
): AssembledContext {
  const ordered = [...sources].sort((left, right) => {
    if (!!left.pinned !== !!right.pinned) return left.pinned ? -1 : 1;
    return left.priority - right.priority;
  });
  const kept: ContextSource[] = [];
  const truncated: string[] = [];
  let total = 0;
  for (const source of ordered) {
    let text = source.text;
    let tokens = estimateTokens(text);
    if (tokens > maxSourceTokens) {
      text = `${text.slice(0, maxSourceTokens * 4)}\n…[truncated]`;
      tokens = estimateTokens(text);
      truncated.push(source.id);
    }
    if (!source.pinned && total + tokens > budgetTokens) {
      truncated.push(source.id);
      continue;
    }
    total += tokens;
    kept.push(tokens === estimateTokens(source.text) ? source : { ...source, text });
  }
  return { sources: kept, totalTokens: total, budgetTokens, truncated };
}

/** Restoration point: ids of the assembled sources for later re-assembly. */
export function contextRestorePoint(assembled: AssembledContext): string[] {
  return assembled.sources.map((source) => source.id);
}
