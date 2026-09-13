/**
 * Canonical agent modes (§15): every mode defines instructions, read-only
 * posture, iteration budget, context policy, preferred runtime, and skill
 * hints. Primary modes become selectable chat personas via the registry;
 * subagent modes are invoked through the task tool.
 *
 * Source provenance: [OPENCODE] Build/Plan/General/Explore profiles as
 * publicly observable behavior; [AJIRO ORIGINAL] Review/Debug/Test/Android/
 * Git/Security/Documentation specializations and all numeric budgets.
 * Model choice stays with the conversation model unless the row overrides it.
 */
import type { RuntimeBackend } from "@/modules/runtime/device-runtime";

export type AgentModeName =
  | "build"
  | "plan"
  | "explore"
  | "general"
  | "review"
  | "debug"
  | "test"
  | "android"
  | "git"
  | "security"
  | "documentation"
  | "explorer"
  | "planner"
  | "code-analyst"
  | "test-agent"
  | "security-reviewer"
  | "android-agent"
  | "documentation-agent";

export type AgentPersona = "primary" | "subagent";

export type AgentModeDefinition = {
  name: AgentModeName;
  persona: AgentPersona;
  description: string;
  instructions: string;
  readOnly: boolean;
  maxIterations: number;
  contextPolicy: string;
  runtime: RuntimeBackend;
  skillHints: string[];
};

function mode(definition: AgentModeDefinition): AgentModeDefinition {
  return definition;
}

