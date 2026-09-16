/**
 * Vendor git-provider brand marks for the Git Settings screen.
 *
 * - Reads the official `simple-icons` brand data (GitHub, Bitbucket,
 *   GitLab) and writes it to `src/git-providers/providerIcons.ts` —
 *   the SOLE brand-asset source at runtime.
 * - Copies the SVGs into `assets/git-providers/` so the marks are
 *   self-hosted; nothing is fetched from a CDN at runtime.
 * - GitHub renders theme-aware (white on dark themes, near-black on
 *   light); Bitbucket/GitLab keep their official brand colors.
 *
 * Usage: `npm run vendor:git-providers` (run after `npm install` and
 * whenever the simple-icons dependency is upgraded).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const require = createRequire(join(root, "package.json"));

const simpleIcons = require("simple-icons");

const SLUGS = ["github", "bitbucket", "gitlab"];

const brands = {};
for (const slug of SLUGS) {
  const key = `si${slug[0].toUpperCase()}${slug.slice(1)}`;
  const icon = simpleIcons[key];
  if (!icon || !icon.path || !icon.hex) {
    throw new Error(`simple-icons has no brand data for "${slug}"`);
  }
  brands[slug] = { title: icon.title, hex: icon.hex, path: icon.path };
}

const assetsDir = join(root, "assets", "git-providers");
mkdirSync(assetsDir, { recursive: true });
for (const [slug, brand] of Object.entries(brands)) {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">` +
    `<path d="${brand.path}"/></svg>`;
  writeFileSync(join(assetsDir, `${slug}.svg`), svg);
}

const out = `/**
 * GENERATED — do not edit by hand. Run \`npm run vendor:git-providers\`.
 * Official simple-icons brand data for the Git Settings connections list.
 * Self-hosted SVGs live in \`assets/git-providers/\`; runtime rendering
 * uses the inline paths below. No CDN, no runtime network fetch.
 */
export type GitProviderSlug = ${SLUGS.map((slug) => `"${slug}"`).join(" | ")};
export const PROVIDER_BRANDS: Record<
  GitProviderSlug,
  { title: string; hex: string; path: string }
> = ${JSON.stringify(brands, null, 2)};
`;

const outPath = join(root, "src", "git-providers", "providerIcons.ts");
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, out);
console.log("git provider brands vendored: src/git-providers/providerIcons.ts");
console.log(`  providers: ${Object.keys(brands).join(", ")}`);
