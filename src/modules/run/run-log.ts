/**
 * Run console support — pure helpers for the project runner.
 *
 * - `stripAnsi` cleans PTY output (colors, cursor moves, OSC sequences)
 *   for the plain-text Console view.
 * - `detectServerUrl` spots the dev server's printed URL (`Local:
 *   http://localhost:5173`, bare `http://127.0.0.1:3000`, …). Unroutable
 *   `0.0.0.0` hosts are normalized to `127.0.0.1`.
 * - `shellQuote` safely embeds host paths in the `cd … && …` launch line.
 * - `appendCapped` maintains the Console ring buffer.
 */
const ANSI_PATTERN =
  /[\u001B\u009B][[\]()#;?]*(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PRZcf-ntqry=><~]|\u0007|\r(?!\n)/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

const URL_PATTERN =
  /https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])(?::(\d+))?(\/[^\s]*)?/i;
const LOCAL_LINE_PATTERN =
  /local:\s*(https?:\/\/[^\s]+)/i;

export interface DetectedServer {
  url: string;
  port: number | null;
}

export function detectServerUrl(text: string): DetectedServer | null {
  const lined = LOCAL_LINE_PATTERN.exec(text);
  const raw = lined?.[1] ?? URL_PATTERN.exec(text)?.[0] ?? null;
  if (!raw) return null;
  const normalized = raw.replace(
    /^https?:\/\/(0\.0\.0\.0|\[::\]?)/i,
    (match) => match.replace(/0\.0\.0\.0|\[::\]?/, "127.0.0.1"),
  );
  const portMatch = /:(\d+)(?:\/|$)/.exec(normalized);
  return {
    url: normalized.replace(/\/$/, ""),
    port: portMatch ? Number.parseInt(portMatch[1]!, 10) : null,
  };
}

/** Single-quote a host path for `sh` (handles embedded quotes). */
export function shellQuote(path: string): string {
  return `'${path.replace(/'/g, `'\\''`)}'`;
}

export interface ShareLink {
  url: string;
  /** `lan` = reachable across the local network; `local` = this device. */
  scope: "lan" | "local";
}

function isUsableLanIp(ip: string | null): ip is string {
  if (!ip) return false;
  const clean = ip.trim();
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(clean)) return false;
  if (clean === "0.0.0.0" || clean === "127.0.0.1") return false;
  return clean.split(".").every((part) => Number(part) <= 255);
}

/** Prefer the LAN address (genuinely shareable); fall back to loopback. */
export function buildShareLink(
  lanIp: string | null,
  port: number,
): ShareLink {
  if (isUsableLanIp(lanIp)) {
    return { url: `http://${lanIp!.trim()}:${port}`, scope: "lan" };
  }
  return { url: `http://127.0.0.1:${port}`, scope: "local" };
}

/** Append PTY text to the Console buffer, keeping at most `maxLines`. */
export function appendCapped(
  lines: string[],
  chunk: string,
  maxLines: number,
): string[] {
  if (!chunk) return lines;
  const next = [...lines, chunk];
  return next.length > maxLines
    ? next.slice(next.length - maxLines)
    : next;
}
