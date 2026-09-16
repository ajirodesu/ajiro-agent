/**
 * Dependency resolution (prompt §53, §75).
 *
 * What Acode actually publishes: `plugin.json.dependencies` is a flat array
 * of plugin ids with **no version information** ([OPEN-SOURCE, MIT]:
 * installPlugin.js prompts the user for each listed id). Ajiro therefore has
 * two layers:
 *
 * 1. the manifest layer — ids only, enforced by the installer as the last
 *    line of defence before anything is written to disk;
 * 2. this layer — registry metadata, where a provider *can* publish a
 *    version alongside each dependency id, plus the constraints implied by
 *    what is already installed. That is what makes ordered installation,
 *    version conflicts, and circular declarations detectable at all.
 *
 * `[AJIRO ORIGINAL]` for the version semantics: Acode defines none, so the
 * range grammar here is deliberately small and documented (see
 * `satisfiesVersion`) instead of pretending to be full semver.
 *
 * Nothing here installs or executes anything: it resolves a plan and reports
 * issues, and the caller decides.
 */
import type { ExtensionMetadata, InstalledExtensionRecord } from "./models";

/** One dependency edge: an id, and optionally the version it requires. */
export type DependencyRequirement = {
  id: string;
  /** Range or exact version; null means "any version". */
  version: string | null;
};

export type DependencyIssue =
  | {
      kind: "missing";
      id: string;
      required: string | null;
      requiredBy: string;
    }
  | {
      /** An installed or catalog version does not satisfy the requirement. */
      kind: "version";
      found: string;
      id: string;
      required: string;
      requiredBy: string;
      /**
       * `installed` mismatches are blocking (the user must act); `catalog`
       * mismatches are advisory because the registry exposes only the latest
       * published version, so a satisfiable one may exist unseen.
       */
      source: "catalog" | "installed";
    }
  | {
      /** Two dependents require versions that cannot both be satisfied. */
      kind: "conflict";
      id: string;
      requirements: { requiredBy: string; version: string }[];
    }
  | {
      /** A dependency cycle: the first id repeats at the end. */
      kind: "circular";
      cycle: string[];
    }
  | {
      /**
       * A dependency install was attempted and failed — network, validation,
       * or disk. Reported instead of thrown so everything that *did* install
       * stays accounted for.
       */
      kind: "failed";
      id: string;
      message: string;
      requiredBy: string;
    }
  | {
      /** The requirement string is not in the supported grammar. */
      kind: "unparseable";
      id: string;
      required: string;
      requiredBy: string;
    };

export type DependencyPlan = {
  /** Registry entries that must be installed, dependencies first. */
  installOrder: ExtensionMetadata[];
  /** Everything wrong with the graph, in discovery order. */
  issues: DependencyIssue[];
  /** Ids that are required but absent from the catalog. */
  missingIds: string[];
  /** True when `installOrder` can be installed and no issue blocks it. */
  resolvable: boolean;
};

/* -------------------------------------------------------------- versions */

/** Numeric components of a version string, ignoring any prerelease suffix. */
function numericParts(value: string): number[] | null {
  const core = value.trim().split(/[-+]/)[0];
  if (!/^\d+(\.\d+)*$/.test(core)) return null;
  return core.split(".").map((part) => Number.parseInt(part, 10));
}

