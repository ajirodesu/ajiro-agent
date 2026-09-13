/**
 * Deferred tool discovery (§25): a capability registry maps task signals to
 * tool schemas, so each model request carries only relevant schemas.
 *
 * Source provenance: [AJIRO ORIGINAL]; deferred-loading follows publicly
 * observable agent efficiency practices.
 */
export type ToolCapability = {
  toolName: string;
  capabilities: string[];
  /** Rough schema token cost for budgeting. */
  schemaTokens: number;
};

export type CapabilityRegistry = {
  tools: ToolCapability[];
};

export function createCapabilityRegistry(
  tools: ToolCapability[] = [],
): CapabilityRegistry {
  return { tools: [...tools] };
}

export function registerCapability(
  registry: CapabilityRegistry,
  tool: ToolCapability,
): void {
  const index = registry.tools.findIndex(
    (entry) => entry.toolName === tool.toolName,
  );
  if (index >= 0) registry.tools[index] = tool;
  else registry.tools.push(tool);
}

/**
 * Discover relevant tool schemas for signals (words from the request/task).
 * Scores by capability overlap; ties break toward cheaper schemas.
 */
export function discoverTools(
  registry: CapabilityRegistry,
  signals: string[],
  limit = 12,
): ToolCapability[] {
  const needles = signals.map((signal) => signal.toLowerCase());
  const scored = registry.tools.map((tool) => {
    let score = 0;
    for (const capability of tool.capabilities) {
      const lower = capability.toLowerCase();
      if (needles.some((needle) => needle && (lower.includes(needle) || needle.includes(lower)))) {
        score += 1;
      }
    }
    return { tool, score };
  });
  return scored
    .filter((entry) => entry.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score || left.tool.schemaTokens - right.tool.schemaTokens,
    )
    .slice(0, Math.max(1, limit))
    .map((entry) => entry.tool);
}

export function discoveryTokenCost(tools: ToolCapability[]): number {
  return tools.reduce((total, tool) => total + tool.schemaTokens, 0);
}
