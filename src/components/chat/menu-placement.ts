/**
 * Adaptive menu placement — pure geometry for the message long-press menu
 * (no React Native imports, unit-testable). The menu appears above the
 * anchor when space allows, below it when the anchor is near the top, and
 * vertically centered when neither fits, so it is never cut off. It clamps
 * horizontally inside the screen with an 8pt margin.
 */
export type MenuAnchor = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type MenuPlacement = {
  top: number;
  left: number;
  /** Where the menu ended up, for testing and accessibility. */
  side: "above" | "below" | "center";
};

export function placeMenu(
  anchor: MenuAnchor,
  screen: { width: number; height: number },
  menu: { width: number; height: number },
  align: "start" | "end" = "end",
): MenuPlacement {
  const margin = 8;
  const gap = 12;
  const width = Math.min(menu.width, screen.width - margin * 2);
  const height = Math.min(menu.height, screen.height - margin * 2);
  const left =
    align === "end"
      ? Math.min(
          screen.width - width - margin,
          Math.max(margin, anchor.x + anchor.width - width),
        )
      : Math.min(
          screen.width - width - margin,
          Math.max(margin, anchor.x),
        );
  const aboveTop = anchor.y - gap - height;
  if (aboveTop >= margin) {
    return { top: aboveTop, left, side: "above" };
  }
  const belowTop = anchor.y + anchor.height + gap;
  if (belowTop + height <= screen.height - margin) {
    return { top: belowTop, left, side: "below" };
  }
  return {
    top: Math.max(margin, (screen.height - height) / 2),
    left,
    side: "center",
  };
}
