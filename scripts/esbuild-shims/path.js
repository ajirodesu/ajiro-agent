/**
 * Minimal POSIX `path` for the offline bundle (see os.js header). Only
 * what module-scope compiler code can touch; project path logic lives in
 * the intel modules with their own tested implementation.
 */
export const sep = "/";
export const delimiter = ":";
export const posix = null;

export function normalize(path) {
  const absolute = path.startsWith("/");
  const parts = path.split("/");
  const out = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return (absolute ? "/" : "") + out.join("/");
}

export function join(...parts) {
  return normalize(parts.join("/"));
}

export function dirname(path) {
  const index = path.replace(/\/$/, "").lastIndexOf("/");
  if (index < 0) return ".";
  if (index === 0) return "/";
  return path.slice(0, index);
}

export function basename(path, ext) {
  const base = path.split("/").pop() ?? "";
  return ext && base.endsWith(ext) ? base.slice(0, -ext.length) : base;
}

export function extname(path) {
  const base = basename(path);
  const index = base.lastIndexOf(".");
  return index > 0 ? base.slice(index) : "";
}

export function resolve(...parts) {
  let resolved = "";
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const part = parts[i];
    if (typeof part !== "string" || part === "") continue;
    resolved = resolved ? `${part}/${resolved}` : part;
    if (part.startsWith("/")) break;
  }
  return normalize(resolved ? `/${resolved}` : "/");
}

export default { sep, delimiter, normalize, join, dirname, basename, extname, resolve };
