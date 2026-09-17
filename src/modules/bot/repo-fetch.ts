/**
 * Repository fetching — resolve an importable command repository URL into
 * `.md` interchange files.
 *
 * Supports:
 * - direct raw `.md` URLs (fetched as a single file),
 * - GitHub `owner/repo` (or full github.com URLs): downloads the branch
 *   zipball (`main`, then `master`) and extracts every `.md` file.
 *
 * Only `.md` files are returned; traversal-unsafe entries are skipped.
 */
import { fetchWithTimeout } from "@/core/fetch-with-timeout";
import { crc32, inflateRaw } from "@/modules/extensions/zip";

export type RepoMdFile = { path: string; content: string };

function parseGitHubRepo(url: string): { owner: string; repo: string } | null {
  const trimmed = url.trim().replace(/\/+$/, "").replace(/\.git$/, "");
  const m = trimmed.match(/github\.com\/([^/]+)\/([^/]+)/i) ?? trimmed.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (!m) return null;
  const owner = m[1]?.trim();
  const repo = m[2]?.trim();
  if (!owner || !repo) return null;
  return { owner, repo };
}

function isSafePath(name: string): boolean {
  if (name.includes("\\") || name.startsWith("/") || name.includes("\0")) return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(name)) return false;
  return !name.split("/").includes("..");
}

function readU16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function readU32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

/** Extract every `.md` file from a zip archive (STORE + DEFLATE). */
export function extractMdFromZip(bytes: Uint8Array): RepoMdFile[] {
  const out: RepoMdFile[] = [];
  if (bytes.length < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return out;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Find EOCD.
  let eocd = -1;
  const min = Math.max(0, bytes.length - 66_000);
  for (let i = bytes.length - 22; i >= min; i -= 1) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) return out;
  const entryCount = readU16(view, eocd + 10);
  const cdOffset = readU32(view, eocd + 16);
  const decoder = new TextDecoder();
  let offset = cdOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > bytes.length || readU32(view, offset) !== 0x02014b50) break;
    const method = readU16(view, offset + 10);
    const crc = readU32(view, offset + 16);
    const compressedSize = readU32(view, offset + 20);
    const size = readU32(view, offset + 24);
    const nameLength = readU16(view, offset + 28);
    const extraLength = readU16(view, offset + 30);
    const commentLength = readU16(view, offset + 32);
    const localOffset = readU32(view, offset + 42);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;
    if (!name.toLowerCase().endsWith(".md") || !isSafePath(name)) continue;
    if (size > 512 * 1024) continue;
    if (localOffset + 30 > bytes.length || readU32(view, localOffset) !== 0x04034b50) continue;
    const localNameLen = readU16(view, localOffset + 26);
    const localExtraLen = readU16(view, localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    if (dataStart + compressedSize > bytes.length) continue;
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
    let data: Uint8Array;
    try {
      if (method === 0) data = compressed.slice();
      else if (method === 8) data = inflateRaw(compressed, size);
      else continue;
    } catch {
      continue;
    }
    if (crc32(data) !== crc) continue;
    // Strip a single top-level folder (GitHub archive zips).
    const segments = name.split("/").filter((s) => s && s !== ".");
    const path = segments.length > 1 ? segments.slice(1).join("/") : segments.join("/");
    out.push({ path: path || name, content: decoder.decode(data) });
  }
  return out;
}

export async function fetchRepositoryMdFiles(repoUrl: string): Promise<RepoMdFile[]> {
  const trimmed = repoUrl.trim();
  if (/\.md(\?.*)?$/i.test(trimmed) && /^https?:\/\//i.test(trimmed)) {
    const res = await fetchWithTimeout(trimmed, {}, 15000);
    if (!res.ok) throw new Error(`Could not fetch ${trimmed} (HTTP ${res.status}).`);
    const text = await res.text();
    const name = trimmed.split("/").pop()?.split("?")[0] ?? "command.md";
    return [{ path: name, content: text }];
  }
  const parsed = parseGitHubRepo(trimmed);
  if (!parsed) throw new Error("Enter a GitHub repository (owner/repo or full URL) or a direct .md URL.");
  let lastError: unknown = null;
  for (const branch of ["main", "master"]) {
    const zipUrl = `https://github.com/${parsed.owner}/${parsed.repo}/archive/refs/heads/${branch}.zip`;
    try {
      const res = await fetchWithTimeout(zipUrl, {}, 30000);
      if (!res.ok) {
        lastError = new Error(`HTTP ${res.status}`);
        continue;
      }
      const buffer = new Uint8Array(await res.arrayBuffer());
      const files = extractMdFromZip(buffer);
      if (files.length === 0) throw new Error("No .md command configs found in this repository.");
      return files;
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(
    `Could not import ${parsed.owner}/${parsed.repo}: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}
