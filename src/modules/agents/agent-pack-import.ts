/**
 * Agent pack import — install several AGENT.md files from a pasted list of
 * URLs in one pass, with a per-URL imported/skipped summary.
 *
 * Mobile constraint (same as skills): no ZIP archives — every entry is one
 * direct AGENT.md URL (raw file, GitHub blob, or gist), fetched with the
 * shared markdown fetcher. Native agents are never replaced: a pack entry
 * whose name collides with a built-in is skipped with an explanation.
 */
import { parseAgentMarkdown } from "@/modules/agents/agent-markdown";
import { isNativeAgentId } from "@/modules/agents/registry";

export const MAX_PACK_URLS = 20;

export type PackSkipped = {
  error: string;
  url: string;
};

export type PackSummary = {
  imported: string[];
  skipped: PackSkipped[];
};

export type PackAgentRef = {
  id: string;
  name: string;
};

export type PackImportDeps = {
  fetchMarkdown: (url: string) => Promise<{ content: string }>;
  importMarkdown: (input: {
    markdown: string;
    replaceById?: string | null;
    sourceUrl: string;
  }) => Promise<{ name: string }>;
  /** User agents currently stored (for replace detection). */
  listAgents: () => PackAgentRef[];
};

/** Split pasted text into deduped URLs (one per line), capped at MAX_PACK_URLS. */
export function splitPackUrls(text: string): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const url = line.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
    if (urls.length >= MAX_PACK_URLS) break;
  }
  return urls;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Fetch, validate, and store every URL. Entries are independent: one bad
 * URL never aborts the rest. Returns names in pack order plus skip reasons.
 */
export async function importAgentPackFromUrls(
  urls: string[],
  deps: PackImportDeps,
): Promise<PackSummary> {
  const imported: string[] = [];
  const skipped: PackSkipped[] = [];

  for (const url of urls.slice(0, MAX_PACK_URLS)) {
    try {
      const { content } = await deps.fetchMarkdown(url);
      const parsed = parseAgentMarkdown(content);
      const existing =
        deps
          .listAgents()
          .find(
            (agent) => agent.name.toLowerCase() === parsed.name.toLowerCase(),
          ) ?? null;
      if (existing && isNativeAgentId(existing.id)) {
        skipped.push({
          error: `Built-in agent "${parsed.name}" cannot be replaced.`,
          url,
        });
        continue;
      }
      const stored = await deps.importMarkdown({
        markdown: content,
        replaceById: existing?.id ?? null,
        sourceUrl: url,
      });
      imported.push(stored.name);
    } catch (error) {
      skipped.push({ error: errorMessage(error), url });
    }
  }

  return { imported, skipped };
}
