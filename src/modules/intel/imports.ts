/**
 * Import intelligence (§21): unused-import detection, missing-import
 * awareness, and organize-imports orchestration.
 *
 * Auto-import *suggestions* come from the TS service completions
 * (entries with `source`); this module adds the project-level pieces that
 * don't need the compiler: finding unused imports syntactically and
 * deciding when organize-imports is offered.
 */
export interface UnusedImport {
  name: string;
  line: number;
  from: string;
}

const IMPORT_LINE = /^\s*import\s+(?:([^;]*?)\s+from\s+)?["']([^"']+)["']/;
const REQUIRE_LINE = /(?:const|let|var)\s+([^=;]+)=\s*require\(\s*["']([^"']+)["']\s*\)/g;

/** Names bound by `import …` / `require(…)` with their module + line. */
export function boundImports(text: string): { name: string; from: string; line: number }[] {
  const out: { name: string; from: string; line: number }[] = [];
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    const match = IMPORT_LINE.exec(line);
    if (match) {
      const clause = (match[1] ?? "").trim();
      const from = match[2] ?? "";
      for (const name of splitImportClause(clause)) {
        out.push({ name, from, line: index + 1 });
      }
    }
    REQUIRE_LINE.lastIndex = 0;
    let required: RegExpExecArray | null;
    while ((required = REQUIRE_LINE.exec(line)) !== null) {
      const from = required[2] ?? "";
      for (const name of splitDestructured(required[1] ?? "")) {
        out.push({ name, from, line: index + 1 });
      }
    }
  });
  return out;
}

function splitImportClause(clause: string): string[] {
  if (!clause) return [];
  const names: string[] = [];
  const defaultMatch = /^([A-Za-z_$][\w$]*)\s*(,|$)/.exec(clause);
  if (defaultMatch) names.push(defaultMatch[1] as string);
  const namespaceMatch = /\*\s*as\s+([A-Za-z_$][\w$]*)/.exec(clause);
  if (namespaceMatch) names.push(namespaceMatch[1] as string);
  const namedMatch = /\{([^}]*)\}/.exec(clause);
  if (namedMatch) {
    for (const part of (namedMatch[1] ?? "").split(",")) {
      const alias = /as\s+([A-Za-z_$][\w$]*)\s*$/.exec(part.trim())?.[1];
      const plain = /^([A-Za-z_$][\w$]*)/.exec(part.trim())?.[1];
      const name = alias ?? plain;
      if (name) names.push(name);
    }
  }
  return [...new Set(names)];
}

function splitDestructured(clause: string): string[] {
  const trimmed = clause.trim();
  if (/^[A-Za-z_$][\w$]*$/.test(trimmed)) return [trimmed];
  const inner = /^\{\s*([^}]*)\s*\}$/.exec(trimmed)?.[1] ?? "";
  return inner
    .split(",")
    .map((part) => /([A-Za-z_$][\w$]*)\s*$/.exec(part.trim())?.[1])
    .filter((name): name is string => Boolean(name));
}

function usedOutsideImports(text: string, name: string, importLines: Set<number>): boolean {
  const lines = text.split("\n");
  const pattern = new RegExp(`\\b${name.replace(/\$/g, "\\$")}\\b`);
  for (let i = 0; i < lines.length; i += 1) {
    if (importLines.has(i + 1)) continue;
    if (pattern.test(lines[i] ?? "")) return true;
  }
  return false;
}

/** Imports whose names never appear outside import statements. */
export function findUnusedImports(text: string): UnusedImport[] {
  const bound = boundImports(text);
  const importLines = new Set(bound.map((entry) => entry.line));
  return bound
    .filter((entry) => !usedOutsideImports(text, entry.name, importLines))
    .map((entry) => ({ name: entry.name, line: entry.line, from: entry.from }));
}

/** True when the file has any import that organize-imports could change. */
export function shouldOfferOrganizeImports(text: string): boolean {
  if (!IMPORT_LINE.test(text) && !text.includes("require(")) return false;
  if (findUnusedImports(text).length > 0) return true;
  // Unsorted specifiers or mixed quote styles are worth organizing.
  const specifiers = text
    .split("\n")
    .map((line) => IMPORT_LINE.exec(line)?.[2])
    .filter((spec): spec is string => Boolean(spec));
  const sorted = [...specifiers].sort();
  return specifiers.some((spec, index) => spec !== sorted[index]);
}
