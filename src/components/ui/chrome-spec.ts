/**
 * Shared chrome spec — pure constants and color helpers for the screen
 * chrome system (no React Native imports, unit-testable). Components live
 * in `chrome.tsx`.
 */

/** Main/chat header height — every page header matches this exactly. */
export const HEADER_HEIGHT = 64;
/** Single icon container size. */
export const ICON_CONTAINER = 48;
/** Pressable glyph cell inside merged capsules. */
export const ICON_INNER = 40;
/** Standard icon glyph size. */
export const ICON_GLYPH = 20;
/** Standard icon stroke width. */
export const ICON_STROKE = 2;
/** Shared container border thickness (circles, capsules, tabs). */
export const CONTAINER_BORDER = 1;
/** Merged capsule: exactly double the circle width. */
export const CAPSULE_WIDTH = ICON_CONTAINER * 2;
export const CAPSULE_HEIGHT = ICON_CONTAINER;
/** Footer icon size, matching the main page composer controls. */
export const FOOTER_ICON_SIZE = 35;

/** Append an alpha channel to a `#RGB`/`#RRGGBB` hex color. */
export function withAlpha(hex: string, alpha: number): string {
  const clean = hex.trim().replace(/^#/, "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return hex;
  const base = parseInt(full, 16);
  const r = (base >> 16) & 0xff;
  const g = (base >> 8) & 0xff;
  const b = base & 0xff;
  const clamped = Math.min(1, Math.max(0, alpha));
  return `rgba(${r}, ${g}, ${b}, ${clamped})`;
}
