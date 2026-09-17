/**
 * Snippet system (§22): language, user, project, and plugin snippets with
 * placeholders, tab stops, mirrored placeholders, and choice placeholders.
 * Snippets integrate with normal completion as `snippet`-kind items.
 */
import type { IntelCompletionItem } from "@/modules/intel/types";

export interface IntelSnippet {
  id: string;
  languageIds: readonly string[] | "all";
  prefix: string;
  body: string;
  description: string;
  origin: "builtin" | "user" | "project" | "plugin";
}

export interface SnippetPlaceholder {
  index: number;
  start: number;
  length: number;
  choices: string[] | null;
  defaultText: string;
}

/**
 * Parse `${1}`, `${1:default}`, `${1|a,b|}`, `$1`, `$0` placeholders.
 * Returns placeholder spans against the *expanded* text where tab stops are
 * removed (mirrors expand for navigation).
 */
export function parseSnippetPlaceholders(body: string): {
  expanded: string;
  placeholders: SnippetPlaceholder[];
} {
  // Pre-scan defaults so mirrors (`${1}` / `$1`) expand to the tab's text
  // even when they appear before the definition.
  const defaults = new Map<number, string>();
  const scanPattern = /\$\{(\d+)(?::([^}|]*))?\}|\$\{(\d+)\|([^|]*)\|\}|\$(\d+)/g;
  let scan: RegExpExecArray | null;
  while ((scan = scanPattern.exec(body)) !== null) {
    const index = Number(scan[1] ?? scan[3] ?? scan[5]);
    if (defaults.has(index)) continue;
    if (scan[2] !== undefined) defaults.set(index, scan[2]);
    else if (scan[4] !== undefined) {
      const choices = scan[4] === "" ? [] : scan[4].split(",");
      defaults.set(index, choices[0] ?? "");
    } else if (!defaults.has(index)) {
      defaults.set(index, "");
    }
  }

  const placeholders: SnippetPlaceholder[] = [];
  let expanded = "";
  let i = 0;
  const pushText = (text: string): void => {
    expanded += text;
  };
  while (i < body.length) {
    const char = body[i];
    if (char === "$" && i + 1 < body.length) {
      const next = body[i + 1];
      if (next === "$") {
        pushText("$");
        i += 2;
        continue;
      }
      if (next === "{") {
        const close = body.indexOf("}", i + 2);
        if (close < 0) {
          pushText(char);
          i += 1;
          continue;
        }
        const inside = body.slice(i + 2, close);
        const tabMatch = /^(\d+)(?::([^|]*))?$/.exec(inside);
        const choiceMatch = /^(\d+)\|([^|]*)\|$/.exec(inside);
        if (choiceMatch) {
          const index = Number(choiceMatch[1]);
          const choices = choiceMatch[2] === "" ? [] : choiceMatch[2].split(",");
          const defaultText = choices[0] ?? "";
          placeholders.push({
            index,
            start: expanded.length,
            length: defaultText.length,
            choices,
            defaultText,
          });
          pushText(defaultText);
          i = close + 1;
          continue;
        }
        if (tabMatch) {
          const index = Number(tabMatch[1]);
          if (tabMatch[2] !== undefined) {
            // Definition with a default: a real tab stop.
            const defaultText = tabMatch[2];
            placeholders.push({
              index,
              start: expanded.length,
              length: defaultText.length,
              choices: null,
              defaultText,
            });
            pushText(defaultText);
          } else if (index === 0) {
            // `${0}`: the conventional final stop.
            placeholders.push({
              index,
              start: expanded.length,
              length: 0,
              choices: null,
              defaultText: "",
            });
          } else {
            // Bare `${n}`: a mirror of the tab's text, not a stop.
            pushText(defaults.get(index) ?? "");
          }
          i = close + 1;
          continue;
        }
        pushText(char);
        i += 1;
        continue;
      }
      const digitMatch = /^(\d+)/.exec(body.slice(i + 1));
      if (digitMatch) {
        const index = Number(digitMatch[1]);
        if (index === 0) {
          placeholders.push({
            index,
            start: expanded.length,
            length: 0,
            choices: null,
            defaultText: "",
          });
        } else {
          pushText(defaults.get(index) ?? "");
        }
        i += 1 + digitMatch[1].length;
        continue;
      }
      pushText(char);
      i += 1;
      continue;
    }
    pushText(char);
    i += 1;
  }
  placeholders.sort((a, b) => a.index - b.index || a.start - b.start);
  return { expanded, placeholders };
}

