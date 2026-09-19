/**
 * Plugin snippet feed: `.snippets` data files parsed on activation land
 * in the plugin snippet store (merged into completions by the intel
 * bridge), and leave on disable/uninstall — all with zero manual setup.
 */
import { describe, expect, it } from "vitest";

import type { InstallDeps } from "../installer";
import { createExtensionManager } from "../manager";
import { ExtensionRuntime } from "../runtime";
import { planExtensionPaths } from "../storage";
import {
  clearPluginSnippets,
  listPluginSnippets,
} from "../plugin-snippets";
import {
  createFakeExecutionHost,
  createMemoryPlatform,
  zipOfFiles,
} from "./helpers";

const MANIFEST = {
  author: { name: "Tester" },
  files: [
    "main.js",
    "snippets/javascript.snippets",
    "snippets/python.snippets",
  ],
  id: "com.example.snippets",
  main: "main.js",
  name: "Example Snippets",
  version: "1.0.0",
};

const JS_SNIPPETS = `# Log
snippet cl
\tconsole.log(\${1});
# bogus block without a trigger is skipped
snippet
\tnope
`;

const PY_SNIPPETS = `# Print
snippet pr
\tprint(\${1})
`;

function setup() {
  const { platform } = createMemoryPlatform();
  const deps: InstallDeps = {
    paths: planExtensionPaths("file:///docs/"),
    platform,
  };
  const runtime = new ExtensionRuntime(deps);
  const host = createFakeExecutionHost();
  runtime.setExecutionHost(host);
  const manager = createExtensionManager({ deps, runtime });
  return { deps, host, manager, platform };
}

async function installSnippets(
  manager: ReturnType<typeof createExtensionManager>,
  deps: InstallDeps,
) {
  await deps.platform.writeBinary(
    "file:///docs/snippets.zip",
    zipOfFiles({
      "main.js":
        "acode.setPluginInit('com.example.snippets', function () {});",
      "plugin.json": JSON.stringify(MANIFEST),
      "snippets/javascript.snippets": JS_SNIPPETS,
      "snippets/python.snippets": PY_SNIPPETS,
    }),
  );
  // Zero-setup: permissions auto-grant and the plugin activates.
  const outcome = await manager.install({
    kind: "file",
    uri: "file:///docs/snippets.zip",
  });
  if (outcome.status !== "installed") {
    throw new Error(`expected installed, got ${outcome.status}`);
  }
  return outcome;
}

describe("plugin snippet feed", () => {
  it("parses snippet files on activation and clears them on disable", async () => {
    clearPluginSnippets("com.example.snippets");
    const { deps, manager } = setup();
    // Consent → install → auto-enable → activation parses the files.
    await installSnippets(manager, deps);
    const snippets = listPluginSnippets();
    expect(snippets.map((item) => item.prefix).sort()).toEqual(["cl", "pr"]);
    expect(
      snippets.find((item) => item.prefix === "cl"),
    ).toMatchObject({
      description: "Log",
      languageIds: ["javascript"],
    });
    expect(
      snippets.find((item) => item.prefix === "pr")?.languageIds,
    ).toEqual(["python"]);

    await manager.disable("com.example.snippets");
    expect(listPluginSnippets()).toEqual([]);
  });

  it("clears snippets on uninstall", async () => {
    clearPluginSnippets("com.example.snippets");
    const { deps, manager } = setup();
    await installSnippets(manager, deps);
    expect(listPluginSnippets()).not.toHaveLength(0);
    await manager.uninstall("com.example.snippets");
    expect(listPluginSnippets()).toEqual([]);
  });
});
