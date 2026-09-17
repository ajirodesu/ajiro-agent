/**
 * Coding command registry (§43): editor, navigation, refactoring, AI, and
 * terminal commands with stable ids. Hosts (editor screen, command
 * palette, plugins) bind these ids to real handlers — the registry itself
 * owns metadata + enablement, never UI.
 */
export type IntelCommandGroup = "editor" | "navigation" | "refactoring" | "ai" | "terminal";

export interface IntelCommand {
  id: string;
  title: string;
  group: IntelCommandGroup;
  /** Short hint shown in the palette. */
  hint: string | null;
  /** When false the palette hides the command in the current context. */
  enabled: boolean;
}

export const INTEL_COMMANDS: readonly IntelCommand[] = [
  { id: "editor.format-document", title: "Format Document", group: "editor", hint: "Format the entire file", enabled: true },
  { id: "editor.organize-imports", title: "Organize Imports", group: "editor", hint: "Sort and prune imports", enabled: true },
  { id: "editor.toggle-autocomplete", title: "Toggle Autocomplete", group: "editor", hint: null, enabled: true },
  { id: "editor.toggle-inlay-hints", title: "Toggle Inlay Hints", group: "editor", hint: null, enabled: true },
  { id: "editor.toggle-semantic-highlighting", title: "Toggle Semantic Highlighting", group: "editor", hint: null, enabled: true },
  { id: "editor.fold-all", title: "Fold All", group: "editor", hint: null, enabled: true },
  { id: "editor.unfold-all", title: "Unfold All", group: "editor", hint: null, enabled: true },
  { id: "nav.definition", title: "Go to Definition", group: "navigation", hint: null, enabled: true },
  { id: "nav.declaration", title: "Go to Declaration", group: "navigation", hint: null, enabled: true },
  { id: "nav.type-definition", title: "Go to Type Definition", group: "navigation", hint: null, enabled: true },
  { id: "nav.references", title: "Find References", group: "navigation", hint: null, enabled: true },
  { id: "nav.symbol", title: "Go to Symbol in File", group: "navigation", hint: "Outline search", enabled: true },
  { id: "nav.workspace-symbols", title: "Search Workspace Symbols", group: "navigation", hint: null, enabled: true },
  { id: "nav.back", title: "Navigate Back", group: "navigation", hint: null, enabled: true },
  { id: "nav.forward", title: "Navigate Forward", group: "navigation", hint: null, enabled: true },
  { id: "refactor.rename", title: "Rename Symbol", group: "refactoring", hint: "Scoped, previewed", enabled: true },
  { id: "refactor.quickfix", title: "Quick Fix", group: "refactoring", hint: "First available fix", enabled: true },
  { id: "refactor.action", title: "Code Actions…", group: "refactoring", hint: null, enabled: true },
  { id: "refactor.extract-variable", title: "Extract Variable", group: "refactoring", hint: null, enabled: true },
  { id: "refactor.extract-function", title: "Extract Function", group: "refactoring", hint: null, enabled: true },
  { id: "ai.explain", title: "AI: Explain Selection", group: "ai", hint: null, enabled: true },
  { id: "ai.fix", title: "AI: Fix Error", group: "ai", hint: null, enabled: true },
  { id: "ai.refactor", title: "AI: Refactor Selection", group: "ai", hint: null, enabled: true },
  { id: "ai.tests", title: "AI: Generate Tests", group: "ai", hint: null, enabled: true },
  { id: "ai.docs", title: "AI: Generate Docs", group: "ai", hint: null, enabled: true },
  { id: "terminal.run-file", title: "Run Current File", group: "terminal", hint: null, enabled: true },
  { id: "terminal.run-tests", title: "Run Tests", group: "terminal", hint: null, enabled: true },
  { id: "terminal.build", title: "Build Project", group: "terminal", hint: null, enabled: true },
  { id: "terminal.lint", title: "Lint / Typecheck", group: "terminal", hint: null, enabled: true },
];

export function searchIntelCommands(query: string): IntelCommand[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...INTEL_COMMANDS];
  return INTEL_COMMANDS.filter(
    (command) =>
      command.title.toLowerCase().includes(needle) ||
      command.id.toLowerCase().includes(needle),
  );
}
