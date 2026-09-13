/**
 * Clone input validation (§9). Pure so every failure mode is unit-tested.
 * Never leaves partial state: validation runs before any filesystem or
 * network touch.
 */
export type CloneValidation =
  | { ok: true; host: string; repoName: string }
  | { ok: false; error: string };

export function validateCloneUrl(url: string): CloneValidation {
  const trimmed = url.trim();
  if (!trimmed) {
    return { ok: false, error: "Enter a repository URL." };
  }
  if (/\s/.test(trimmed)) {
    return { ok: false, error: "The URL must not contain spaces." };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: "That is not a valid URL." };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return {
      ok: false,
      error: "Only https:// (or http://) repository URLs are supported.",
    };
  }
  if (parsed.protocol === "http:") {
    return {
      ok: false,
      error: "Use https:// — credentials must never travel over http://.",
    };
  }
  if (!parsed.hostname) {
    return { ok: false, error: "The URL has no host." };
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length < 2) {
    return {
      ok: false,
      error: "The URL must include owner and repository (host/owner/repo).",
    };
  }
  const last = segments[segments.length - 1]!;
  const repoName = last.endsWith(".git") ? last.slice(0, -4) : last;
  if (!/^[A-Za-z0-9_.-]+$/.test(repoName)) {
    return { ok: false, error: "The repository name looks invalid." };
  }
  return { ok: true, host: parsed.hostname.toLowerCase(), repoName };
}

export function validateBranchName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  if (
    trimmed.includes("..") ||
    trimmed.includes(" ") ||
    /[~^:?*[\]\\@{]/.test(trimmed) ||
    trimmed.startsWith("/") ||
    trimmed.startsWith("-") ||
    trimmed.endsWith("/") ||
    trimmed.endsWith(".lock")
  ) {
    return `"${name}" is not a valid branch name.`;
  }
  return null;
}
