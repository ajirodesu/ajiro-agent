/**
 * Vendor the xterm renderer into a TypeScript string bundle.
 *
 * The terminal WebView is fully offline: `TerminalWebView.tsx` inlines these
 * strings into its HTML document — no CDN, no runtime network fetch.
 *
 * Usage: `npm run vendor:terminal` (run after `npm install`).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const require = createRequire(join(root, "package.json"));

function resolveFirst(candidates) {
  for (const candidate of candidates) {
    try {
      return require.resolve(candidate);
    } catch {
      // try next
    }
  }
  throw new Error(
    `Cannot resolve any of: ${candidates.join(", ")}. Did you run npm install?`,
  );
}

const xtermJsPath = resolveFirst(["@xterm/xterm/lib/xterm.js"]);
const xtermCssPath = resolveFirst(["@xterm/xterm/css/xterm.css"]);
const fitJsPath = resolveFirst(["@xterm/addon-fit/lib/addon-fit.js"]);
const searchJsPath = resolveFirst(["@xterm/addon-search/lib/addon-search.js"]);

const xtermJs = readFileSync(xtermJsPath, "utf8");
const xtermCss = readFileSync(xtermCssPath, "utf8");
const fitJs = readFileSync(fitJsPath, "utf8");
const searchJs = readFileSync(searchJsPath, "utf8");

const out = `/**
 * GENERATED — do not edit by hand. Run \`npm run vendor:terminal\`.
 * Sources:
 * - ${xtermJsPath.replace(root, ".")}
 * - ${xtermCssPath.replace(root, ".")}
 * - ${fitJsPath.replace(root, ".")}
 * - ${searchJsPath.replace(root, ".")}
 */
export const XTERM_JS = ${JSON.stringify(xtermJs)};
export const XTERM_CSS = ${JSON.stringify(xtermCss)};
export const FIT_ADDON_JS = ${JSON.stringify(fitJs)};
export const SEARCH_ADDON_JS = ${JSON.stringify(searchJs)};
`;

writeFileSync(join(root, "src", "terminal", "xtermBundle.ts"), out);
console.log("terminal vendor bundle written: src/terminal/xtermBundle.ts");
console.log(`  xterm.js: ${(xtermJs.length / 1024).toFixed(1)} KiB`);
console.log(`  xterm.css: ${(xtermCss.length / 1024).toFixed(1)} KiB`);
console.log(`  addon-fit.js: ${(fitJs.length / 1024).toFixed(1)} KiB`);
console.log(`  addon-search.js: ${(searchJs.length / 1024).toFixed(1)} KiB`);
