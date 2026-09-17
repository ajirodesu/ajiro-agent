/**
 * Deterministic completion merge engine (§7).
 *
 * Sources arrive labeled; the merge applies fixed source priorities so
 * semantic suggestions always outrank generic text matching, dedupes by
 * (label, kind), caps the list for mobile, and preserves each item's
 * origin for the UI's visual distinction (§39).
 */
import type { IntelCompletionItem, IntelCompletionSource } from "@/modules/intel/types";

export const SOURCE_PRIORITY: Record<IntelCompletionSource, number> = {
  semantic: 0,
  "project-symbol": 100,
  "imported-symbol": 150,
  local: 200,
  "workspace-symbol": 250,
  snippet: 300,
  path: 350,
  package: 360,
  keyword: 400,
  emmet: 450,
  ai: 900,
};

export interface MergeOptions {
  maxItems?: number;
  /** Sources to drop entirely (independent toggles, §39). */
  disabledSources?: ReadonlySet<IntelCompletionSource>;
  prefix?: string;
}

function dedupeKey(item: IntelCompletionItem): string {
  return `${item.kind}::${item.label.toLowerCase()}`;
}

export function mergeCompletions(
  lists: IntelCompletionItem[][],
  options: MergeOptions = {},
): IntelCompletionItem[] {
  const maxItems = options.maxItems ?? 50;
  const disabled = options.disabledSources;
  const prefix = (options.prefix ?? "").toLowerCase();
  const best = new Map<string, IntelCompletionItem>();

  for (const list of lists) {
    for (const item of list) {
      if (disabled?.has(item.source)) continue;
      if (prefix && !item.label.toLowerCase().startsWith(prefix) && !(item.filterText ?? "").toLowerCase().startsWith(prefix)) {
        continue;
      }
      const key = dedupeKey(item);
      const existing = best.get(key);
      if (!existing) {
        best.set(key, item);
        continue;
      }
      // Lower source priority (semantic first) wins; ties keep the lower
      // sortPriority; full ties keep the first-seen item (deterministic).
      const rankOf = (candidate: IntelCompletionItem): number =>
        SOURCE_PRIORITY[candidate.source] * 1_000_000 + candidate.sortPriority;
      if (rankOf(item) < rankOf(existing)) best.set(key, item);
    }
  }

  return [...best.values()]
    .sort((a, b) => {
      const rankA = SOURCE_PRIORITY[a.source] * 1_000_000 + a.sortPriority;
      const rankB = SOURCE_PRIORITY[b.source] * 1_000_000 + b.sortPriority;
      if (rankA !== rankB) return rankA - rankB;
      return a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
    })
    .slice(0, maxItems);
}

/** Group merged items by source for the completion UI's section labels. */
export function groupBySource(
  items: IntelCompletionItem[],
): { source: IntelCompletionSource; items: IntelCompletionItem[] }[] {
  const groups = new Map<IntelCompletionSource, IntelCompletionItem[]>();
  for (const item of items) {
    const group = groups.get(item.source);
    if (group) group.push(item);
    else groups.set(item.source, [item]);
  }
  return [...groups.entries()]
    .sort((a, b) => SOURCE_PRIORITY[a[0]] - SOURCE_PRIORITY[b[0]])
    .map(([source, groupItems]) => ({ source, items: groupItems }));
}
