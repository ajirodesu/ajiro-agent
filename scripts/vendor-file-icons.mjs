/**
 * Vendor material-icon-theme assets for offline, self-hosted file icons.
 *
 * - Calls the package's `generateManifest()` (the official filename /
 *   extension → icon-name mapping) and writes it to
 *   `src/file-icons/fileIconManifest.ts` — the SOLE icon data source at
 *   runtime. No extension/filename list is ever hardcoded in app code.
 * - Copies every SVG referenced by the manifest from the package's
 *   `icons/` folder into `assets/file-icons/` and inlines the XML into the
 *   generated module, so icons render with zero network access.
 *
 * Usage: `npm run vendor:file-icons` (run after `npm install` and whenever
 * the material-icon-theme dependency is upgraded).
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const require = createRequire(join(root, "package.json"));

const { generateManifest } = require("material-icon-theme");
const manifest = generateManifest();

const fileNames = manifest.fileNames ?? {};
const fileExtensions = manifest.fileExtensions ?? {};
const iconDefinitions = manifest.iconDefinitions ?? {};
const defaultIcon = manifest.file ?? "file";

const referenced = new Set([
  ...Object.values(fileNames),
  ...Object.values(fileExtensions),
  defaultIcon,
]);
for (const name of [...referenced]) {
  if (!iconDefinitions[name]) {
    throw new Error(`icon "${name}" referenced by manifest has no definition`);
  }
}

const assetsDir = join(root, "assets", "file-icons");
mkdirSync(assetsDir, { recursive: true });

const packageIconsDir = join(
  root,
  "node_modules",
  "material-icon-theme",
  "icons",
);

/** icon name → self-hosted file name (e.g. `docker` → `docker.svg`). */
const files = {};
/** self-hosted file name → inline SVG XML. */
const svgs = {};
for (const name of [...referenced].sort()) {
  const iconPath = iconDefinitions[name].iconPath;
  const file = basename(iconPath);
  if (!file.endsWith(".svg")) {
    throw new Error(`icon "${name}" does not point at an SVG (${iconPath})`);
  }
  files[name] = file;
  const source = join(packageIconsDir, file);
  copyFileSync(source, join(assetsDir, file));
  if (!svgs[file]) {
    svgs[file] = readFileSync(source, "utf8");
  }
}

// Local overrides (`assets/file-icons/overrides.json`): app-owned icons
// layered on top of the official manifest without touching it.
const overrides = JSON.parse(
  readFileSync(join(assetsDir, "overrides.json"), "utf8"),
);
for (const [extension, iconName] of Object.entries(
  overrides.extensions ?? {},
)) {
  const target = join(assetsDir, overrides.files[iconName]);
  try {
    readFileSync(target, "utf8");
  } catch {
    throw new Error(
      `local icon override "${iconName}" is missing ${overrides.files[iconName]}`,
    );
  }
  fileExtensions[extension] = iconName;
}
for (const [fileName, iconName] of Object.entries(
  overrides.fileNames ?? {},
)) {
  fileNames[fileName] = iconName;
}
for (const [iconName, file] of Object.entries(overrides.files ?? {})) {
  files[iconName] = file;
  if (!svgs[file]) {
    svgs[file] = readFileSync(join(assetsDir, file), "utf8");
  }
}

const out = `/**
 * GENERATED — do not edit by hand. Run \`npm run vendor:file-icons\`.
 * Official material-icon-theme manifest data (via \`generateManifest()\`)
 * plus the self-hosted SVG assets from \`assets/file-icons/\`. Fully
 * offline: no CDN, no runtime network fetch.
 */
export const FILE_ICON_DEFAULT = ${JSON.stringify(defaultIcon)};
/** Exact file name (lowercase) → icon name. */
export const FILE_ICON_FILE_NAMES: Record<string, string> = ${JSON.stringify(fileNames)};
/** Extension (lowercase, compound included) → icon name. */
export const FILE_ICON_FILE_EXTENSIONS: Record<string, string> = ${JSON.stringify(fileExtensions)};
/** Icon name → self-hosted file in \`assets/file-icons/\`. */
export const FILE_ICON_FILES: Record<string, string> = ${JSON.stringify(files)};
/** Self-hosted file → inline SVG XML. */
export const FILE_ICON_SVGS: Record<string, string> = ${JSON.stringify(svgs)};
`;

const outPath = join(root, "src", "file-icons", "fileIconManifest.ts");
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, out);
console.log("file icons vendored: src/file-icons/fileIconManifest.ts");
console.log(`  icons: ${Object.keys(files).length}`);
console.log(`  file names: ${Object.keys(fileNames).length}`);
console.log(`  extensions: ${Object.keys(fileExtensions).length}`);
