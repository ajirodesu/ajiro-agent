/**
 * File-type icon resolution — the SOLE mapping between file names and
 * material-icon-theme icons.
 *
 * Everything is driven by the vendored official manifest data
 * (`fileIconManifest.ts`, generated from `generateManifest()`): no
 * extension list, filename list, or icon mapping is hardcoded here. Any
 * file type the manifest supports resolves automatically.
 *
 * Priority per file:
 *   1. Exact file name match (`dockerfile`, `package.json`, `.gitignore`).
 *   2. Compound/multi-part extension match, longest first
 *      (`component.test.tsx` → `test.tsx` before `tsx`).
 *   3. Standard single trailing extension (`ts`, `pdf`, `mp3`, `png`).
 *   4. The manifest's generic default file icon.
 */
import {
  FILE_ICON_DEFAULT,
  FILE_ICON_FILES,
  FILE_ICON_FILE_EXTENSIONS,
  FILE_ICON_FILE_NAMES,
  FILE_ICON_SVGS,
} from "@/file-icons/fileIconManifest";

/** Icon name for a file path, falling back to the default file icon. */
export function iconNameForFile(path: string): string {
  const base = path.split("/").pop() ?? path;
  const lower = base.toLowerCase();
  const exact = FILE_ICON_FILE_NAMES[lower];
  if (exact) return exact;
  const parts = lower.split(".");
  if (parts.length > 2) {
    for (let index = 1; index < parts.length - 1; index += 1) {
      const compound = parts.slice(index).join(".");
      const hit = FILE_ICON_FILE_EXTENSIONS[compound];
      if (hit) return hit;
    }
  }
  if (parts.length > 1) {
    const extension = parts[parts.length - 1]!;
    const hit = FILE_ICON_FILE_EXTENSIONS[extension];
    if (hit) return hit;
  }
  return FILE_ICON_DEFAULT;
}

/**
 * Inline SVG XML for an icon name, falling back to the default file icon
 * art. Returns null only when even the default art is missing (the caller
 * then renders its own last-resort glyph, so a row is never icon-less).
 */
export function svgForIcon(iconName: string): string | null {
  const file =
    FILE_ICON_FILES[iconName] ?? FILE_ICON_FILES[FILE_ICON_DEFAULT];
  if (!file) return null;
  return FILE_ICON_SVGS[file] ?? null;
}

/** Inline SVG XML for a file path, with default-icon fallback built in. */
export function svgForFile(path: string): string | null {
  return svgForIcon(iconNameForFile(path));
}
