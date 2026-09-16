/**
 * Dependency resolution (§53/§75): version grammar, graph construction,
 * install ordering, and every blocking issue the planner can report.
 */
import { describe, expect, it } from "vitest";

import {
  buildDependencyGraph,
  dependencyIds,
  describeDependencyIssues,
  planDependencyInstall,
  requirementsAgree,
  satisfiesVersion,
} from "../dependencies";
import type { ExtensionMetadata, InstalledExtensionRecord } from "../models";

function metadata(
  id: string,
  version = "1.0.0",
  dependencies: { id: string; version: string | null }[] = [],
): ExtensionMetadata {
  return {
    author: null,
    category: null,
    changelog: null,
    dependencies,
    description: null,
    download: null,
    icon: null,
    id,
    keywords: [],
    license: null,
    minVersionCode: null,
    minVersionName: null,
    name: id,
    price: 0,
    readme: null,
    repository: null,
    source: "registry",
    updatedAt: null,
    version,
  };
}

function record(
  id: string,
  version: string,
  dependencies: string[] = [],
): InstalledExtensionRecord {
  return {
    compatibility: { level: "compatible", reasons: [] },
    enabled: true,
    id,
    installedAt: "2026-01-01T00:00:00Z",
    manifest: { dependencies, id, version },
    packageSha256: null,
    permissions: [],
    runtimeError: null,
    runtimeState: "enabled",
    signature: null,
    source: "registry",
    sourceUrl: null,
    updatedAt: "2026-01-01T00:00:00Z",
    version,
  };
}

describe("version requirements", () => {
  it("treats empty and star requirements as satisfied", () => {
    expect(satisfiesVersion("1.2.3", null)).toBe(true);
    expect(satisfiesVersion("1.2.3", "")).toBe(true);
    expect(satisfiesVersion("1.2.3", "*")).toBe(true);
    expect(satisfiesVersion("1.2.3", "any")).toBe(true);
  });

  it("applies exact and comparison operators", () => {
    expect(satisfiesVersion("1.2.3", "1.2.3")).toBe(true);
    expect(satisfiesVersion("1.2.4", "1.2.3")).toBe(false);
    expect(satisfiesVersion("1.2.3", ">=1.2.0")).toBe(true);
    expect(satisfiesVersion("1.2.3", ">1.2.3")).toBe(false);
    expect(satisfiesVersion("1.2.3", "<=1.3.0")).toBe(true);
    expect(satisfiesVersion("1.2.3", "<1.2.0")).toBe(false);
  });

  it("applies npm caret and tilde rules", () => {
    expect(satisfiesVersion("1.9.0", "^1.2.3")).toBe(true);
    expect(satisfiesVersion("2.0.0", "^1.2.3")).toBe(false);
    expect(satisfiesVersion("0.2.9", "^0.2.3")).toBe(true);
    expect(satisfiesVersion("0.3.0", "^0.2.3")).toBe(false);
    expect(satisfiesVersion("0.0.3", "^0.0.3")).toBe(true);
    expect(satisfiesVersion("0.0.4", "^0.0.3")).toBe(false);
    expect(satisfiesVersion("1.2.9", "~1.2.3")).toBe(true);
    expect(satisfiesVersion("1.3.0", "~1.2.3")).toBe(false);
  });

  it("treats a space-separated list as a conjunction", () => {
    expect(satisfiesVersion("1.5.0", ">=1.2.0 <2.0.0")).toBe(true);
    expect(satisfiesVersion("2.1.0", ">=1.2.0 <2.0.0")).toBe(false);
  });

  it("reports unestablished rather than satisfied for unknown grammar", () => {
    expect(satisfiesVersion("1.2.3", "latest")).toBeNull();
    expect(satisfiesVersion("nightly", "1.2.3")).toBeNull();
    expect(satisfiesVersion("1.2.3", "||1.2.0")).toBeNull();
  });

  it("detects when two requirements cannot both hold", () => {
    expect(requirementsAgree(["^1.0.0", ">=1.2.0"], ["1.4.0"])).toBe(true);
    expect(requirementsAgree(["^1.0.0", "^2.0.0"], ["1.4.0", "2.1.0"])).toBe(
      false,
    );
  });
});