function compareParts(left: number[], right: number[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

function upperBoundFor(
  parts: number[],
  mode: "caret" | "tilde",
): number[] {
  const [major = 0, minor = 0, patch = 0] = parts;
  if (mode === "tilde") return [major, minor + 1, 0];
  // ^1.2.3 → <2.0.0, ^0.2.3 → <0.3.0, ^0.0.3 → <0.0.4 (npm's caret rules).
  if (major > 0) return [major + 1, 0, 0];
  if (minor > 0) return [0, minor + 1, 0];
  return [0, 0, patch + 1];
}

/**
 * Does `version` satisfy `requirement`?
 *
 * Supported grammar: `*`/empty (any), an exact version, `^1.2.3`, `~1.2.3`,
 * and the comparison operators `=`, `>=`, `>`, `<=`, `<`. A space-separated
 * list is a conjunction (`>=1.2.0 <2.0.0`). Anything else returns `null`,
 * which callers must treat as "cannot be established" — never as satisfied.
 */
export function satisfiesVersion(
  version: string,
  requirement: string | null,
): boolean | null {
  const trimmed = (requirement ?? "*").trim();
  if (!trimmed || trimmed === "*" || trimmed.toLowerCase() === "any") return true;
  const target = numericParts(version);
  if (!target) return null;

  for (const clause of trimmed.split(/\s+/).filter(Boolean)) {
    if (!clause || clause === "*") continue;
    const match = /^(\^|~|>=|<=|>|<|=)?\s*(.+)$/.exec(clause);
    if (!match) return null;
    const operator = match[1] ?? "=";
    const bound = numericParts(match[2]);
    if (!bound) return null;
    const comparison = compareParts(target, bound);
    let ok: boolean;
    switch (operator) {
      case "^":
      case "~":
        ok =
          comparison >= 0 &&
          compareParts(
            target,
            upperBoundFor(bound, operator === "^" ? "caret" : "tilde"),
          ) < 0;
        break;
      case ">=":
        ok = comparison >= 0;
        break;
      case ">":
        ok = comparison > 0;
        break;
      case "<=":
        ok = comparison <= 0;
        break;
      case "<":
        ok = comparison < 0;
        break;
      default:
        ok = comparison === 0;
        break;
    }
    if (!ok) return false;
  }
  return true;
}

/** True when a set of requirements has a version satisfying all of them. */
export function requirementsAgree(
  requirements: string[],
  versions: string[],
): boolean {
  const candidates = requirements.length > 0 ? requirements : ["*"];
  return versions.some((version) =>
    candidates.every((requirement) => satisfiesVersion(version, requirement) !== false),
  );
}

/* ----------------------------------------------------------- the graph */

export type DependencyGraph = Map<string, DependencyRequirement[]>;

/**
 * Build the dependency graph from every source that knows about it: the
 * catalog (which can carry versions), installed records (ids only, from
 * their manifest), and the package currently being planned.
 *
 * Installed ids with no catalog entry still produce an edge so a cycle that
 * closes through an installed plugin is still detected.
 */
export function buildDependencyGraph(input: {
  catalog?: ExtensionMetadata[];
  installed?: InstalledExtensionRecord[];
  /** The package being planned. */
  root?: { dependencies: DependencyRequirement[]; id: string };
}): DependencyGraph {
  const graph: DependencyGraph = new Map();

  const merge = (id: string, requirements: DependencyRequirement[]) => {
    const existing = graph.get(id) ?? [];
    for (const requirement of requirements) {
      const already = existing.find((entry) => entry.id === requirement.id);
      if (!already) {
        existing.push(requirement);
        continue;
      }
      // Prefer the more specific requirement when both layers know the edge.
      if (already.version === null && requirement.version !== null) {
        already.version = requirement.version;
      }
    }
    graph.set(id, existing);
  };

  for (const record of input.installed ?? []) {
    const declared = Array.isArray(record.manifest.dependencies)
      ? record.manifest.dependencies
      : [];
    merge(
      record.id,
      declared
        .filter((entry): entry is string => typeof entry === "string")
        .map((id) => ({ id, version: null })),
    );
  }

  for (const entry of input.catalog ?? []) {
    merge(
      entry.id,
      entry.dependencies.map((dependency) => ({
        id: dependency.id,
        version: dependency.version,
      })),
    );
  }

  if (input.root) merge(input.root.id, input.root.dependencies);

  return graph;
}

/* ------------------------------------------------------------ planning */

/** Versions known for an id, from the catalog and from disk. */
function knownVersions(
  id: string,
  catalog: Map<string, ExtensionMetadata>,
  installed: Map<string, InstalledExtensionRecord>,
): string[] {
  return [
    installed.get(id)?.version ?? null,
    catalog.get(id)?.version ?? null,
  ].filter((version): version is string => version !== null);
}

/**
 * Resolve the dependency closure of `pluginId` into an install order and a
 * list of issues (prompt §53).
 *
 * Order is dependency-first: a depth-first post-order walk, so a plugin's
 * dependencies always appear before it. Already-installed ids are not part
 * of the order — they only participate in version checks and cycle
 * detection.
 *
 * Issue semantics:
 * - a version mismatch against an installed version is fatal;
 * - a version mismatch against a *catalog* version is not, because the
 *   requirement may be satisfiable by a different published version, which
 *   this model cannot see (Acode's registry exposes only the latest) — it is
 *   reported so the user knows before downloading;
 * - cycles and unparseable requirements are fatal;
 * - conflicts are fatal.
 */
export function planDependencyInstall(
  pluginId: string,
  graph: DependencyGraph,
  sources: {
    catalog: ExtensionMetadata[];
    installed: InstalledExtensionRecord[];
  },
): DependencyPlan {
  const catalog = new Map(sources.catalog.map((entry) => [entry.id, entry]));
  const installed = new Map(
    sources.installed.map((record) => [record.id, record]),
  );
  const issues: DependencyIssue[] = [];
  const order: string[] = [];
  const visited = new Set<string>();
  const path: string[] = [];

  const pushIssue = (issue: DependencyIssue) => {
    // Never report the same fact twice (the graph is walked once, but a
    // shared dependency is legitimately reached from several parents).
    const key = JSON.stringify(issue);
    if (!issues.some((existing) => JSON.stringify(existing) === key)) {
      issues.push(issue);
    }
  };

  /**
   * Walk one node's requirements, depth-first. The root is walked like any
   * other node — its own edges must be reported and ordered too — but it is
   * never *pushed* into `order`, because only a dependent pushes its
   * requirements and the caller already holds the root's package.
   */
  const visit = (id: string): void => {
    if (visited.has(id)) return;
    if (path.includes(id)) {
      pushIssue({ cycle: [...path.slice(path.indexOf(id)), id], kind: "circular" });
      return;
    }
    path.push(id);
    const requirements = graph.get(id) ?? [];

    for (const requirement of requirements) {
      if (visited.has(requirement.id)) {
        checkVersion(id, requirement, catalog, installed, pushIssue);
        continue;
      }
      if (path.includes(requirement.id)) {
        pushIssue({
          cycle: [...path.slice(path.indexOf(requirement.id)), requirement.id],
          kind: "circular",
        });
        continue;
      }

      const target = catalog.get(requirement.id);
      const isInstalled = installed.has(requirement.id);
      if (!isInstalled && !target) {
        pushIssue({
          id: requirement.id,
          kind: "missing",
          required: requirement.version,
          requiredBy: id,
        });
        visited.add(requirement.id);
        continue;
      }

      if (!isInstalled) {
        // Recurse first so dependencies land ahead of their dependents.
        visit(requirement.id);
        if (target && !order.includes(requirement.id)) order.push(requirement.id);
      }
      checkVersion(id, requirement, catalog, installed, pushIssue);
    }
    path.pop();
    visited.add(id);
  };

  visit(pluginId);

  // Cross-node conflicts: the walk above only ever sees one node's own edges,
  // while the interesting case is a diamond — two dependents requiring
  // incompatible ranges of the same id (§75). Only requirements inside this
  // closure are compared, so an unrelated pair elsewhere in the catalog
  // cannot block this install.
  const reachable = new Set<string>();
  const collect = (id: string): void => {
    if (reachable.has(id)) return;
    reachable.add(id);
    for (const requirement of graph.get(id) ?? []) collect(requirement.id);
  };
  collect(pluginId);

  const perTarget = new Map<string, { requiredBy: string; version: string }[]>();
  for (const owner of reachable) {
    for (const requirement of graph.get(owner) ?? []) {
      if (!requirement.version) continue;
      const list = perTarget.get(requirement.id) ?? [];
      list.push({ requiredBy: owner, version: requirement.version });
      perTarget.set(requirement.id, list);
    }
  }
  for (const [id, requirements] of perTarget) {
    const distinct = [...new Set(requirements.map((entry) => entry.version))];
    if (distinct.length < 2) continue;
    // Without a known version there is nothing to test the ranges against, so
    // the conflict is left unreported rather than guessed at.
    const known = knownVersions(id, catalog, installed);
    if (known.length === 0) continue;
    if (!requirementsAgree(distinct, known)) {
      pushIssue({ id, kind: "conflict", requirements });
    }
  }

  const fatal = issues.some((issue) =>
    issue.kind === "version" ? issue.source === "installed" : true,
  );

  const installOrder = order
    .map((id) => catalog.get(id))
    .filter((entry): entry is ExtensionMetadata => entry !== undefined);

  return {
    installOrder,
    issues,
    missingIds: issues.flatMap((issue) =>
      issue.kind === "missing" ? [issue.id] : [],
    ),
    resolvable: !fatal,
  };
}

function checkVersion(
  requiredBy: string,
  requirement: DependencyRequirement,
  catalog: Map<string, ExtensionMetadata>,
  installed: Map<string, InstalledExtensionRecord>,
  pushIssue: (issue: DependencyIssue) => void,
): void {
  if (!requirement.version) return;
  const installedRecord = installed.get(requirement.id);
  if (installedRecord) {
    const satisfied = satisfiesVersion(installedRecord.version, requirement.version);
    if (satisfied === null) {
      pushIssue({
        id: requirement.id,
        kind: "unparseable",
        required: requirement.version,
        requiredBy,
      });
      return;
    }
    if (!satisfied) {
      pushIssue({
        found: installedRecord.version,
        id: requirement.id,
        kind: "version",
        required: requirement.version,
        requiredBy,
        source: "installed",
      });
    }
    return;
  }
  const entry = catalog.get(requirement.id);
  if (!entry) return;
  const satisfied = satisfiesVersion(entry.version, requirement.version);
  if (satisfied === null) {
    pushIssue({
      id: requirement.id,
      kind: "unparseable",
      required: requirement.version,
      requiredBy,
    });
    return;
  }
  if (!satisfied) {
    pushIssue({
      found: entry.version,
      id: requirement.id,
      kind: "version",
      required: requirement.version,
      requiredBy,
      source: "catalog",
    });
  }
}

/** Human-readable lines for the Store and for diagnostics (§83). */
export function describeDependencyIssues(issues: DependencyIssue[]): string[] {
  return issues.map((issue) => {
    switch (issue.kind) {
      case "missing":
        return `Missing dependency "${issue.id}"${
          issue.required ? ` (${issue.required})` : ""
        }, required by "${issue.requiredBy}".`;
      case "version":
        return `"${issue.id}" is ${issue.found}${
          issue.source === "installed" ? " (installed)" : " in the catalog"
        }, but "${issue.requiredBy}" requires ${issue.required}.`;
      case "conflict":
        return `"${issue.id}" is required as ${issue.requirements
          .map((requirement) => `${requirement.version} by ${requirement.requiredBy}`)
          .join(", ")} — no single version satisfies all of them.`;
      case "circular":
        return `Circular dependency: ${issue.cycle.join(" → ")}.`;
      case "failed":
        return `Installing dependency "${issue.id}", required by "${issue.requiredBy}", failed: ${issue.message}`;
      default:
        return `"${issue.id}" requires version "${issue.required}", which this build cannot compare versions against.`;
    }
  });
}

/** Every dependency id named anywhere in the graph, deduplicated. */
export function dependencyIds(graph: DependencyGraph): string[] {
  const ids = new Set<string>();
  for (const requirements of graph.values()) {
    for (const requirement of requirements) ids.add(requirement.id);
  }
  return [...ids];
}
