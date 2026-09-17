/**
 * Repository import — scan an external Git repository of command configs,
 * parse every `.md` interchange file, and compile each into the real command
 * module format before it appears in the dashboard list.
 *
 * Never runs `.md` configs directly: parsing → config → compile → register.
 * Transport here is a file-list abstraction so the on-device service can feed
 * it from isomorphic-git, a zip download, or pasted text without the engine
 * caring which one was used.
 */
import { normalizeCodelessConfig, assertValidCodelessConfig, type NormalizedCodelessConfig } from "./command-config.types";
import { parseCommandMarkdown } from "./command-markdown";
import { compileNormalizedCommandModule } from "./command-compile";

export type RepoFile = { path: string; content: string };

export type ImportedCommand = {
  filePath: string;
  config: NormalizedCodelessConfig;
  moduleSource: string;
};

export type ImportScanResult = {
  imported: ImportedCommand[];
  skipped: { filePath: string; reason: string }[];
};

export function scanRepositoryFiles(files: RepoFile[]): ImportScanResult {
  const imported: ImportedCommand[] = [];
  const skipped: { filePath: string; reason: string }[] = [];
  for (const file of files) {
    if (!file.path.toLowerCase().endsWith(".md")) continue;
    try {
      const config = parseCommandMarkdown(file.content);
      const normalized = normalizeCodelessConfig(config);
      assertValidCodelessConfig(normalized);
      imported.push({
        filePath: file.path,
        config: normalized,
        moduleSource: compileNormalizedCommandModule(normalized),
      });
    } catch (err) {
      skipped.push({
        filePath: file.path,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { imported, skipped };
}

export function isImportableRepoPath(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith(".md") && !lower.includes("/node_modules/");
}
