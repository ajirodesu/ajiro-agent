import { tool } from "ai";
import { z } from "zod";

import type { SkillRepository } from "@/core/db/repositories/types";
import type {
  BuiltInToolKey,
  ToolExecutionRecord,
} from "@/core/types/app-state";
import {
  parseSkillMarkdown,
  serializeSkillToMarkdown,
  skillSlugMatches,
  slugifySkillName,
} from "@/modules/skills/skill-markdown";
import { fetchSkillMarkdownFromUrl } from "@/modules/skills/skill-github";
import { fetchSkillFiles } from "@/modules/skills/skill-files";
import { selectRuntimeFor } from "@/modules/runtime/device-runtime";
import { executePrivileged } from "@/modules/runtime/execution-broker";
import { PermissionStore } from "@/modules/permissions/engine";
import { linuxAgentRuntime } from "@/runtime/LinuxAgentRuntime";
import { rootfsManager } from "@/runtime/RootfsManager";
import { createRecord, summarizeValue } from "@/modules/tools/built-in/shared";

const MAX_INSTRUCTIONS_LENGTH = 40_000;
const MAX_DESCRIPTION_LENGTH = 1024;
const MAX_TITLE_LENGTH = 64;
const MAX_KEYWORDS = 20;
const MAX_ALLOWED_TOOLS = 12;

const builtInToolKeysSchema = z
  .array(z.string())
  .max(MAX_ALLOWED_TOOLS)
  .optional();

function normalizeToolKeys(values: string[] | undefined): BuiltInToolKey[] {
  if (!values) {
    return [];
  }

  return Array.from(
    new Set(
      values.filter(
        (key): key is BuiltInToolKey =>
          typeof key === "string" && key.length > 0,
      ),
    ),
  );
}