export const AGENT_MODES: Record<AgentModeName, AgentModeDefinition> = {
  build: mode({
    name: "build",
    persona: "primary",
    description:
      "The default agent. Executes tasks with all configured tools and permissions.",
    instructions:
      "Complete the user's requested task using the available tools. " +
      "Inspect before changing, verify after changing, and report what was done.",
    readOnly: false,
    maxIterations: 50,
    contextPolicy: "full",
    runtime: "android_local",
    skillHints: [],
  }),
  plan: mode({
    name: "plan",
    persona: "primary",
    description:
      "Plan mode. Researches and presents plans without making any changes.",
    instructions:
      "Research, inspect, and analyze, but make no changes. Present a " +
      "clear step-by-step plan with risks and trade-offs, then tell the " +
      "user to switch to the Build agent to implement it.",
    readOnly: true,
    maxIterations: 25,
    contextPolicy: "full",
    runtime: "android_local",
    skillHints: [],
  }),
  explore: mode({
    name: "explore",
    persona: "primary",
    description:
      "Read-only repository exploration. Maps code, finds relevant files, answers questions without changing anything.",
    instructions:
      "Explore the repository read-only: locate relevant files, trace how " +
      "features work, and report findings with file references. Never modify anything.",
    readOnly: true,
    maxIterations: 25,
    contextPolicy: "retrieval",
    runtime: "android_local",
    skillHints: [],
  }),
  general: mode({
    name: "general",
    persona: "subagent",
    description:
      "General-purpose subagent for research and multi-step tasks delegated by the primary agent.",
    instructions:
      "Complete the delegated task and report findings or results. Stay within the delegated scope.",
    readOnly: false,
    maxIterations: 30,
    contextPolicy: "delegated",
    runtime: "android_local",
    skillHints: [],
  }),
  review: mode({
    name: "review",
    persona: "primary",
    description:
      "Code review. Reads diffs and changed files, reports issues by severity, suggests fixes without applying them unless asked.",
    instructions:
      "Review the requested changes or files. Report issues ordered by " +
      "severity (blocker, suggestion, nit), cite file and line, and propose " +
      "concrete fixes. Do not apply fixes unless explicitly asked.",
    readOnly: false,
    maxIterations: 25,
    contextPolicy: "diff-focused",
    runtime: "android_local",
    skillHints: [],
  }),
  debug: mode({
    name: "debug",
    persona: "primary",
    description:
      "Diagnosis and repair. Reproduces failures, isolates root causes, fixes, and verifies with allow-listed checks.",
    instructions:
      "Reproduce the failure first, isolate the root cause with the narrowest " +
      "evidence, fix it, then verify with the allow-listed checks. Explain the cause before the fix.",
    readOnly: false,
    maxIterations: 50,
    contextPolicy: "full",
    runtime: "android_local",
    skillHints: [],
  }),
  test: mode({
    name: "test",
    persona: "primary",
    description:
      "Testing specialist. Writes and runs tests, reports coverage gaps and failures.",
    instructions:
      "Write focused tests for the requested behavior, run the relevant " +
      "suites, and report passes, failures, and gaps. Keep tests deterministic.",
    readOnly: false,
    maxIterations: 40,
    contextPolicy: "full",
    runtime: "android_local",
    skillHints: [],
  }),
  android: mode({
    name: "android",
    persona: "primary",
    description:
      "Android specialist. Handles manifests, Gradle files, resources, permissions, and on-device constraints.",
    instructions:
      "Work on Android-specific concerns: manifests, resources, permissions, " +
      "lifecycle, and device constraints. Respect what stock Android allows; " +
      "report honestly what needs the Linux runtime.",
    readOnly: false,
    maxIterations: 40,
    contextPolicy: "full",
    runtime: "android_local",
    skillHints: [],
  }),
  git: mode({
    name: "git",
    persona: "primary",
    description:
      "Git specialist. Status, branches, commits, diffs, staging, and safe history operations.",
    instructions:
      "Handle Git work carefully: inspect status and diffs before acting, " +
      "stage precisely, write clear commit messages. Destructive history " +
      "operations (force push, branch deletion) require explicit approval.",
    readOnly: false,
    maxIterations: 30,
    contextPolicy: "full",
    runtime: "android_local",
    skillHints: [],
  }),
  security: mode({
    name: "security",
    persona: "primary",
    description:
      "Security reviewer. Audits code, plugins, skills, and MCP configurations for injection, traversal, and secret leaks.",
    instructions:
      "Audit for prompt injection, command injection, path traversal, secret " +
      "leakage, and unsafe permissions. Treat third-party plugins, skills, " +
      "and MCP servers as untrusted. Report findings with severity and remediation.",
    readOnly: false,
    maxIterations: 30,
    contextPolicy: "full",
    runtime: "android_local",
    skillHints: [],
  }),
  documentation: mode({
    name: "documentation",
    persona: "primary",
    description:
      "Documentation writer. Produces and updates Markdown docs, comments, and guides from the code as written.",
    instructions:
      "Write accurate documentation derived from the actual code. Update " +
      "existing docs when behavior changes. Never invent APIs or behavior.",
    readOnly: false,
    maxIterations: 25,
    contextPolicy: "full",
    runtime: "android_local",
    skillHints: [],
  }),
  explorer: mode({
    name: "explorer",
    persona: "subagent",
    description: "Fast read-only code search subagent for delegated exploration.",
    instructions:
      "Search and read code to answer the delegated question. Return file " +
      "references and relevant snippets. Make no changes.",
    readOnly: true,
    maxIterations: 15,
    contextPolicy: "delegated",
    runtime: "android_local",
    skillHints: [],
  }),
  planner: mode({
    name: "planner",
    persona: "subagent",
    description: "Plan-writing subagent. Produces implementation plans for the primary agent.",
    instructions:
      "Investigate the delegated topic and return a concrete step-by-step " +
      "implementation plan with risks. Make no changes.",
    readOnly: true,
    maxIterations: 15,
    contextPolicy: "delegated",
    runtime: "android_local",
    skillHints: [],
  }),
  "code-analyst": mode({
    name: "code-analyst",
    persona: "subagent",
    description: "Deep code-analysis subagent for delegated review and reasoning tasks.",
    instructions:
      "Analyze the delegated code thoroughly and return findings ordered by " +
      "importance with file and line references.",
    readOnly: true,
    maxIterations: 20,
    contextPolicy: "delegated",
    runtime: "android_local",
    skillHints: [],
  }),
  "test-agent": mode({
    name: "test-agent",
    persona: "subagent",
    description: "Test-writing subagent for delegated test tasks.",
    instructions:
      "Write and run the delegated tests with the allow-listed checks. " +
      "Return passes, failures, and the files changed.",
    readOnly: false,
    maxIterations: 20,
    contextPolicy: "delegated",
    runtime: "android_local",
    skillHints: [],
  }),
  "security-reviewer": mode({
    name: "security-reviewer",
    persona: "subagent",
    description: "Security-audit subagent for delegated reviews.",
    instructions:
      "Audit the delegated scope for injection, traversal, secret leakage, " +
      "and unsafe permissions. Return findings with severity.",
    readOnly: true,
    maxIterations: 20,
    contextPolicy: "delegated",
    runtime: "android_local",
    skillHints: [],
  }),
  "android-agent": mode({
    name: "android-agent",
    persona: "subagent",
    description: "Android-specialist subagent for delegated device work.",
    instructions:
      "Handle the delegated Android task respecting on-device constraints. " +
      "Return what changed and any limitations encountered.",
    readOnly: false,
    maxIterations: 20,
    contextPolicy: "delegated",
    runtime: "android_local",
    skillHints: [],
  }),
  "documentation-agent": mode({
    name: "documentation-agent",
    persona: "subagent",
    description: "Documentation subagent for delegated writing tasks.",
    instructions:
      "Write the delegated documentation from the actual code. Return the " +
      "files written and a short summary.",
    readOnly: false,
    maxIterations: 15,
    contextPolicy: "delegated",
    runtime: "android_local",
    skillHints: [],
  }),
};

export function getAgentModeDefinition(
  name: string | null | undefined,
): AgentModeDefinition | null {
  if (!name) return null;
  return (AGENT_MODES as Record<string, AgentModeDefinition>)[name] ?? null;
}

export function isReadOnlyModeName(name: string | null | undefined): boolean {
  return getAgentModeDefinition(name)?.readOnly ?? false;
}

/** Effective iteration budget: the lower of the mode cap and the setting. */
export function resolveMaxIterations(
  agentName: string | null | undefined,
  settingsMax: number,
): number {
  const modeMax = getAgentModeDefinition(agentName)?.maxIterations;
  if (!modeMax || modeMax <= 0) return settingsMax;
  return Math.min(settingsMax, modeMax);
}
