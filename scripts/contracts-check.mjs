/**
 * Web Preview contract gate (`npm run contracts:check`). Fast static checks,
 * no bundler, no device:
 *
 * 1. `.web.ts(x)` variants export the same value-level surface as native.
 * 2. `app.json` satisfies `app.schema.json` (subset validator below +
 *    custom `requiredWebPlatform` keyword: platforms must include "web").
 * 3. `metro.config.js` keeps the `wasm` assetExt (expo-sqlite web).
 * 4. Themed launcher icons: every spec variant with a file has its PNG,
 *    the plugin is registered, and plugin aliases match the specs.
 *
 * Exit non-zero with the failing check names. Full compile/lint/tests/web
 * export remain separate (`tsc --noEmit`, `expo lint`, `vitest run`,
 * `npm run archive:e2e:web`).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

const pending = [];

function check(name, fn) {
  pending.push(
    (async () => {
      try {
        await fn();
        console.log(`PASS  ${name}`);
      } catch (error) {
        failures.push(name);
        console.error(`FAIL  ${name}: ${error.message}`);
      }
    })(),
  );
}

function valueExports(relativePath) {
  const text = readFileSync(join(root, relativePath), "utf8");
  const names = new Set();
  for (const match of text.matchAll(
    /^export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z0-9_]+)/gm,
  )) {
    names.add(match[1]);
  }
  // Type-level surface (interfaces, type aliases) also drifts: capture it
  // so e.g. a `SecretStore` change on one side cannot pass silently.
  for (const match of text.matchAll(
    /^export\s+(?:interface|type)\s+([A-Za-z0-9_]+)/gm,
  )) {
    names.add(match[1]);
  }
  // Named re-export lists: `export { a, b as c }` (incl. `export type {…}`).
  for (const match of text.matchAll(/^export\s+(?:type\s+)?\{([^}]*)\}/gm)) {
    for (const part of match[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (/^[A-Za-z0-9_]+$/.test(name)) {
        names.add(name);
      }
    }
  }
  // Default exports are a surface of one: record presence so a newly
  // added `export default` on either side is a loud mismatch.
  if (/^export\s+default[ \n{]/m.test(text)) {
    names.add("default");
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

const KNOWN_SCHEMA_KEYS = new Set([
  "type",
  "required",
  "properties",
  "items",
  "enum",
  "minLength",
  "requiredWebPlatform",
  "$schema",
  "$id",
  "title",
  "description",
]);

function validate(schema, value, path) {
  for (const key of Object.keys(schema)) {
    if (!KNOWN_SCHEMA_KEYS.has(key)) {
      // Fail loud instead of silently skipping unsupported keywords.
      throw new Error(`${path}: unsupported schema keyword "${key}"`);
    }
  }
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

check("themed icon PNGs exist for every spec variant", async () => {
  const { THEMED_ICON_VARIANTS } = await import("./themed-icon-specs.mjs");
  for (const spec of THEMED_ICON_VARIANTS.filter((v) => v.file)) {
    for (const file of [
      spec.file,
      spec.file.replace(/^icon-/, "splash-icon-"),
    ]) {
      if (!existsSync(join(root, "assets", "images", file))) {
        throw new Error(
          `missing assets/images/${file} (run npm run vendor:themed-icons)`,
        );
      }
    }
  }
});

check("themed icon plugin registered and in sync with specs", async () => {
  const { THEMED_ICON_VARIANTS } = await import("./themed-icon-specs.mjs");
  const app = JSON.parse(readFileSync(join(root, "app.json"), "utf8"));
  if (!app.expo.plugins.includes("./plugins/with-themed-app-icon")) {
    throw new Error("with-themed-app-icon missing from app.json plugins");
  }
  const plugin = (await import("../plugins/with-themed-app-icon.js")).ALIASES;
  const specAliases = THEMED_ICON_VARIANTS.filter((v) => v.aliasSuffix).map(
    (v) => v.aliasSuffix,
  );
  const pluginAliases = plugin.map((a) => a.suffix);
  if (JSON.stringify([...specAliases].sort()) !== JSON.stringify([...pluginAliases].sort())) {
    throw new Error(
      `alias drift: specs=[${specAliases}] plugin=[${pluginAliases}]`,
    );
  }
});

check("app-icon-switcher module files present", () => {
  for (const file of [
    "modules/app-icon-switcher/package.json",
    "modules/app-icon-switcher/expo-module.config.json",
    "modules/app-icon-switcher/index.ts",
    "modules/app-icon-switcher/android/build.gradle",
    "modules/app-icon-switcher/android/src/main/java/expo/modules/appiconswitcher/AppIconSwitcherModule.kt",
    "src/modules/app-icon/theme-icon-variant.ts",
    "src/modules/app-icon/themed-app-icon.ts",
  ]) {
    if (!existsSync(join(root, file))) {
      throw new Error(`missing ${file}`);
    }
  }
});

await Promise.all(pending);

if (failures.length > 0) {
  console.error(`\n${failures.length} contract check(s) failed.`);
  process.exit(1);
}
console.log("\nAll contract checks passed.");