/** POSIX shell single-quote escaping for staged paths and model args. */
function quoteArg(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function formatSkillForCatalog(skill: {
  autoMatch: boolean;
  description: string | null;
  title: string;
}) {
  return {
    description: skill.description?.trim() || null,
    matchDescription: skill.autoMatch,
    name: skill.title,
  };
}

export function createSkillTools(input: {
  onRecord?: (record: ToolExecutionRecord) => void;
  onSkillsChange?: () => void;
  repository: SkillRepository;
}) {
  const { onRecord, onSkillsChange, repository } = input;

  const findSkillBySlug = async (name: string) => {
    const skills = await repository.list();

    return (
      skills.find((skill) => skillSlugMatches(skill, name)) ??
      skills.find(
        (skill) => skill.title.toLowerCase() === name.toLowerCase(),
      ) ??
      null
    );
  };

  return {
    tools: {
      skill: tool({
        description:
          "Load the full instructions of a skill by its name. Use when the current task matches a skill from the available skills list or the user mentions one. Returns the complete skill instructions and its recommended tools.",
        inputSchema: z.object({
          name: z
            .string()
            .trim()
            .min(1)
            .max(MAX_TITLE_LENGTH)
            .describe("The skill name to load."),
        }),
        execute: async ({ name }) => {
          const skill = await findSkillBySlug(name);

          if (!skill) {
            return {
              found: false,
              message: `No skill named "${name}" exists. Check the available skills list or suggest creating it.`,
            };
          }

          onRecord?.(
            createRecord({
              toolName: "skill",
              status: "completed",
              inputSummary: summarizeValue({ name: skill.title }),
              outputSummary: summarizeValue({
                chars: skill.instructions.length,
                title: skill.title,
              }),
            }),
          );

          return {
            found: true,
            name: skill.title,
            description: skill.description?.trim() ?? null,
            autoMatch: skill.autoMatch,
            matchKeywords: skill.matchKeywords,
            recommendedBuiltInToolKeys: skill.recommendedBuiltInToolKeys,
            recommendedMcpServerIds: skill.recommendedMcpServerIds,
            instructions: skill.instructions,
            files: skill.skillFiles.map((file) => ({
              path: file.path,
              size: file.size,
              mimeType: file.mimeType,
            })),
          };
        },
      }),
      skillReadFile: tool({
        description:
          "Read the contents of a related file that belongs to a skill. Use when a loaded skill references a supporting file (scripts, references, templates, config) listed in its files and you need its full contents to complete the task.",
        inputSchema: z.object({
          name: z
            .string()
            .trim()
            .min(1)
            .max(MAX_TITLE_LENGTH)
            .describe("The skill name that owns the file."),
          path: z
            .string()
            .trim()
            .min(1)
            .describe(
              "The relative path of the file within the skill, e.g. 'references/guide.md' or 'scripts/run.sh'.",
            ),
        }),
        execute: async ({ name, path }) => {
          const skill = await findSkillBySlug(name);

          if (!skill) {
            return {
              found: false,
              message: `No skill named "${name}" exists.`,
            };
          }

          const file = skill.skillFiles.find((item) => item.path === path);

          if (!file) {
            return {
              found: false,
              name: skill.title,
              availableFiles: skill.skillFiles.map((item) => item.path),
              message: `No file "${path}" found in skill "${skill.title}". Use one of the available files or read the skill to list them.`,
            };
          }

          onRecord?.(
            createRecord({
              toolName: "skillReadFile",
              status: "completed",
              inputSummary: summarizeValue({ name: skill.title, path }),
              outputSummary: summarizeValue({
                chars: file.content.length,
                mimeType: file.mimeType,
              }),
            }),
          );

          return {
            found: true,
            name: skill.title,
            path: file.path,
            mimeType: file.mimeType,
            content: file.content,
          };
        },
      }),
      importSkillFromUrl: tool({
        description:
          "Import a skill from a SKILL.md file at a URL. Use when the user gives you a link to a SKILL.md file, such as a github.com blob URL or a raw markdown URL, and asks you to add it as a skill. Downloads the file and installs it; if a skill with the same name already exists it is replaced. Related files (scripts, references, assets) referenced by the SKILL.md are discovered automatically.",
        inputSchema: z.object({
          url: z
            .string()
            .trim()
            .min(1)
            .max(2048)
            .describe("URL to a SKILL.md file."),
          files: z
            .array(z.string().trim().min(1).max(2048))
            .optional()
            .describe(
              "Optional direct URLs to related files (scripts, references, assets) that belong to the skill. Only needed when they cannot be discovered automatically.",
            ),
        }),
        execute: async ({ url, files }) => {
          const { content, displayName } = await fetchSkillMarkdownFromUrl(url);
          const parsed = parseSkillMarkdown(content);
          const title =
            parsed.title ||
            displayName.replace(/\.md$/i, "") ||
            "Imported skill";
          const existing = await findSkillBySlug(title);
          const relatedFiles = await fetchSkillFiles({
            sourceUrl: url,
            referencedPaths: parsed.files,
            extraFiles: files,
          });
          const input = {
            autoMatch: parsed.autoMatch,
            description: parsed.description?.trim() || null,
            skillFiles: relatedFiles.map((file) => ({
              path: file.path,
              content: file.content,
              mimeType: file.mimeType,
              size: file.size,
            })),
            instructions: parsed.instructions.trim(),
            matchKeywords: parsed.matchKeywords,
            recommendedBuiltInToolKeys: parsed.recommendedBuiltInToolKeys,
            recommendedMcpServerIds: parsed.recommendedMcpServerIds,
            sourceMarkdown: content,
            sourceUrl: url,
            title,
          };

          let skill: Awaited<ReturnType<SkillRepository["getById"]>>;

          if (existing) {
            await repository.update(existing.id, input);
            skill = await repository.getById(existing.id);
          } else {
            skill = await repository.create(input);
          }

          onSkillsChange?.();

          onRecord?.(
            createRecord({
              toolName: "importSkillFromUrl",
              status: "completed",
              inputSummary: summarizeValue({ url }),
              outputSummary: summarizeValue({
                name: skill?.title,
                replaced: Boolean(existing),
                files: relatedFiles.length,
              }),
            }),
          );

          return {
            imported: true,
            replaced: Boolean(existing),
            id: skill?.id ?? null,
            name: skill?.title ?? title,
            description: skill?.description ?? null,
            fileCount: relatedFiles.length,
          };
        },
      }),
      skillRunScript: tool({
        description:
          "Run a shell script that belongs to a skill (e.g. 'scripts/setup.sh'). The script must be one of the skill's own registered files. Executes on-device in the Linux userspace via bash; requires approval like any destructive action and fails closed when Linux is not provisioned.",
        inputSchema: z.object({
          name: z
            .string()
            .trim()
            .min(1)
            .max(MAX_TITLE_LENGTH)
            .describe("The skill name that owns the script."),
          path: z
            .string()
            .trim()
            .min(1)
            .describe(
              "The relative script path within the skill, e.g. 'scripts/setup.sh'.",
            ),
          args: z
            .array(z.string().max(500))
            .max(20)
            .optional()
            .describe("Command-line arguments passed to the script."),
          timeoutMs: z
            .number()
            .int()
            .min(1_000)
            .max(300_000)
            .optional()
            .describe("Execution timeout in milliseconds."),
        }),
        execute: async ({ name, path, args, timeoutMs }) => {
          const inputSummary = summarizeValue({ name, path });
          const fail = (
            message: string,
          ): { ok: false; output: null; error: string } => {
            onRecord?.(
              createRecord({
                toolName: "skillRunScript",
                status: "failed",
                inputSummary,
                error: message,
              }),
            );
            return { ok: false as const, output: null, error: message };
          };
          const skill = await findSkillBySlug(name);
          if (!skill) {
            return fail(`No skill named "${name}" exists.`);
          }
          const file = skill.skillFiles.find((item) => item.path === path);
          if (!file) {
            return fail(
              `No file "${path}" found in skill "${skill.title}". Runnable scripts: ${
                skill.skillFiles
                  .map((item) => item.path)
                  .filter((itemPath) => /\.sh$/i.test(itemPath))
                  .join(", ") || "(none)"
              }.`,
            );
          }
          // Mobile-safe subset: shell scripts only, from the skill's own
          // registered files (path allow-list, no traversal possible).
          if (!/\.sh$/i.test(file.path) && !/^[^.]+$/.test(file.path.split("/").pop() ?? "")) {
            return fail(
              `Only shell scripts (.sh) can run on-device. "${file.path}" is not runnable here.`,
            );
          }
          if (!linuxAgentRuntime.isStarted()) {
            const selection = selectRuntimeFor("exec.shell");
            return fail(
              selection.backend === null
                ? selection.limitation
                : "On-device Linux is not provisioned.",
            );
          }
          // Stage into runtime scratch (excluded from project sync) and run
          // from the script's own directory so sibling resources resolve.
          const slug = slugifySkillName(skill.title) || "skill";
          const segments = file.path.split("/");
          const base = segments.pop() as string;
          let stagedDir: string;
          let command: string;
          try {
            const { Directory, File } = await import("expo-file-system");
            const rootfsPath = rootfsManager.getRootfsPath();
            stagedDir = [rootfsPath, "workspace", ".ajiro-skills", slug, ...segments].join("/");
            const dir = new Directory(stagedDir);
            if (!dir.exists) dir.create({ intermediates: true });
            const staged = new File(`${stagedDir}/${base}`);
            if (!staged.exists) staged.create();
            staged.write(file.content);
            command = `cd ${quoteArg(stagedDir)} && bash ${quoteArg(base)}${(args ?? []).map((arg) => ` ${quoteArg(arg)}`).join("")}`;
          } catch (error) {
            return fail(
              `Could not stage the script: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
          const result = await executePrivileged({
            action: {
              id: "skillRunScript",
              actionClass: "destructive",
              description: `Run skill script ${skill.title}:${file.path}`,
              command,
            },
            operation: "exec.shell",
            policy: { defaultDecision: "allow_once", perClass: {} },
            permissions: { store: new PermissionStore() },
            shellInput: { command, timeoutMs },
          });
          onRecord?.(
            createRecord({
              toolName: "skillRunScript",
              status: result.ok ? "completed" : "failed",
              inputSummary,
              outputSummary: result.output ? summarizeValue(result.output.slice(0, 200)) : undefined,
              error: result.error ?? undefined,
            }),
          );
          return { ok: result.ok, output: result.output, error: result.error };
        },
      }),
      manageSkill: tool({
        description:
          "Create, update, delete, or list skills. Skills follow the SKILL.md format: a name, a description that controls when the skill applies, and markdown instructions. Use createSkill when the user asks to add a skill; use updateSkill to modify an existing one; use deleteSkill to remove one; use listSkills to show available skills. Auto-match is enabled by default for created skills so they trigger when the description matches.",
        inputSchema: z
          .object({
            action: z.enum([
              "createSkill",
              "updateSkill",
              "deleteSkill",
              "listSkills",
            ]),
            name: z
              .string()
              .trim()
              .min(1)
              .max(MAX_TITLE_LENGTH)
              .optional()
              .describe("Skill name (kebab-case recommended)."),
            description: z
              .string()
              .trim()
              .min(1)
              .max(MAX_DESCRIPTION_LENGTH)
              .optional()
              .describe("When and why to use this skill."),
            instructions: z
              .string()
              .trim()
              .min(1)
              .max(MAX_INSTRUCTIONS_LENGTH)
              .optional()
              .describe(
                "The markdown instructions the agent follows when this skill applies.",
              ),
            keywords: z
              .array(z.string().trim().min(1).max(40))
              .max(MAX_KEYWORDS)
              .optional()
              .describe("Extra trigger keywords for auto-matching."),
            autoMatch: z
              .boolean()
              .optional()
              .describe(
                "Whether to auto-apply this skill when the description or keywords match the user's request. Defaults to true.",
              ),
            recommendedBuiltInToolKeys: builtInToolKeysSchema
              .optional()
              .describe(
                "Built-in tool keys this skill commonly needs, e.g. workspaceRead, workspaceWrite, workspaceEdit, workspaceCreateFile, workspaceListFiles, workspaceGrep, folderRead, folderWrite.",
              ),
          })
          .refine(
            (value) => value.action === "listSkills" || Boolean(value.name),
            { message: "name is required unless action is listSkills." },
          )
          .refine(
            (value) =>
              value.action !== "createSkill" || Boolean(value.instructions),
            { message: "instructions are required when creating a skill." },
          ),
        execute: async (args) => {
          const inputSummary = summarizeValue(args);

          if (args.action === "listSkills") {
            const skills = await repository.list();
            const catalog = skills
              .filter((skill) => skill.enabled)
              .map((skill) => formatSkillForCatalog(skill));

            onRecord?.(
              createRecord({
                toolName: "manageSkill",
                status: "completed",
                inputSummary,
                outputSummary: summarizeValue({
                  count: catalog.length,
                  skills: catalog,
                }),
              }),
            );

            return {
              count: catalog.length,
              skills: catalog,
            };
          }

          if (args.action === "deleteSkill") {
            const skill = await findSkillBySlug(args.name as string);

            if (!skill) {
              return {
                deleted: false,
                message: `No skill named "${args.name}" exists.`,
              };
            }

            await repository.delete(skill.id);
            onSkillsChange?.();

            onRecord?.(
              createRecord({
                toolName: "manageSkill",
                status: "completed",
                inputSummary,
                outputSummary: summarizeValue({ deleted: skill.title }),
              }),
            );

            return {
              deleted: true,
              name: skill.title,
            };
          }

          const name =
            slugifySkillName(args.name as string) || (args.name as string);

          if (args.action === "createSkill") {
            const existing = await findSkillBySlug(name);

            if (existing) {
              return {
                created: false,
                message: `A skill named "${existing.title}" already exists. Use the updateSkill action to modify it instead of creating a duplicate.`,
              };
            }

            const skill = await repository.create({
              autoMatch: args.autoMatch ?? true,
              description: args.description?.trim() ?? null,
              instructions: (args.instructions as string).trim(),
              matchKeywords: args.keywords ?? [],
              recommendedBuiltInToolKeys: normalizeToolKeys(
                args.recommendedBuiltInToolKeys,
              ),
              title: name,
            });

            onSkillsChange?.();

            onRecord?.(
              createRecord({
                toolName: "manageSkill",
                status: "completed",
                inputSummary,
                outputSummary: summarizeValue({
                  created: skill.title,
                  sourceMarkdown: serializeSkillToMarkdown(skill),
                }),
              }),
            );

            return {
              created: true,
              id: skill.id,
              name: skill.title,
              description: skill.description,
              autoMatch: skill.autoMatch,
              markdown: serializeSkillToMarkdown(skill),
            };
          }

          const skill = await findSkillBySlug(name);

          if (!skill) {
            return {
              updated: false,
              message: `No skill named "${name}" exists. Use the createSkill action to add it first.`,
            };
          }

          const updates: Parameters<SkillRepository["update"]>[1] = {
            autoMatch: args.autoMatch,
            description: args.description?.trim(),
            instructions: args.instructions,
            matchKeywords: args.keywords,
          };

          if (args.recommendedBuiltInToolKeys !== undefined) {
            updates.recommendedBuiltInToolKeys = normalizeToolKeys(
              args.recommendedBuiltInToolKeys,
            );
          }

          if (name !== skill.title) {
            updates.title = name;
          }

          await repository.update(skill.id, updates);

          const next = await repository.getById(skill.id);
          onSkillsChange?.();

          onRecord?.(
            createRecord({
              toolName: "manageSkill",
              status: "completed",
              inputSummary,
              outputSummary: summarizeValue({
                updated: skill.title,
                sourceMarkdown: next ? serializeSkillToMarkdown(next) : null,
              }),
            }),
          );

          return {
            updated: true,
            id: skill.id,
            name: skill.title,
            markdown: next ? serializeSkillToMarkdown(next) : null,
          };
        },
      }),
    },
  };
}
