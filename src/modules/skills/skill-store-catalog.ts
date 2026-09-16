/**
 * Skill Store catalog (pure, unit-tested).
 *
 * The store browses a CURATED catalog — lobehub's marketplace/registry
 * concept adapted to mobile: a bundled `catalog/skills.json` (real,
 * installable community skills with verified source URLs) that works fully
 * offline for browsing, while install/detail-refresh fetch the live
 * SKILL.md through the existing import pipeline. No mock data: every entry
 * carries a real installable `sourceUrl`.
 *
 * Classification note (prompt §10–11, §40): lobehub's `.agents/skills/*`
 * are virtually all repo-development workflows (trpc-router, i18n,
 * db-migrations, …) and its `packages/builtin-skills` are platform
 * internals (acceptance testing, in-app browser agent, artifacts rendering,
 * self-reference, task system — Ajiro already has native counterparts for
 * the portable ones). None are catalogued as end-user skills.
 */
import catalog from "@/../catalog/skills.json";

export interface StoreSkillEntry {
  slug: string;
  name: string;
  description: string;
  author: string;
  category: string;
  sourceUrl: string;
}

export type StoreInstallState =
  | "not-installed"
  | "installed"
  | "installed-disabled"
  | "update-available";

export interface InstalledSkillRef {
  id: string;
  slug: string;
  title: string;
  enabled: boolean;
  /** Content hash of the installed sourceMarkdown (for update checks). */
  contentHash: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asStoreEntry(value: unknown): StoreSkillEntry | null {
  if (!isRecord(value)) return null;
  const { slug, name, description, author, category, sourceUrl } = value;
  if (
    typeof slug !== "string" ||
    !slug ||
    typeof name !== "string" ||
    !name ||
    typeof description !== "string" ||
    !description ||
    typeof author !== "string" ||
    !author ||
    typeof category !== "string" ||
    !category ||
    typeof sourceUrl !== "string" ||
    !/^https?:\/\//i.test(sourceUrl)
  ) {
    return null;
  }
  return { author, category, description, name, slug, sourceUrl };
}

/** Load + validate the bundled catalog (invalid entries are dropped). */
export function loadStoreCatalog(): StoreSkillEntry[] {
  const raw: unknown = (catalog as { skills?: unknown }).skills;
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const entries: StoreSkillEntry[] = [];
  for (const item of raw) {
    const entry = asStoreEntry(item);
    if (!entry || seen.has(entry.slug)) continue;
    seen.add(entry.slug);
    entries.push(entry);
  }
  return entries.sort((left, right) => left.name.localeCompare(right.name));
}

export function storeCategories(entries: StoreSkillEntry[]): string[] {
  return Array.from(new Set(entries.map((entry) => entry.category))).sort();
}

export function searchStoreCatalog(
  entries: StoreSkillEntry[],
  query: string,
): StoreSkillEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return entries;
  return entries.filter((entry) =>
    [entry.name, entry.description, entry.author, entry.category, entry.slug].some(
      (field) => field.toLowerCase().includes(needle),
    ),
  );
}

export function filterStoreCatalog(
  entries: StoreSkillEntry[],
  filter: { category?: string | null; installedSlugs?: Set<string> | null; installedOnly?: boolean },
): StoreSkillEntry[] {
  return entries.filter((entry) => {
    if (filter.category && entry.category !== filter.category) return false;
    if (filter.installedOnly && !filter.installedSlugs?.has(entry.slug)) return false;
    return true;
  });
}

/** Derive install state by matching catalog slug to installed slugs. */
export function deriveInstallState(
  entry: StoreSkillEntry,
  installed: InstalledSkillRef[],
  updatesAvailable: Set<string> = new Set(),
): StoreInstallState {
  const match = installed.find((skill) => skill.slug === entry.slug);
  if (!match) return "not-installed";
  if (!match.enabled) return "installed-disabled";
  if (updatesAvailable.has(entry.slug)) return "update-available";
  return "installed";
}

/** Human-readable install origin (store vs import vs created). */
export function skillOriginLabel(
  skill: { sourceUrl: string | null },
  catalog: StoreSkillEntry[],
): string {
  if (!skill.sourceUrl) return "Created in Ajiro";
  const entry = catalog.find((item) => item.sourceUrl === skill.sourceUrl);
  if (entry) return `Skill Store · ${entry.author}`;
  try {
    return `Imported · ${new URL(skill.sourceUrl).hostname}`;
  } catch {
    return "Imported";
  }
}

/** FNV-1a hash for update comparison (matches lifecycle hashing style). */
export function hashContent(content: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < content.length; i += 1) {
    hash ^= content.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Check a live SKILL.md against the installed copy: returns true when the
 * upstream content differs (update available). Pure apart from fetch.
 */
export async function checkSkillUpdate(
  installed: InstalledSkillRef,
  fetchMarkdown: (url: string) => Promise<string>,
  sourceUrl: string,
): Promise<boolean> {
  if (!installed.contentHash) return true;
  const live = await fetchMarkdown(sourceUrl);
  return hashContent(live.trim()) !== installed.contentHash;
}
