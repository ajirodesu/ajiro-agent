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
/** Horizontal padding inside merged capsules (one slot's worth of circle). */
export const CAPSULE_PADDING = 4;
/** Gap between icon slots inside a merged capsule. */
export const CAPSULE_GAP = 8;
/**
 * Width of a merged capsule holding `slots` icons: padding on both ends plus
 * every icon and the gaps between them. Keeps multi-slot capsules (2-slot
 * header capsules, the 3-slot Main/Chat after-chat capsule) on one formula
 * so the icon rhythm never drifts from `ICON_CONTAINER`.
 */
export function capsuleWidth(slots: number): number {
  return CAPSULE_PADDING * 2 + slots * ICON_INNER + (slots - 1) * CAPSULE_GAP;
}
/** Merged capsule: exactly double the circle width (two icon slots). */
export const CAPSULE_WIDTH = capsuleWidth(2);
export const CAPSULE_HEIGHT = ICON_CONTAINER;
/**
 * Comfortable horizontal padding inside the centered page-header title
 * capsule. Text-only (no icon slots), so it uses its own breathing room
 * rather than the icon-slot padding — height and border still match the
 * circle containers exactly.
 */
export const CAPSULE_TITLE_PADDING = 20;
/** Three-slot capsule (Main/Chat after-chat): three merged icon containers. */
export const CAPSULE_WIDE_WIDTH = capsuleWidth(3);
/** One revealed slot inside an animated capsule (icon + its trailing gap). */
export const CAPSULE_SLOT_WIDTH = ICON_INNER + CAPSULE_GAP;
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