describe("dependency graph and planning", () => {
  it("orders a closure dependency-first", () => {
    const graph = buildDependencyGraph({
      catalog: [
        metadata("plugin.a", "1.0.0", [{ id: "plugin.b", version: null }]),
        metadata("plugin.b", "1.0.0", [{ id: "plugin.c", version: null }]),
        metadata("plugin.c"),
      ],
    });
    const plan = planDependencyInstall("plugin.a", graph, {
      catalog: [
        metadata("plugin.a", "1.0.0", [{ id: "plugin.b", version: null }]),
        metadata("plugin.b", "1.0.0", [{ id: "plugin.c", version: null }]),
        metadata("plugin.c"),
      ],
      installed: [],
    });

    expect(plan.resolvable).toBe(true);
    // Dependency-first, and the root itself is excluded: the caller already
    // holds that package and installs it after the closure.
    expect(plan.installOrder.map((entry) => entry.id)).toEqual([
      "plugin.c",
      "plugin.b",
    ]);
    expect(plan.issues).toEqual([]);
  });

  it("skips ids that are already installed", () => {
    const catalog = [
      metadata("plugin.a", "1.0.0", [{ id: "plugin.b", version: null }]),
      metadata("plugin.b"),
    ];
    const plan = planDependencyInstall(
      "plugin.a",
      buildDependencyGraph({ catalog, installed: [record("plugin.b", "1.0.0")] }),
      { catalog, installed: [record("plugin.b", "1.0.0")] },
    );
    // The only dependency is already installed, and the root is not part of
    // the order, so there is nothing left to install.
    expect(plan.installOrder).toEqual([]);
    expect(plan.resolvable).toBe(true);
    expect(plan.missingIds).toEqual([]);
  });

  it("reports a required dependency missing from the catalog", () => {
    const catalog = [
      metadata("plugin.a", "1.0.0", [{ id: "plugin.absent", version: "^2.0.0" }]),
    ];
    const plan = planDependencyInstall(
      "plugin.a",
      buildDependencyGraph({ catalog }),
      { catalog, installed: [] },
    );
    expect(plan.resolvable).toBe(false);
    expect(plan.missingIds).toEqual(["plugin.absent"]);
    expect(plan.issues).toEqual([
      {
        id: "plugin.absent",
        kind: "missing",
        required: "^2.0.0",
        requiredBy: "plugin.a",
      },
    ]);
  });

  it("blocks on a version mismatch against an installed dependency", () => {
    const catalog = [
      metadata("plugin.a", "1.0.0", [{ id: "plugin.b", version: "^2.0.0" }]),
      metadata("plugin.b", "1.5.0"),
    ];
    const installed = [record("plugin.b", "1.5.0")];
    const plan = planDependencyInstall(
      "plugin.a",
      buildDependencyGraph({ catalog, installed }),
      { catalog, installed },
    );
    expect(plan.resolvable).toBe(false);
    expect(plan.issues).toContainEqual({
      found: "1.5.0",
      id: "plugin.b",
      kind: "version",
      required: "^2.0.0",
      requiredBy: "plugin.a",
      source: "installed",
    });
  });

  it("warns without blocking when only the catalog version mismatches", () => {
    const catalog = [
      metadata("plugin.a", "1.0.0", [{ id: "plugin.b", version: "^2.0.0" }]),
      metadata("plugin.b", "1.5.0"),
    ];
    const plan = planDependencyInstall(
      "plugin.a",
      buildDependencyGraph({ catalog }),
      { catalog, installed: [] },
    );
    const versionIssue = plan.issues.find((issue) => issue.kind === "version");
    expect(versionIssue).toMatchObject({ source: "catalog" });
    // A different published version may satisfy the range, so the plan holds.
    expect(plan.resolvable).toBe(true);
    expect(plan.installOrder.map((entry) => entry.id)).toEqual(["plugin.b"]);
  });

  it("reports a circular dependency and refuses to order it", () => {
    const catalog = [
      metadata("plugin.a", "1.0.0", [{ id: "plugin.b", version: null }]),
      metadata("plugin.b", "1.0.0", [{ id: "plugin.a", version: null }]),
    ];
    // The cycle closes back through the root, which must still be detected.
    const plan = planDependencyInstall(
      "plugin.a",
      buildDependencyGraph({ catalog }),
      { catalog, installed: [] },
    );
    expect(plan.resolvable).toBe(false);
    const circular = plan.issues.find((issue) => issue.kind === "circular");
    expect(circular).toMatchObject({ kind: "circular" });
    if (circular?.kind !== "circular") return;
    // The cycle is closed: the first id repeats at the end.
    expect(circular.cycle[0]).toBe(circular.cycle[circular.cycle.length - 1]);
    expect(new Set(circular.cycle).size).toBe(circular.cycle.length - 1);
  });

  it("reports two dependents that require incompatible versions", () => {
    const catalog = [
      metadata("plugin.a", "1.0.0", [{ id: "plugin.c", version: "^1.0.0" }]),
      metadata("plugin.b", "1.0.0", [{ id: "plugin.c", version: "^2.0.0" }]),
      metadata("plugin.c", "1.4.0"),
      metadata("plugin.root", "1.0.0", [
        { id: "plugin.a", version: null },
        { id: "plugin.b", version: null },
      ]),
    ];
    const plan = planDependencyInstall(
      "plugin.root",
      buildDependencyGraph({ catalog }),
      { catalog, installed: [] },
    );
    const conflict = plan.issues.find((issue) => issue.kind === "conflict");
    expect(conflict).toMatchObject({ id: "plugin.c", kind: "conflict" });
    if (conflict?.kind !== "conflict") return;
    expect(conflict.requirements.map((entry) => entry.requiredBy).sort()).toEqual([
      "plugin.a",
      "plugin.b",
    ]);
    expect(plan.resolvable).toBe(false);
  });

  it("refuses to guess when a requirement cannot be parsed", () => {
    const catalog = [
      metadata("plugin.a", "1.0.0", [{ id: "plugin.b", version: "latest" }]),
      metadata("plugin.b", "1.0.0"),
    ];
    const plan = planDependencyInstall(
      "plugin.a",
      buildDependencyGraph({ catalog }),
      { catalog, installed: [] },
    );
    expect(plan.issues).toContainEqual({
      id: "plugin.b",
      kind: "unparseable",
      required: "latest",
      requiredBy: "plugin.a",
    });
    expect(plan.resolvable).toBe(false);
  });

  it("merges catalog, installed, and root edges into one graph", () => {
    const graph = buildDependencyGraph({
      catalog: [metadata("plugin.a", "1.0.0", [{ id: "plugin.b", version: "^1.0.0" }])],
      installed: [record("plugin.b", "1.0.0", ["plugin.c"])],
      root: {
        dependencies: [{ id: "plugin.d", version: null }],
        id: "plugin.root",
      },
    });
    // `dependencyIds` lists the ids that are *required* anywhere in the graph
    // (owners are the map keys), which is what an installer needs to resolve.
    expect(dependencyIds(graph).sort()).toEqual([
      "plugin.b",
      "plugin.c",
      "plugin.d",
    ]);
    expect([...graph.keys()].sort()).toEqual(["plugin.a", "plugin.b", "plugin.root"]);
    // Installed-only ids still contribute an edge, so cycles through them
    // are detectable.
    expect(graph.get("plugin.b")).toEqual([{ id: "plugin.c", version: null }]);
  });

  it("describes every issue kind in human-readable lines", () => {
    const lines = describeDependencyIssues([
      { id: "plugin.a", kind: "missing", required: "^1.0.0", requiredBy: "root" },
      {
        found: "1.0.0",
        id: "plugin.b",
        kind: "version",
        required: "^2.0.0",
        requiredBy: "root",
        source: "installed",
      },
      {
        id: "plugin.c",
        kind: "conflict",
        requirements: [
          { requiredBy: "a", version: "^1.0.0" },
          { requiredBy: "b", version: "^2.0.0" },
        ],
      },
      { cycle: ["x", "y", "x"], kind: "circular" },
      { id: "plugin.d", kind: "unparseable", required: "latest", requiredBy: "root" },
    ]);
    expect(lines).toHaveLength(5);
    expect(lines[0]).toContain("Missing dependency \"plugin.a\"");
    expect(lines[1]).toContain("(installed)");
    expect(lines[2]).toContain("no single version satisfies all of them");
    expect(lines[3]).toBe("Circular dependency: x → y → x.");
    expect(lines[4]).toContain("cannot compare versions");
  });
});
