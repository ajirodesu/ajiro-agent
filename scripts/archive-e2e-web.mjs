/**
 * Web end-to-end archive gate (`npm run archive:e2e:web`). Runs the static
 * web export and asserts the expected artifacts exist:
 *
 * - dist/index.html entry
 * - dist/_expo/static/js/web/*.js bundles
 * - a .wasm asset (expo-sqlite wa-sqlite backend)
 *
 * Prints a boot-matrix row per artifact, exits non-zero on any miss. This
 * proves web resolvability (every import in the graph loads); runtime
 * behavior of native fallbacks is covered by unit tests + contracts:check.
 */
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const failures = [];

function gate(name, present, detail = "") {
  const row = `${present ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`;
  console.log(row);
  if (!present) {
    failures.push(name);
  }
}

const dist = join(root, "dist");
// Clean first: without this, stale bundles/wasm from a previous run
// would pass the gates even if the current export emitted nothing.
rmSync(dist, { recursive: true, force: true });

console.log("Running: npx expo export --platform web");
try {
  execSync("npx expo export --platform web", {
    cwd: root,
    stdio: "inherit",
    timeout: 600000,
  });
} catch {
  failures.push("expo export --platform web");
  console.error("\nExport command failed.");
  process.exit(1);
}

gate("dist/index.html", existsSync(join(dist, "index.html")));

const jsDir = join(dist, "_expo", "static", "js", "web");
let bundles = [];
if (existsSync(jsDir)) {
  bundles = readdirSync(jsDir).filter((f) => f.endsWith(".js"));
}
gate("web js bundles", bundles.length > 0, `${bundles.length} file(s)`);

// index.html must actually reference an emitted bundle: existence alone
// could still pass with a stale or truncated export.
let htmlReferencesBundle = false;
try {
  const html = readFileSync(join(dist, "index.html"), "utf8");
  htmlReferencesBundle = bundles.some((name) => {
    const base = name.replace(/\.js$/, "");
    return base.length > 0 && html.includes(base);
  });
} catch {
  htmlReferencesBundle = false;
}
gate("index.html references emitted bundle", htmlReferencesBundle);

function hasWasm(dir, depth = 0) {
  if (depth > 12) {
    return false;
  }
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (hasWasm(full, depth + 1)) {
        return true;
      }
    } else if (entry.endsWith(".wasm")) {
      return true;
    }
  }
  return false;
}
gate(
  "wasm asset (wa-sqlite backend)",
  existsSync(dist) && hasWasm(dist),
);

if (failures.length > 0) {
  console.error(`\n${failures.length} e2e:web gate(s) failed.`);
  process.exit(1);
}
console.log("\nAll e2e:web gates passed.");
