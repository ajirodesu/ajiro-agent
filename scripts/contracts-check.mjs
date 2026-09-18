/**
 * Web Preview contract gate (`npm run contracts:check`). Fast static checks,
 * no bundler, no device:
 *
 * 1. `.web.ts(x)` variants export the same value-level surface as native.
 * 2. `app.json` satisfies `app.schema.json` (subset validator below +
 *    custom `requiredWebPlatform` keyword: platforms must include "web").
 * 3. `metro.config.js` keeps the `wasm` assetExt (expo-sqlite web).
 *
 * Exit non-zero with the failing check names. Full compile/lint/tests/web
 * export remain separate (`tsc --noEmit`, `expo lint`, `vitest run`,
 * `npm run archive:e2e:web`).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function check(name, fn) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (error) {
    failures.push(name);
    console.error(`FAIL  ${name}: ${error.message}`);
  }
}

function valueExports(relativePath) {
  const text = readFileSync(join(root, relativePath), "utf8");
  const names = new Set();
  for (const match of text.matchAll(
    /^export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z0-9_]+)/gm,
  )) {
    names.add(match[1]);
  }
  return [...names].sort();
}

const PAIRS = [
  ["src/core/services/secure-store.ts", "src/core/services/secure-store.web.ts"],
  ["src/core/services/secrets.ts", "src/core/services/secrets.web.ts"],
  [
    "src/components/extensions/plugin-host-surface.tsx",
    "src/components/extensions/plugin-host-surface.web.tsx",
  ],
  ["src/editor/CodeMirrorWebView.tsx", "src/editor/CodeMirrorWebView.web.tsx"],
];

for (const [native, web] of PAIRS) {
  check(`parity ${web}`, () => {
    const a = valueExports(native);
    const b = valueExports(web);
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      throw new Error(
        `export mismatch: native=[${a}] web=[${b}]`,
      );
    }
  });
}

function validate(schema, value, path) {
  if (schema.type === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error(`${path}: expected object`);
    }
    for (const key of schema.required ?? []) {
      if (!(key in value)) {
        throw new Error(`${path}: missing required key "${key}"`);
      }
    }
    for (const [key, sub] of Object.entries(schema.properties ?? {})) {
      if (key in value) {
        validate(sub, value[key], `${path}.${key}`);
      }
    }
    return;
  }
  if (schema.type === "array") {
    if (!Array.isArray(value)) {
      throw new Error(`${path}: expected array`);
    }
    for (const [index, item] of value.entries()) {
      validate(schema.items ?? {}, item, `${path}[${index}]`);
    }
    if (schema.requiredWebPlatform && !value.includes("web")) {
      throw new Error(`${path}: must include "web" for Web Preview`);
    }
    return;
  }
  if (schema.type === "string") {
    if (typeof value !== "string") {
      throw new Error(`${path}: expected string`);
    }
    if (schema.minLength != null && value.length < schema.minLength) {
      throw new Error(`${path}: shorter than minLength ${schema.minLength}`);
    }
    if (schema.enum && !schema.enum.includes(value)) {
      throw new Error(`${path}: "${value}" not in enum [${schema.enum}]`);
    }
  }
}

check("app.json satisfies app.schema.json", () => {
  const schema = JSON.parse(readFileSync(join(root, "app.schema.json"), "utf8"));
  const app = JSON.parse(readFileSync(join(root, "app.json"), "utf8"));
  validate(schema, app, "$");
});

check("metro.config.js keeps wasm assetExt", () => {
  const text = readFileSync(join(root, "metro.config.js"), "utf8");
  if (!text.includes("wasm")) {
    throw new Error("wasm assetExt missing (expo-sqlite web needs it)");
  }
});

if (failures.length > 0) {
  console.error(`\n${failures.length} contract check(s) failed.`);
  process.exit(1);
}
console.log("\nAll contract checks passed.");
