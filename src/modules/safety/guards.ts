/**
 * Security guards (§§96-97): path-traversal validation, secret redaction for
 * logs/tool output/model context, and package-install gating notes. The exec
 * surface takes stable command IDs (no shell), so injection collapses to
 * argument validation at each tool boundary.
 *
 * Source provenance: [AJIRO ORIGINAL]; patterns follow [ANTHROPIC OPEN
 * SOURCE] sandbox-runtime dual-isolation thinking (constrain reads, gate
 * writes) adapted to Android dispatch-layer enforcement.
 */

const SECRET_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: "api-key", pattern: /(api[_-]?key\s*[:=]\s*)(["']?)([^"'\s,;}]{8,})/gi },
  { name: "bearer", pattern: /(bearer\s+)([A-Za-z0-9\-._~+/=]{12,})/gi },
  { name: "secret", pattern: /(secret\s*[:=]\s*)(["']?)([^"'\s,;}]{8,})/gi },
  { name: "token", pattern: /(token\s*[:=]\s*)(["']?)([^"'\s,;}]{8,})/gi },
  { name: "password", pattern: /(password\s*[:=]\s*)(["']?)([^"'\s,;}]{4,})/gi },
  { name: "private-key", pattern: /(-----BEGIN [A-Z ]*PRIVATE KEY-----)/g },
  { name: "github-token", pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}/g },
  { name: "openai-key", pattern: /\bsk-(proj-)?[A-Za-z0-9]{16,}/g },
];

/** Redact likely secrets; safe to run on logs, tool output, and context. */
export function redactSecrets(text: string): string {
  let redacted = text;
  for (const { pattern } of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, (match, ...groups) => {
      if (match.startsWith("-----BEGIN") || /^[a-z]{2,}_/.test(match) || match.startsWith("sk-")) {
        return "[REDACTED]";
      }
      const prefix = typeof groups[0] === "string" ? groups[0] : "";
      const quote = typeof groups[1] === "string" ? groups[1] : "";
      return `${prefix}${quote}[REDACTED]`;
    });
  }
  return redacted;
}

/**
 * Validate a project-relative path: rejects absolute paths, drive letters,
 * parent traversal, null bytes, and blank segments. Returns the normalized
 * path or throws.
 */
export function validateProjectPath(path: string): string {
  if (!path || typeof path !== "string") {
    throw new Error("Path must be a non-empty string.");
  }
  if (path.includes("\0")) {
    throw new Error("Path contains a null byte.");
  }
  const normalized = path.replace(/\\/g, "/");
  if (
    normalized.startsWith("/") ||
    /^[a-zA-Z]:/.test(normalized) ||
    normalized.startsWith("~")
  ) {
    throw new Error(`Absolute paths are not allowed: ${path}.`);
  }
  const segments = normalized.split("/");
  for (const segment of segments) {
    if (segment === "..") {
      throw new Error(`Parent traversal is not allowed: ${path}.`);
    }
  }
  const cleaned = segments.filter((segment) => segment !== "" && segment !== ".").join("/");
  if (!cleaned) {
    throw new Error(`Path resolves to the project root itself: ${path}.`);
  }
  return cleaned;
}

/** True when a host is restricted (loopback/link-local/metadata). */
export function isRestrictedHost(host: string): boolean {
  const lower = host.toLowerCase();
  if (lower === "localhost" || lower.endsWith(".localhost")) return true;
  if (lower === "127.0.0.1" || lower === "::1" || lower === "[::1]") return true;
  if (/^10\./.test(lower) || /^192\.168\./.test(lower)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(lower)) return true;
  if (lower === "169.254.169.254") return true; // cloud metadata
  return false;
}
