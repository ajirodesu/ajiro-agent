/**
 * Ace `.snippets` file support (the format Acode snippet plugins ship,
 * e.g. `snippets/javascript.snippets`): comment lines (`# …`), `snippet
 * <trigger>` blocks with verbatim bodies, and `regex`/`guard`/`trigger`/
 * `endTrigger` condition directives. Bodies pass through untouched — the
 * intel engine already expands `${…}`/`$n` placeholders — and conditions
 * are intentionally not evaluated: completion here is prefix-based, so a
 * snippet is offered by trigger regardless of context guards.
 *
 * Pure and node-testable. Unknown stems fall back to the stem itself, so
 * an unmapped language silently matches nothing instead of misfiring.
 */

export type AceSnippet = {
  /** Completion trigger exactly as declared. */
  trigger: string;
  /** Verbatim body (trailing blank lines stripped). */
  body: string;
  /** Nearest preceding `#` comment, or "". */
  description: string;
};

const DIRECTIVE_PATTERN = /^(snippet|regex|guard|trigger|endTrigger)(\s|$)/;
const COMMENT_PATTERN = /^\s*#/;
const SNIPPET_PATTERN = /^snippet(?:\s+(.*))?$/;

function commentText(line: string): string {
  return line.replace(/^\s*#\s?/, "").trim();
}

/**
 * Parse one `.snippets` file. Blocks with an empty trigger or an empty
 * body are skipped; everything else is preserved verbatim.
 */
export function parseAceSnippets(text: string): AceSnippet[] {
  const snippets: AceSnippet[] = [];
  let pendingDescription = "";
  let trigger: string | null = null;
  let body: string[] = [];

  const flush = () => {
    if (trigger !== null) {
      const trimmed = [...body];
      while (
        trimmed.length > 0 &&
        trimmed[trimmed.length - 1].trim() === ""
      ) {
        trimmed.pop();
      }
      if (trimmed.join("\n").trim() !== "") {
        snippets.push({
          trigger,
          body: trimmed.join("\n"),
          description: pendingDescription,
        });
      }
    }
    trigger = null;
    body = [];
  };

  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (COMMENT_PATTERN.test(line)) {
      flush();
      pendingDescription = commentText(line);
      continue;
    }
    const snippetMatch = SNIPPET_PATTERN.exec(line);
    if (snippetMatch) {
      flush();
      const declared = (snippetMatch[1] ?? "").trim();
      trigger = declared === "" ? null : declared;
      // An empty trigger still consumes its body lines (skipped at flush).
      if (trigger === null) {
        pendingDescription = "";
      }
      continue;
    }
    if (DIRECTIVE_PATTERN.test(line)) {
      // `regex`/`guard`/`trigger`/`endTrigger` end the current body and
      // attach to the next snippet; conditions are not evaluated.
      if (trigger === null) {
        continue;
      }
      flush();
      continue;
    }
    if (trigger !== null) {
      body.push(rawLine.replace(/\r$/, ""));
    }
  }
  flush();
  return snippets;
}

/** Alias stems to the intel language ids they complete for. */
const STEM_ALIASES: Record<string, string[]> = {
  bash: ["bash", "shell"],
  c_cpp: ["c", "cpp"],
  js: ["javascript"],
  jsx: ["jsx", "javascript"],
  kt: ["kotlin"],
  md: ["markdown"],
  py: ["python"],
  rb: ["ruby"],
  sh: ["shell", "sh"],
  ts: ["typescript"],
  tsx: ["tsx", "typescript"],
  yml: ["yaml"],
};

/**
 * Intel language ids for a `snippets/<stem>.snippets` file. Always
 * non-empty: unknown stems fall back to the stem itself (matching
 * nothing rather than misfiring).
 */
export function snippetLanguagesForFile(fileName: string): string[] {
  const base = fileName.split("/").pop() ?? fileName;
  const stem = base.replace(/\.snippets$/i, "").toLowerCase();
  if (!stem) return [];
  return STEM_ALIASES[stem] ?? [stem];
}
