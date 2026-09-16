/**
 * Skill import-route detection (Ajiro adaptation of lobehub's
 * `SkillImportRouteInjector`).
 *
 * lobehub classifies skill sources linked in a user message (marketplace
 * pages, SKILL.md URLs, GitHub skill directories, zips) and injects an
 * install ladder into the turn. Ajiro has no marketplace, so this module
 * classifies the remaining three shapes and formats them against Ajiro's
 * own `importSkillFromUrl` tool — same "rule where the decision is made"
 * idea, no user-content mutation, no LobeHub references anywhere.
 */

export type SkillImportRoute =
  | { method: "importSkill"; type: "skill-md" | "github-dir" | "zip"; url: string };

const URL_PATTERN = /https?:\/\/[^\s<>"'`)\]}]+/g;
const TRAILING_PUNCTUATION = new Set("!,.:;?、。：；？");
const SKILL_MD_URL = /\/skill\.md(?:[#?]|$)/i;
const GITHUB_SKILLS_PATH = /^https?:\/\/(?:www\.)?github\.com\/[^\s?#]*\/skills?(?:\/|$)/i;
const GITHUB_URL = /^https?:\/\/(?:www\.)?github\.com\/[\w.-]+\/[\w.-]+/i;
const ZIP_URL = /\.zip(?:[#?]|$)/i;
const INSTALL_INTENT =
  /\binstall(?:s|ing|ed)?\b|\bimport(?:s|ing|ed)?\b|\bset ?up\b|\badd\b/i;
const MAX_ROUTES = 5;

function stripTrailingPunctuation(url: string): string {
  let end = url.length;
  while (end > 0 && TRAILING_PUNCTUATION.has(url[end - 1] ?? "")) end -= 1;
  return url.slice(0, end);
}

function classify(url: string, hasInstallIntent: boolean): SkillImportRoute | null {
  // Unambiguous on any host: a SKILL.md is a skill manifest; a GitHub path
  // with a skills/ segment is a skill directory. No intent needed.
  if (SKILL_MD_URL.test(url)) return { method: "importSkill", type: "skill-md", url };
  if (GITHUB_SKILLS_PATH.test(url)) return { method: "importSkill", type: "github-dir", url };
  // Ambiguous sources only count when the user says so.
  if (!hasInstallIntent) return null;
  if (GITHUB_URL.test(url)) return { method: "importSkill", type: "github-dir", url };
  if (ZIP_URL.test(url)) return { method: "importSkill", type: "zip", url };
  return null;
}

/** Find installable skill sources linked in free text (max 5, deduped). */
export function extractSkillImportRoutes(text: string): SkillImportRoute[] {
  if (!text) return [];
  const hasInstallIntent = INSTALL_INTENT.test(text);
  const routes: SkillImportRoute[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(URL_PATTERN)) {
    const url = stripTrailingPunctuation(match[0]);
    if (seen.has(url)) continue;
    const route = classify(url, hasInstallIntent);
    if (!route) continue;
    seen.add(url);
    routes.push(route);
    if (routes.length >= MAX_ROUTES) break;
  }
  return routes;
}

/**
 * Format detected routes as a system-prompt hint block naming Ajiro's own
 * `importSkillFromUrl` tool (approval-gated like every agent tool). ZIP
 * archives are detected but not installable on mobile — the hint says so
 * instead of sending the model down a failing path.
 */
export function formatSkillImportRoutes(routes: SkillImportRoute[]): string | null {
  if (routes.length === 0) return null;
  const installable = routes.filter((route) => route.type !== "zip");
  const lines = [
    "The user's message links to installable skill sources, already resolved below.",
    "",
    "<detected_skills>",
  ];
  if (installable.length > 0) {
    lines.push(
      ...installable.map(
        (route) => `  <skill url="${route.url}" install="importSkillFromUrl" />`,
      ),
    );
  }
  lines.push("</detected_skills>", "");
  if (installable.length > 0) {
    lines.push(
      "When the user wants one of these installed, call importSkillFromUrl with its url ",
      "before anything else in this turn. Do not crawl the URL for install steps; the tool ",
      "downloads, validates, and installs the SKILL.md plus its referenced files.",
    );
  }
  if (installable.length !== routes.length) {
    lines.push(
      "ZIP skill packages are not supported on mobile: ask the user for a direct SKILL.md link instead.",
    );
  }
  return lines.join("\n");
}
