/**
 * Plugin-extensible provider registries (§44).
 *
 * Future Ajiro plugins contribute languages, completion providers,
 * diagnostics providers, code actions, formatters, and snippets WITHOUT
 * touching the editor core. The API is pure data + callbacks — never React
 * components.
 */
import type {
  IntelCapabilities,
  IntelCodeAction,
  IntelCompletionItem,
  IntelCompletionContext,
  IntelDiagnostic,
  IntelPosition,
  IntelRange,
  IntelRequest,
  IntelTextEdit,
} from "@/modules/intel/types";

export interface IntelCompletionProvider {
  readonly id: string;
  readonly languageIds: readonly string[] | "all";
  provide(
    uri: string,
    position: IntelPosition,
    context: IntelCompletionContext,
    request: IntelRequest,
  ): Promise<IntelCompletionItem[]>;
}

export interface IntelDiagnosticsProvider {
  readonly id: string;
  readonly languageIds: readonly string[] | "all";
  provide(uri: string, text: string, request: IntelRequest): Promise<IntelDiagnostic[]>;
}

export interface IntelCodeActionProvider {
  readonly id: string;
  readonly languageIds: readonly string[] | "all";
  provide(
    uri: string,
    range: IntelRange,
    diagnostics: IntelDiagnostic[],
    request: IntelRequest,
  ): Promise<IntelCodeAction[]>;
}

export interface IntelFormatter {
  readonly id: string;
  readonly languageIds: readonly string[] | "all";
  format(uri: string, text: string): Promise<IntelTextEdit[] | null>;
}

export interface IntelLanguageContribution {
  readonly id: string;
  readonly extensions: readonly string[];
  readonly capabilities: IntelCapabilities;
}

function matches(languageIds: readonly string[] | "all", languageId: string): boolean {
  return languageIds === "all" || languageIds.includes(languageId);
}

export interface IntelPluginRegistry {
  registerCompletion(provider: IntelCompletionProvider): () => void;
  registerDiagnostics(provider: IntelDiagnosticsProvider): () => void;
  registerCodeActions(provider: IntelCodeActionProvider): () => void;
  registerFormatter(formatter: IntelFormatter): () => void;
  registerLanguage(contribution: IntelLanguageContribution): () => void;
  completionsFor(languageId: string): IntelCompletionProvider[];
  diagnosticsFor(languageId: string): IntelDiagnosticsProvider[];
  codeActionsFor(languageId: string): IntelCodeActionProvider[];
  formatterFor(languageId: string): IntelFormatter | null;
  languages(): IntelLanguageContribution[];
}

export function createIntelPluginRegistry(): IntelPluginRegistry {
  const completions: IntelCompletionProvider[] = [];
  const diagnosticsProviders: IntelDiagnosticsProvider[] = [];
  const actions: IntelCodeActionProvider[] = [];
  const formatters: IntelFormatter[] = [];
  const languages: IntelLanguageContribution[] = [];

  function unregister<T>(list: T[], entry: T): () => void {
    return () => {
      const index = list.indexOf(entry);
      if (index >= 0) list.splice(index, 1);
    };
  }

  return {
    registerCompletion: (provider) => {
      completions.push(provider);
      return unregister(completions, provider);
    },
    registerDiagnostics: (provider) => {
      diagnosticsProviders.push(provider);
      return unregister(diagnosticsProviders, provider);
    },
    registerCodeActions: (provider) => {
      actions.push(provider);
      return unregister(actions, provider);
    },
    registerFormatter: (formatter) => {
      formatters.push(formatter);
      return unregister(formatters, formatter);
    },
    registerLanguage: (contribution) => {
      languages.push(contribution);
      return unregister(languages, contribution);
    },
    completionsFor: (languageId) => completions.filter((p) => matches(p.languageIds, languageId)),
    diagnosticsFor: (languageId) => diagnosticsProviders.filter((p) => matches(p.languageIds, languageId)),
    codeActionsFor: (languageId) => actions.filter((p) => matches(p.languageIds, languageId)),
    formatterFor: (languageId) => {
      const specific = formatters.find((formatter) => formatter.languageIds !== "all" && formatter.languageIds.includes(languageId));
      return specific ?? formatters.find((formatter) => formatter.languageIds === "all") ?? null;
    },
    languages: () => [...languages],
  };
}
