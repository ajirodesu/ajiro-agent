/**
 * Centralized responsive layout system.
 *
 * One breakpoint source for the whole app: viewport width in logical
 * pixels (via `useWindowDimensions`, so orientation changes, window
 * resizes, foldables, and desktop windows all re-evaluate live) maps onto
 * exactly three layout modes — mobile, tablet, desktop. No device-model
 * checks, no manufacturer branches, no fixed-resolution assumptions.
 *
 * Breakpoints:
 * - mobile:  width < 768   (phones, narrow windows, folded foldables)
 * - tablet:  768 ≤ width < 1280 (tablets portrait/landscape, small laptops)
 * - desktop: width ≥ 1280  (laptops, monitors, ultrawide)
 *
 * 768 is the classic tablet-portrait threshold; 1280 is the small-laptop
 * threshold where a persistent sidebar stops crowding content. Widths
 * between the lines scale continuously — components should prefer the
 * width helpers and flexbox over branching wherever possible.
 */

export type LayoutMode = "desktop" | "mobile" | "tablet";

/** Viewport widths below this use the mobile layout. */
export const TABLET_BREAKPOINT = 768;
/** Viewport widths at/above this use the desktop layout. */
export const DESKTOP_BREAKPOINT = 1280;

/** Expanded sidebar bounds: 30% of the viewport, clamped to usable limits. */
export const SIDEBAR_WIDTH_FRACTION = 0.3;
export const SIDEBAR_MIN_WIDTH = 240;
export const SIDEBAR_MAX_WIDTH = 340;
/** Compact icon-rail width: fits a 22px icon with comfortable padding. */
export const SIDEBAR_COMPACT_WIDTH = 76;

/** Pure mapping, unit-tested: viewport width → layout mode. */
export function layoutModeForWidth(viewportWidth: number): LayoutMode {
  if (!Number.isFinite(viewportWidth) || viewportWidth < 0) return "mobile";
  if (viewportWidth < TABLET_BREAKPOINT) return "mobile";
  if (viewportWidth < DESKTOP_BREAKPOINT) return "tablet";
  return "desktop";
}

/**
 * Expanded sidebar width for a viewport: proportional, never narrower than
 * touch-usable, never wider than needed — so narrow tablet windows are not
 * consumed and ultrawide displays do not stretch navigation.
 */
export function expandedSidebarWidth(viewportWidth: number): number {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) {
    return SIDEBAR_MIN_WIDTH;
  }
  const proportional = Math.round(viewportWidth * SIDEBAR_WIDTH_FRACTION);
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, proportional));
}

/** Sidebar width for a compact flag; the rail is a fixed, fitted width. */
export function sidebarWidthForState(
  viewportWidth: number,
  compact: boolean,
): number {
  return compact ? SIDEBAR_COMPACT_WIDTH : expandedSidebarWidth(viewportWidth);
}