const BUILTIN_SNIPPETS: IntelSnippet[] = [
  {
    id: "builtin:ts-function",
    languageIds: ["typescript", "javascript", "tsx", "jsx"],
    prefix: "function",
    body: "function ${1:name}(${2:args}) {\n\t$0\n}",
    description: "Function declaration",
    origin: "builtin",
  },
  {
    id: "builtin:ts-arrow",
    languageIds: ["typescript", "javascript", "tsx", "jsx"],
    prefix: "arrow",
    body: "const ${1:name} = (${2:args}) => {\n\t$0\n};",
    description: "Arrow function",
    origin: "builtin",
  },
  {
    id: "builtin:ts-interface",
    languageIds: ["typescript", "tsx"],
    prefix: "interface",
    body: "interface ${1:Name} {\n\t${2:prop}: ${3:type};\n}",
    description: "Interface declaration",
    origin: "builtin",
  },
  {
    id: "builtin:ts-for",
    languageIds: ["typescript", "javascript", "tsx", "jsx"],
    prefix: "for",
    body: "for (const ${1:item} of ${2:items}) {\n\t$0\n}",
    description: "For-of loop",
    origin: "builtin",
  },
  {
    id: "builtin:py-def",
    languageIds: ["python"],
    prefix: "def",
    body: "def ${1:name}(${2:args}):\n\t$0",
    description: "Function definition",
    origin: "builtin",
  },
  {
    id: "builtin:py-class",
    languageIds: ["python"],
    prefix: "class",
    body: "class ${1:Name}:\n\tdef __init__(self${2:, args}):\n\t\t$0",
    description: "Class definition",
    origin: "builtin",
  },
  {
    id: "builtin:log",
    languageIds: ["typescript", "javascript", "tsx", "jsx"],
    prefix: "log",
    body: "console.log(${1:value});",
    description: "console.log",
    origin: "builtin",
  },
];

export interface SnippetRegistry {
  register(snippet: IntelSnippet): () => void;
  forLanguage(languageId: string): IntelSnippet[];
  matching(languageId: string, prefix: string): IntelSnippet[];
  toCompletionItem(snippet: IntelSnippet, sortPriority: number): IntelCompletionItem;
}

export function createSnippetRegistry(extra: IntelSnippet[] = []): SnippetRegistry {
  const snippets: IntelSnippet[] = [...BUILTIN_SNIPPETS, ...extra];
  return {
    register(snippet) {
      snippets.push(snippet);
      return () => {
        const index = snippets.indexOf(snippet);
        if (index >= 0) snippets.splice(index, 1);
      };
    },
    forLanguage(languageId) {
      return snippets.filter(
        (snippet) => snippet.languageIds === "all" || snippet.languageIds.includes(languageId),
      );
    },
    matching(languageId, prefix) {
      const needle = prefix.toLowerCase();
      if (!needle) return [];
      return snippets.filter(
        (snippet) =>
          (snippet.languageIds === "all" || snippet.languageIds.includes(languageId)) &&
          snippet.prefix.toLowerCase().startsWith(needle),
      );
    },
    toCompletionItem(snippet, sortPriority) {
      const { expanded } = parseSnippetPlaceholders(snippet.body);
      return {
        label: snippet.prefix,
        kind: "snippet",
        detail: snippet.description,
        documentation: expanded,
        sortPriority,
        filterText: snippet.prefix,
        insertText: expanded,
        replaceRange: null,
        commitCharacters: [],
        additionalEdits: [],
        source: "snippet",
        deprecated: false,
        resolveId: null,
      };
    },
  };
}
