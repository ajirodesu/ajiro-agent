/**
 * Local git tools for the coding harness.
 *
 * A native git binary is not available on stock Android, so these tools use
 * isomorphic-git running over a persistent local mirror of the SAF-granted
 * project directory (see saf-fs.ts). Remote operations (PRs, issues, review
 * threads) are intentionally NOT here — those belong to the GitHub MCP server;
 * these tools only touch the local working copy.
 *
 * Author: AjiroDesu
 */

import { createRecord, summarizeValue } from "@/modules/tools/built-in/shared";
import type { ToolExecutionRecord , ExternalFolderSession } from "@/core/types/app-state";
import {
  createMirrorFs,
  getMirrorRoot,
  syncProjectToMirror,
} from "@/modules/tools/git/saf-fs";

/**
 * isomorphic-git is loaded lazily (dynamic import) on first git tool call:
 * it pulls Node shims (Buffer, events) that must not run during app startup,
 * and the import cost is wasted on sessions that never use git.
 */
async function loadGit() {
  const bufferModule = await import("buffer");

  if (!(globalThis as Record<string, unknown>).Buffer) {
    (globalThis as unknown as { Buffer: unknown }).Buffer =
      bufferModule.Buffer;
  }

  return import("isomorphic-git");
}

type GitModule = Awaited<ReturnType<typeof loadGit>>;

export type GitToolFactoryParams = {
  onRecord?: (record: ToolExecutionRecord) => void;
  session: ExternalFolderSession;
};

type GitTool = {
  description: string;
  execute: (input: unknown) => Promise<unknown>;
};

async function withRepo<T>(
  session: ExternalFolderSession,
  action: (
    fs: ReturnType<typeof createMirrorFs>,
    dir: string,
    git: GitModule,
  ) => Promise<T>,
): Promise<T> {
  const { root } = await syncProjectToMirror(session);
  const fs = createMirrorFs(root);
  const git = await loadGit();

  try {
    await git.init({ fs, dir: "/" });
  } catch {
    // already a repo
  }

  return action(fs, "/", git);
}

function statusMatrixToSummary(
  matrix: [string, number, number, number][],
) {
  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];

  for (const [file, head, workdir, stage] of matrix) {
    if (head === 0 && workdir === 2 && stage === 0) {
      added.push(file);
    } else if (workdir === 0) {
      deleted.push(file);
    } else if (head !== 0 && workdir === 2) {
      modified.push(file);
    }
  }

  return { added, deleted, modified };
}

