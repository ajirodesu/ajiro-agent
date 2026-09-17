/**
 * File/path + package completion (§23, §21).
 *
 * Inside import strings and path-like contexts, suggest folders, files,
 * tsconfig aliases, and package.json dependencies. Pure over the workspace
 * index + project config — no filesystem access here.
 */
import type { IntelCompletionItem } from "@/modules/intel/types";

export interface PathCompletionIndex {
  /** All project file URIs (posix style). */
  files: string[];
  directories: string[];
  dependencies: string[];
  devDependencies: string[];
  aliasPrefixes: string[];
}

/** True when completion was requested inside a quoted string. */
export function isPathContext(stringPrefix: string, wordPrefix: string): boolean {
  void wordPrefix;
  return stringPrefix.length > 0 || wordPrefix.length === 0;
}

function relativeFrom(fromDir: string, target: string): string | null {
  const from = fromDir.split("/").filter(Boolean);
  const to = target.split("/").filter(Boolean);
  let common = 0;
  while (common < from.length && common < to.length && from[common] === to[common]) {
    common += 1;
  }
  const up = from.length - common;
  const down = to.slice(common);
  if (up === 0 && down.length === 0) return null;
  return `${"../".repeat(up)}${down.join("/")}`;
}

export function completePaths(
  index: PathCompletionIndex,
  documentUri: string,
  rawPrefix: string,
  maxItems = 40,
): IntelCompletionItem[] {
  const prefix = rawPrefix;
  const items: IntelCompletionItem[] = [];
  let priority = 300;
  const push = (label: string, kind: IntelCompletionItem["kind"], insertText: string, detail: string | null): void => {
    items.push({
      label,
      kind,
      detail,
      documentation: null,
      sortPriority: priority,
      filterText: label,
      insertText,
      replaceRange: null,
      commitCharacters: [],
      additionalEdits: [],
      source: label.startsWith("@") || !label.includes("/") ? "package" : "path",
      deprecated: false,
      resolveId: null,
    });
    priority += 1;
  };

  const docDir = documentUri.split("/").slice(0, -1).join("/");

  // Bare specifier: packages + aliases.
  if (!prefix.includes("/")) {
    const needle = prefix.toLowerCase();
    for (const alias of index.aliasPrefixes) {
      if (alias.toLowerCase().startsWith(needle) && items.length < maxItems) {
        push(alias, "folder", alias, "path alias");
      }
    }
    for (const dep of [...index.dependencies, ...index.devDependencies]) {
      if (dep.toLowerCase().startsWith(needle) && items.length < maxItems) {
        push(dep, "module", dep, "package");
      }
    }
    return items;
  }

  // Relative path: list siblings under the resolved directory.
  const base = prefix.endsWith("/") ? prefix : prefix.slice(0, prefix.lastIndexOf("/") + 1);
  const nameNeedle = (prefix.slice(base.length) ?? "").toLowerCase();
  const targetDir = base.startsWith(".")
    ? relativeResolve(docDir, base)
    : base.replace(/\/$/, "");
  for (const directory of index.directories) {
    if (directory !== targetDir && !directory.startsWith(`${targetDir}/`)) continue;
    const rest = directory.slice(targetDir.length + 1);
    if (rest.includes("/")) continue;
    if (!rest.toLowerCase().startsWith(nameNeedle)) continue;
    if (items.length >= maxItems) break;
    push(`${rest}/`, "folder", `${base}${rest}/`, "folder");
  }
  for (const file of index.files) {
    if (file === documentUri) continue;
    const dir = file.split("/").slice(0, -1).join("/");
    if (dir !== targetDir) continue;
    const name = file.split("/").pop() ?? file;
    if (!name.toLowerCase().startsWith(nameNeedle)) continue;
    if (items.length >= maxItems) break;
    const stripped = name.replace(/\.(d\.)?(m|c)?(ts|tsx|js|jsx)$/, "");
    push(stripped, "file", `${base}${stripped}`, file);
  }
  return items;
}

function relativeResolve(fromDir: string, relative: string): string {
  const parts = [...fromDir.split("/").filter(Boolean)];
  for (const segment of relative.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  return parts.join("/");
}

export function aliasPrefixesFor(paths: Record<string, string[]>): string[] {
  return Object.keys(paths)
    .map((pattern) => (pattern.endsWith("/*") ? pattern.slice(0, -1) : pattern))
    .sort();
}

export { relativeFrom };
