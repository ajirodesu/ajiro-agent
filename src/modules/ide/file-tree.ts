/**
 * Pure file-tree helpers: sorting, flattening expanded trees to rows,
 * query matching, breadcrumbs. The native directory reads live in
 * project-files.ts; everything here is unit-tested.
 */
export type TreeEntry = {
  path: string;
  name: string;
  kind: "directory" | "file";
};

export type TreeRow = TreeEntry & {
  depth: number;
};

export function compareTreeEntries(left: TreeEntry, right: TreeEntry): number {
  if (left.kind !== right.kind) {
    return left.kind === "directory" ? -1 : 1;
  }
  return left.name.localeCompare(right.name, undefined, {
    sensitivity: "base",
    numeric: true,
  });
}

export function sortTreeEntries(entries: TreeEntry[]): TreeEntry[] {
  return [...entries].sort(compareTreeEntries);
}

/**
 * Flattens lazily-loaded children into visible rows. `children` maps
 * directory path -> loaded entries ("" is the root).
 */
export function flattenTree(
  children: Record<string, TreeEntry[]>,
  expanded: ReadonlySet<string>,
): TreeRow[] {
  const rows: TreeRow[] = [];
  const visit = (dirPath: string, depth: number) => {
    const entries = sortTreeEntries(children[dirPath] ?? []);
    for (const entry of entries) {
      rows.push({ ...entry, depth });
      if (entry.kind === "directory" && expanded.has(entry.path)) {
        visit(entry.path, depth + 1);
      }
    }
  };
  visit("", 0);
  return rows;
}

export function matchesTreeQuery(entry: TreeEntry, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    entry.name.toLowerCase().includes(needle) ||
    entry.path.toLowerCase().includes(needle)
  );
}

export function breadcrumbsForPath(path: string): string[] {
  return path.split("/").filter(Boolean);
}

export function parentOfPath(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}