export function createGitTools(params: GitToolFactoryParams) {
  const buildTool = (
    description: string,
    execute: (input: unknown) => Promise<unknown>,
    toolName: string,
  ): GitTool => ({
    description,
    async execute(rawInput) {
      const inputSummary = summarizeValue(rawInput);

      try {
        const output = await execute(rawInput);
        params.onRecord?.(
          createRecord({
            toolName,
            status: "completed",
            inputSummary,
            outputSummary: summarizeValue(output),
          }),
        );
        return output;
      } catch (error) {
        params.onRecord?.(
          createRecord({
            toolName,
            status: "failed",
            inputSummary,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        throw error;
      }
    },
  });

  return {
    tools: {
      "git-status": buildTool(
        "Show local git status (added/modified/deleted files) for the project. Syncs the SAF project into the local git mirror first. Read-only.",
        async () => {
          const session = params.session;
          return withRepo(session, async (fs, dir, git) => {
            const matrix = await git.statusMatrix({ fs, dir });
            const summary = statusMatrixToSummary(matrix);

            if (
              summary.added.length === 0 &&
              summary.modified.length === 0 &&
              summary.deleted.length === 0
            ) {
              return "Working tree clean — no local changes.";
            }

            return [
              summary.added.length > 0
                ? `Added:\n${summary.added.map((file) => `  + ${file}`).join("\n")}`
                : null,
              summary.modified.length > 0
                ? `Modified:\n${summary.modified.map((file) => `  M ${file}`).join("\n")}`
                : null,
              summary.deleted.length > 0
                ? `Deleted:\n${summary.deleted.map((file) => `  D ${file}`).join("\n")}`
                : null,
            ]
              .filter(Boolean)
              .join("\n\n");
          });
        },
        "git-status",
      ),
      "git-diff": buildTool(
        "Show a compact line diff of local changes for one file (or all files) against the last commit. Read-only.",
        async (rawInput) => {
          const input = (rawInput ?? {}) as { path?: string };
          const session = params.session;
          return withRepo(session, async (fs, dir, git) => {
            const matrix = await git.statusMatrix({ fs, dir });
            // Deleted files (present in HEAD, absent from workdir) diff
            // as all-removed; without the third clause they vanish.
            const changed = matrix.filter(
              ([file, head, workdir]) =>
                (head === 0 && workdir === 2) ||
                (head !== 0 && workdir === 2) ||
                (head !== 0 && workdir === 0),
            );
            const targets = input.path
              ? changed.filter(([file]) => file === input.path)
              : changed;
            const chunks: string[] = [];

            for (const [file] of targets.slice(0, 10)) {
              let headText = "";

              try {
                const blob = await git.readBlob({ fs, dir, oid: "HEAD", filepath: file });
                headText = new TextDecoder().decode(blob.blob);
              } catch {
                headText = "";
              }

              let workText = "";

              try {
                workText = (await fs.readFile(file, { encoding: "utf8" })) as string;
              } catch {
                workText = "";
              }

              const { computeLineDiff, formatLineDiff } = await import(
                "@/modules/tools/coding/diff"
              );
              chunks.push(
                formatLineDiff(file, computeLineDiff(headText, workText)),
              );
            }

            return chunks.length > 0
              ? chunks.join("\n\n")
              : "No local changes to diff.";
          });
        },
        "git-diff",
      ),
      "git-add": buildTool(
        "Stage one file (path) or all changes (path: '.') for the next commit.",
        async (rawInput) => {
          const input = (rawInput ?? {}) as { path: string };

          if (!input.path) {
            throw new Error("git-add requires path.");
          }

          const session = params.session;
          return withRepo(session, async (fs, dir, git) => {
            if (input.path === "." || input.path === "-A") {
              const matrix = await git.statusMatrix({ fs, dir });

              for (const [file, head, workdir] of matrix) {
                if (workdir === 0 && head !== 0) {
                  await git.remove({ fs, dir, filepath: file });
                } else if (workdir === 2) {
                  // Stage only workdir-changed files (new or modified):
                  // re-adding every unchanged file rewrites the whole
                  // index on large repos for no effect.
                  await git.add({ fs, dir, filepath: file });
                }
              }

              return "Staged all changes.";
            }

            await git.add({ fs, dir, filepath: input.path });
            return `Staged ${input.path}.`;
          });
        },
        "git-add",
      ),
      "git-commit": buildTool(
        "Create a local commit with the staged changes. Requires a message.",
        async (rawInput) => {
          const input = (rawInput ?? {}) as { message: string };

          if (!input.message?.trim()) {
            throw new Error("git-commit requires a message.");
          }

          const session = params.session;
          return withRepo(session, async (fs, dir, git) => {
            const sha = await git.commit({
              fs,
              dir,
              author: { name: "Ajiro Agent", email: "agent@ajiro.local" },
              message: input.message.trim(),
            });

            return `Committed ${sha.slice(0, 10)}: ${input.message.trim()}`;
          });
        },
        "git-commit",
      ),
      "git-branch": buildTool(
        "Create a local branch, or list branches when no name is given.",
        async (rawInput) => {
          const input = (rawInput ?? {}) as {
            action?: "create" | "list";
            name?: string;
          };
          const session = params.session;
          return withRepo(session, async (fs, dir, git) => {
            if (input.action === "create") {
              if (!input.name?.trim()) {
                throw new Error("git-branch create requires a name.");
              }

              await git.branch({ fs, dir, ref: input.name.trim() });
              return `Created branch ${input.name.trim()}.`;
            }

            const branches = await git.listBranches({ fs, dir });
            return `Branches: ${branches.join(", ") || "(none)"}`;
          });
        },
        "git-branch",
      ),
      "git-log": buildTool(
        "Show the local commit history (most recent first, up to depth).",
        async (rawInput) => {
          const input = (rawInput ?? {}) as { depth?: number };
          const session = params.session;
          return withRepo(session, async (fs, dir, git) => {
            const commits = await git.log({
              fs,
              dir,
              depth: Math.min(input.depth ?? 10, 50),
            });

            if (commits.length === 0) {
              return "No commits yet.";
            }

            return commits
              .map(
                (commit) =>
                  `${commit.oid.slice(0, 10)} ${commit.commit.author.name}: ${commit.commit.message.split("\n")[0]}`,
              )
              .join("\n");
          });
        },
        "git-log",
      ),
    },
  };
}

export { getMirrorRoot };
