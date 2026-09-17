/**
 * Intel engine (§3 pipeline): documents → adapters → merged results.
 *
 * The engine owns the request lifecycle (version check → adapter fan-out →
 * merge → stale guard) but never the UI. Hosts (RN editor screen, WebView
 * entry, agent tools) construct it with their adapters and file accessors.
 */
import { createLatestRunner, createRequestManager } from "@/modules/intel/cancellation";
import {
  mergeCompletions,
  type MergeOptions,
} from "@/modules/intel/completion";
import { createDocumentManager, type DocumentManager } from "@/modules/intel/documents";
import { mergeDiagnostics } from "@/modules/intel/diagnostics";
import { createIntelPerf, type IntelPerf } from "@/modules/intel/perf";
import { createIntelPluginRegistry, type IntelPluginRegistry } from "@/modules/intel/plugins";
import type {
  IntelCompletionContext,
  IntelCompletionItem,
  IntelCompletionList,
  IntelDiagnostic,
  IntelPosition,
  IntelRange,
  LanguageServiceAdapter,
} from "@/modules/intel/types";
import { emptyCompletionList } from "@/modules/intel/types";
import type { IntelSettings } from "@/modules/intel/settings";
import { DEFAULT_INTEL_SETTINGS } from "@/modules/intel/settings";

export interface IntelEngineDeps {
  adapters: LanguageServiceAdapter[];
  getText(uri: string): string | null;
  settings?: IntelSettings;
  plugins?: IntelPluginRegistry;
  perf?: IntelPerf;
  documents?: DocumentManager;
}

export interface IntelEngine {
  documents: DocumentManager;
  plugins: IntelPluginRegistry;
  perf: IntelPerf;
  settings: IntelSettings;
  updateSettings(next: IntelSettings): void;
  completion(
    uri: string,
    languageId: string,
    position: IntelPosition,
    context: IntelCompletionContext,
    documentVersion: number,
  ): Promise<IntelCompletionList>;
  diagnostics(uri: string, languageId: string, documentVersion: number): Promise<IntelDiagnostic[]>;
  adapterFor(languageId: string): LanguageServiceAdapter | null;
}

export function createIntelEngine(deps: IntelEngineDeps): IntelEngine {
  const documents = deps.documents ?? createDocumentManager();
  const plugins = deps.plugins ?? createIntelPluginRegistry();
  const perf = deps.perf ?? createIntelPerf();
  let settings = deps.settings ?? { ...DEFAULT_INTEL_SETTINGS };
  const completionRunner = createLatestRunner({
    onSuperseded: () => perf.count("completion-superseded"),
  });
  const diagnosticsRunner = createLatestRunner({
    onSuperseded: () => perf.count("diagnostics-superseded"),
  });

  function adapterFor(languageId: string): LanguageServiceAdapter | null {
    const adapter = deps.adapters.find((candidate) => candidate.languageIds.includes(languageId));
    return adapter ?? null;
  }

  return {
    documents,
    plugins,
    perf,
    get settings() {
      return settings;
    },
    updateSettings(next) {
      settings = { ...next };
    },

    adapterFor,

    async completion(uri, languageId, position, context, documentVersion): Promise<IntelCompletionList> {
      if (!settings.completionEnabled) return emptyCompletionList();
      const adapter = adapterFor(languageId);
      const requestManager = createRequestManager(() => documentVersion);
      const request = requestManager.createRequest(documentVersion);
      const merged = await completionRunner.run(async () => {
        const lists: IntelCompletionItem[][] = [];
        if (adapter && settings.semanticCompletionEnabled) {
          try {
            const semantic = await perf.time("completion.semantic", () =>
              adapter.completion(uri, position, context, request),
            );
            lists.push(semantic.items);
          } catch (error) {
            // Semantic failure degrades to the remaining sources (§50).
            perf.count("completion.semantic-failure");
            void error;
          }
        }
        if (request.isStale(documents.getVersion(uri) || documentVersion)) {
          return emptyCompletionList();
        }
        const pluginLists = await Promise.all(
          plugins.completionsFor(languageId).map((provider) =>
            provider.provide(uri, position, context, request).catch((): IntelCompletionItem[] => []),
          ),
        );
        for (const list of pluginLists) lists.push(list);
        const mergeOptions: MergeOptions = {
          maxItems: settings.maxCompletionItems,
          prefix: context.wordPrefix,
          disabledSources: new Set(
            [
              !settings.snippetCompletionEnabled ? "snippet" : null,
              !settings.emmetCompletionEnabled ? "emmet" : null,
              !settings.aiCompletionEnabled ? "ai" : null,
            ].filter((source): source is "snippet" | "emmet" | "ai" => source !== null),
          ),
        };
        return {
          items: mergeCompletions(lists, mergeOptions),
          incomplete: false,
        };
      });
      return merged ?? emptyCompletionList();
    },

    async diagnostics(uri, languageId, documentVersion): Promise<IntelDiagnostic[]> {
      if (!settings.diagnosticsEnabled) return [];
      const adapter = adapterFor(languageId);
      const requestManager = createRequestManager(() => documentVersion);
      const request = requestManager.createRequest(documentVersion);
      const merged = await diagnosticsRunner.run(async () => {
        const lists: IntelDiagnostic[][] = [];
        if (adapter) {
          try {
            lists.push(await perf.time("diagnostics.adapter", () => adapter.diagnostics(uri, request)));
          } catch (error) {
            perf.count("diagnostics.adapter-failure");
            void error;
          }
        }
        const pluginLists = await Promise.all(
          plugins.diagnosticsFor(languageId).map((provider) =>
            provider.provide(uri, deps.getText(uri) ?? "", request).catch((): IntelDiagnostic[] => []),
          ),
        );
        for (const list of pluginLists) lists.push(list);
        return mergeDiagnostics(lists);
      });
      return merged ?? [];
    },
  };
}

export type { IntelRange };
