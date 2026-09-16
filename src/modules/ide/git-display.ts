/**
 * Pure display helpers for the Git screen: relative timestamps and remote
 * repository URL parsing. No React, no filesystem — fully unit-testable.
 */

/** "22 days ago" style relative time for a unix-epoch-seconds timestamp. */
export function formatRelativeTime(
  timestampSeconds: number,
  nowMs: number = Date.now(),
): string {
  const deltaSeconds = Math.max(
    0,
    Math.floor(nowMs / 1000) - timestampSeconds,
  );
  if (deltaSeconds < 60) return "just now";
  const minutes = Math.floor(deltaSeconds / 60);
  if (minutes < 60) return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return days === 1 ? "1 day ago" : `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return months === 1 ? "1 month ago" : `${months} months ago`;
  const years = Math.floor(days / 365);
  return years === 1 ? "1 year ago" : `${years} years ago`;
}

export type ParsedRemote = {
  host: string;
  owner: string;
  repo: string;
  /** Browser-openable URL (credentials stripped, `.git` trimmed). */
  httpsUrl: string;
};

/**
 * Parse a git remote URL (https, credential-embedded https, ssh scp-style,
 * or ssh://) into owner/repo display parts plus an openable https URL.
 * Returns null when the URL has no usable path.
 */
export function parseRemoteRepo(remoteUrl: string | null): ParsedRemote | null {
  if (!remoteUrl) return null;
  const trimmed = remoteUrl.trim();
  if (!trimmed) return null;

  // scp-style SSH: git@github.com:owner/repo.git
  const scp = /^[\w.-]+@([\w.-]+):(.+)$/.exec(trimmed);
  if (scp) {
    return fromParts(scp[1]!, scp[2]!);
  }
  // ssh://git@github.com/owner/repo.git
  const ssh = /^ssh:\/\/[\w.-]+@([\w.-]+)(?::\d+)?\/(.+)$/.exec(trimmed);
  if (ssh) {
    return fromParts(ssh[1]!, ssh[2]!);
  }
  try {
    const parsed = new URL(trimmed);
    if (!/^https?:$/.test(parsed.protocol)) return null;
    return fromParts(parsed.hostname, parsed.pathname);
  } catch {
    return null;
  }
}

function fromParts(host: string, path: string): ParsedRemote | null {
  const segments = path
    .replace(/\.git$/, "")
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  if (segments.length < 2) return null;
  const owner = segments[segments.length - 2]!;
  const repo = segments[segments.length - 1]!;
  return {
    host,
    owner,
    repo,
    httpsUrl: `https://${host}/${owner}/${repo}`,
  };
}
