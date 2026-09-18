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
import { existsSync, readdirSync, statSync } from "node:fs";
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

const dist = join(root, "dist");
gate("dist/index.html", existsSync(join(dist, "index.html")));

const jsDir = join(dist, "_expo", "static", "js", "web");
let bundles = [];
if (existsSync(jsDir)) {
  bundles = readdirSync(jsDir).filter((f) => f.endsWith(".js"));
}
gate("web js bundles", bundles.length > 0, `${bundles.length} file(s)`);

function hasWasm(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (hasWasm(full)) {
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
