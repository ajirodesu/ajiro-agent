/**
 * Vendor the coding-intelligence engine into an offline WebView string bundle.
 *
 * `src/editor/intelBundle.ts` (`window.AjiroIntel`) contains the real
 * TypeScript compiler + language service, the completion merge engine, path
 * completion, snippets, and the inline-ghost controller. The editor WebView
 * inlines it next to CodeMirror: no CDN, no runtime network fetch.
 *
 * - `LIB_ENTRY` stays the single source of truth in
 *   `src/modules/intel/ts-libs.ts` (read here via regex, never duplicated).
 * - `lib.*.d.ts` contents are embedded by an esbuild plugin directly into
 *   the bundle — no committed intermediate, always in sync.
 * - `@/` imports resolve through an inline tsconfig paths mapping.
 *
 * Usage: `npm run vendor:intel` (run after `npm install`).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const require = createRequire(join(root, "package.json"));

function libEntryFromSource() {
  const source = readFileSync(join(root, "src", "modules", "intel", "ts-libs.ts"), "utf8");
  const match = /LIB_ENTRY[^=]*=\s*\[([^\]]*)\]/.exec(source);
  if (!match) throw new Error("LIB_ENTRY not found in ts-libs.ts");
  const entries = [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
  if (entries.length === 0) throw new Error("LIB_ENTRY is empty in ts-libs.ts");
  return entries;
}

function referencedLibs(content) {
  const out = [];
  const pattern = /\/\/\/\s*<reference\s+lib="([^"]+)"\s*\/>/g;
  let match;
  while ((match = pattern.exec(content)) !== null) {
    if (!out.includes(match[1])) out.push(match[1]);
  }
  return out;
}

const libFileNameFor = (lib) => `lib.${lib.toLowerCase()}.d.ts`;

function collectLibFiles(entryLibs) {
  const collected = new Map();
  const queue = entryLibs.map(libFileNameFor);
  const seen = new Set();
  while (queue.length > 0) {
    const fileName = queue.pop();
    if (seen.has(fileName)) continue;
    seen.add(fileName);
    let content = null;
    try {
      content = readFileSync(join(root, "node_modules", "typescript", "lib", fileName), "utf8");
    } catch {
      console.warn(`lib file missing: ${fileName}`);
      continue;
    }
    collected.set(fileName, content);
    for (const lib of referencedLibs(content)) {
      const dep = libFileNameFor(lib);
      if (!seen.has(dep)) queue.push(dep);
    }
  }
  return collected;
}

const entryLibs = libEntryFromSource();
console.log(`intel lib entry: ${entryLibs.join(", ")}`);
const libFiles = collectLibFiles(entryLibs);
console.log(`lib files collected: ${libFiles.size}`);

const libGenPlugin = {
  name: "ajiro-intel-libs",
  setup(build) {
    build.onResolve({ filter: /intel-libs\.gen$/ }, (args) => ({
      path: args.path,
      namespace: "ajiro-intel-libs",
    }));
    build.onLoad({ filter: /.*/, namespace: "ajiro-intel-libs" }, () => ({
      contents: `export const INTEL_LIB_FILES = ${JSON.stringify(Object.fromEntries(libFiles))};`,
      loader: "ts",
    }));
  },
};

const { build } = require("esbuild");
const out = await build({
  bundle: true,
  entryPoints: [join(root, "src", "modules", "intel", "web", "intel-web-entry.ts")],
  format: "iife",
  globalName: "AjiroIntel",
  minify: true,
  sourcemap: false,
  target: "es2020",
  write: false,
  plugins: [libGenPlugin],
  // Node builtins the compiler's node `sys` touches at module scope are
  // shimmed (the language service runs on the in-memory host and never
  // uses ts.sys). `process`/`__filename`/`__dirname` don't exist in the
  // WebView and are defined away.
  alias: {
    os: join(root, "scripts", "esbuild-shims", "os.js"),
    fs: join(root, "scripts", "esbuild-shims", "fs.js"),
    path: join(root, "scripts", "esbuild-shims", "path.js"),
  },
  inject: [join(root, "scripts", "esbuild-shims", "process.js")],
  define: {
    __filename: '"/intel-bundle.js"',
    __dirname: '"/"',
  },
  tsconfigRaw: JSON.stringify({
    compilerOptions: {
      baseUrl: ".",
      paths: { "@/*": ["./src/*"] },
      experimentalDecorators: true,
      useDefineForClassFields: false,
    },
  }),
});
const bundled = out.outputFiles[0].text;

const tsOut = `/**
 * GENERATED — do not edit by hand. Run \`npm run vendor:intel\`.
 * Offline coding-intelligence bundle: TypeScript compiler + language
 * service, completion merge, paths, snippets, inline-ghost controller.
 * No CDN, no runtime network fetch.
 */
export const INTEL_BUNDLE_JS = ${JSON.stringify(bundled)};
/** Lib files embedded in the bundle (from ts-libs.ts LIB_ENTRY closure). */
export const INTEL_LIB_NAMES: readonly string[] = ${JSON.stringify([...libFiles.keys()].sort())};
`;
writeFileSync(join(root, "src", "editor", "intelBundle.ts"), tsOut);
console.log("intel vendor bundle written: src/editor/intelBundle.ts");
console.log(`  bundle: ${(bundled.length / 1024).toFixed(1)} KiB`);
console.log(`  libs: ${libFiles.size} files`);
