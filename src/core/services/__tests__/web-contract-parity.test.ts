import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Web Preview contract parity: every `.web.ts(x)` variant must export the
 * same value-level surface as its native sibling, or the web bundle
 * silently diverges. Static comparison keeps this test in plain node
 * (the components themselves need react-native). The same pairs are
 * enforced by `npm run contracts:check`.
 */
const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "..", "..");

const PAIRS: [string, string][] = [
  ["core/services/secure-store.ts", "core/services/secure-store.web.ts"],
  ["core/services/secrets.ts", "core/services/secrets.web.ts"],
  [
    "components/extensions/plugin-host-surface.tsx",
    "components/extensions/plugin-host-surface.web.tsx",
  ],
  ["editor/CodeMirrorWebView.tsx", "editor/CodeMirrorWebView.web.tsx"],
];

function valueExports(relativePath: string): string[] {
  const text = readFileSync(join(src, relativePath), "utf8");
  const names = new Set<string>();
  for (const match of text.matchAll(
    /^export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z0-9_]+)/gm,
  )) {
    names.add(match[1]);
  }
  for (const match of text.matchAll(
    /^export\s+(?:interface|type)\s+([A-Za-z0-9_]+)/gm,
  )) {
    names.add(match[1]);
  }
  for (const match of text.matchAll(/^export\s+(?:type\s+)?\{([^}]*)\}/gm)) {
    for (const part of match[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim() ?? "";
      if (/^[A-Za-z0-9_]+$/.test(name)) {
        names.add(name);
      }
    }
  }
  if (/^export\s+default[ \n{]/m.test(text)) {
    names.add("default");
  }
  return [...names].sort();
}

describe("web contract parity", () => {
  for (const [native, web] of PAIRS) {
    it(`${web} matches ${native}`, () => {
      expect(valueExports(web)).toEqual(valueExports(native));
    });
  }
});
