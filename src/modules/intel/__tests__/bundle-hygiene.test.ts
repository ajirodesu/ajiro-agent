import { readFileSync, readdirSync as readdir, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "..", "..", "..");

/**
 * Bundle hygiene: the React Native graph must never statically import the
 * TypeScript compiler (bundle size + Hermes risk). Only the WebView vendor
 * bundle (`intel/web/`) and tests may reference it.
 */
describe("bundle hygiene", () => {
  it("no app source statically imports the typescript package", () => {
    const violations: string[] = [];
    const visit = (dir: string): void => {
      for (const entry of readdir(dir)) {
        if (entry === "__tests__" || entry === "web") continue;
        const full = join(dir, entry);
        const stat = statSync(full);
        if (stat.isDirectory()) {
          visit(full);
          continue;
        }
        if (!full.endsWith(".ts") && !full.endsWith(".tsx")) continue;
        // Type-only imports and `typeof import()` queries are erased at
        // compile time and never bundled; comments are documentation.
        const content = readFileSync(full, "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/(^|\n)\s*\/\/[^\n]*/g, "$1")
          .replace(/^\s*import\s+type\b[^;]*;/gm, "")
          .replace(/typeof\s+import\(["'][^"']+["']\)/g, "unknown");
        if (
          /from\s+["']typescript["']/.test(content) ||
          /import\(\s*["']typescript["']\s*\)/.test(content) ||
          /require\(\s*["']typescript["']\s*\)/.test(content)
        ) {
          violations.push(full);
        }
      }
    };
    visit(join(srcDir, "modules", "intel"));
    expect(violations).toEqual([]);
  });
});
