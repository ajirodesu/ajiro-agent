/**
 * Strict AGENT.md frontmatter validation.
 *
 * Mirrors `skill-validation.ts`: `parseAgentMarkdown` stays the lenient
 * reader for already-stored agents, while this module is the gate for NEW
 * editor saves and pack imports, with typed errors so UI can explain
 * exactly what to fix.
 *
 * One deliberate difference from skills: an agent `description` is optional
 * (native agents always carry one, but the reader permits null), so the
 * metadata gate only validates its shape when present. The editor-draft
 * validator keeps it optional too — an empty description simply falls back
 * to null — while the system prompt is always required.
 */
import { parse as parseYaml } from "yaml";

import { normalizeAgentSlug } from "@/modules/agents/agent-markdown";

export const AGENT_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const MAX_AGENT_NAME_LENGTH = 80;
export const MAX_AGENT_DESCRIPTION_LENGTH = 1024;
export const MAX_AGENT_PROMPT_LENGTH = 40_000;
export const AGENT_MODES = ["all", "primary", "subagent"] as const;
export type AgentDraftMode = (typeof AGENT_MODES)[number];

const UNSAFE_SCALAR_PATTERN = /[\r\n]/;

export type AgentMetadataError =
  | { type: "required" }
  | { type: "mapping" }
  | { type: "syntax" }
  | { type: "nameRequired" }
  | { type: "nameInvalid" }
  | { expectedName: string; type: "nameLocked" }
  | { type: "descriptionInvalid" };

export function isValidAgentName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= MAX_AGENT_NAME_LENGTH &&
    AGENT_NAME_PATTERN.test(name) &&
    !name.includes("/") &&
    !name.includes("\\") &&
    name !== "." &&
    name !== ".."
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate raw frontmatter YAML. When `expectedName` is given (pack-import
 * slug), a differing `name:` is a `nameLocked` error instead of silently
 * renaming the agent.
 */
export function getAgentMetadataError(
  frontmatter: string | null | undefined,
  options?: { expectedName?: string },
): AgentMetadataError | undefined {
  if (!frontmatter?.trim()) return { type: "required" };
  let parsed: unknown;
  try {
    parsed = parseYaml(frontmatter);
  } catch {
    return { type: "syntax" };
  }
  if (!isRecord(parsed)) return { type: "mapping" };

  const nameValue = parsed.name ?? parsed.title;
  if (nameValue === undefined || (typeof nameValue === "string" && !nameValue.trim())) {
    return { type: "nameRequired" };
  }
  if (typeof nameValue !== "string") return { type: "nameInvalid" };
  const name = nameValue.trim();
  if (!isValidAgentName(name)) return { type: "nameInvalid" };

  const expectedName = options?.expectedName?.trim() ?? "";
  if (expectedName && isValidAgentName(expectedName) && name !== expectedName) {
    return { expectedName, type: "nameLocked" };
  }

  const descriptionValue = parsed.description;
  if (descriptionValue !== undefined && descriptionValue !== null) {
    if (typeof descriptionValue !== "string") return { type: "descriptionInvalid" };
    const description = descriptionValue.trim();
    if (
      description &&
      (UNSAFE_SCALAR_PATTERN.test(description) ||
        description.length > MAX_AGENT_DESCRIPTION_LENGTH)
    ) {
      return { type: "descriptionInvalid" };
    }
  }
  return undefined;
}

export function describeAgentMetadataError(error: AgentMetadataError): string {
  switch (error.type) {
    case "required":
      return "AGENT.md must start with YAML frontmatter between '---' markers.";
    case "mapping":
      return "Frontmatter must be a YAML map.";
    case "syntax":
      return "Frontmatter could not be parsed as YAML.";
    case "nameRequired":
      return "Frontmatter needs a `name:` (lowercase letters, digits, hyphens).";
    case "nameInvalid":
      return "Invalid agent name: use lowercase letters, digits, and hyphens (max 80 characters).";
    case "nameLocked":
      return `This import must keep the name \`${error.expectedName}\`.`;
    case "descriptionInvalid":
      return "Description must be a single line of at most 1024 characters.";
  }
}

export type AgentDraftInput = {
  description: string;
  mode: string;
  modelRef: string;
  name: string;
  prompt: string;
  temperature: string;
};

export type AgentDraftError = {
  field: "description" | "mode" | "modelRef" | "name" | "prompt" | "temperature";
  message: string;
};

/** Validate editor input before it ever reaches storage. */
export function validateAgentDraft(input: AgentDraftInput): AgentDraftError[] {
  const errors: AgentDraftError[] = [];
  const name = input.name.trim();
  if (!name) {
    errors.push({ field: "name", message: "Give the agent a name." });
  } else {
    // Storage slugifies on save (normalizeAgentName); only flag names that
    // collapse to the "agent" fallback without being valid themselves —
    // same rule as validateSkillDraft.
    const slug = normalizeAgentSlug(name);
    if (slug === "agent" && !isValidAgentName(name.toLowerCase())) {
      errors.push({
        field: "name",
        message: "Name must use lowercase letters, digits, and hyphens (max 80 characters).",
      });
    }
  }
  const description = input.description.trim();
  if (description) {
    if (UNSAFE_SCALAR_PATTERN.test(description)) {
      errors.push({ field: "description", message: "Description must be a single line." });
    }
    if (description.length > MAX_AGENT_DESCRIPTION_LENGTH) {
      errors.push({
        field: "description",
        message: `Description must be at most ${MAX_AGENT_DESCRIPTION_LENGTH} characters.`,
      });
    }
  }
  if (!input.prompt.trim()) {
    errors.push({ field: "prompt", message: "System prompt cannot be empty." });
  } else if (input.prompt.trim().length > MAX_AGENT_PROMPT_LENGTH) {
    errors.push({
      field: "prompt",
      message: `System prompt must be at most ${MAX_AGENT_PROMPT_LENGTH} characters.`,
    });
  }
  if (!(AGENT_MODES as readonly string[]).includes(input.mode)) {
    errors.push({ field: "mode", message: "Availability must be all, primary, or subagent." });
  }
  const modelRef = input.modelRef.trim();
  if (modelRef) {
    const separatorIndex = modelRef.indexOf("/");
    if (separatorIndex <= 0 || separatorIndex === modelRef.length - 1) {
      errors.push({ field: "modelRef", message: "Model must look like provider/model, or stay empty." });
    }
  }
  if (input.temperature.trim()) {
    const temperature = Number.parseFloat(input.temperature);
    if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
      errors.push({ field: "temperature", message: "Temperature must be a number from 0 to 2, or stay empty." });
    }
  }
  return errors;
}
