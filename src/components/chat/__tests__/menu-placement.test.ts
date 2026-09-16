import { describe, expect, it } from "vitest";

import { placeMenu } from "@/components/chat/menu-placement";

const SCREEN = { width: 390, height: 844 };
const MENU = { width: 240, height: 300 };

describe("placeMenu", () => {
  it("places the menu above roomy anchors", () => {
    const placed = placeMenu(
      { x: 150, y: 500, width: 200, height: 60 },
      SCREEN,
      MENU,
    );
    expect(placed.side).toBe("above");
    expect(placed.top).toBe(500 - 12 - 300);
  });

  it("places the menu below anchors near the top", () => {
    const placed = placeMenu(
      { x: 150, y: 40, width: 200, height: 60 },
      SCREEN,
      MENU,
    );
    expect(placed.side).toBe("below");
    expect(placed.top).toBe(40 + 60 + 12);
  });

  it("centers the menu when neither side fits", () => {
    const placed = placeMenu(
      { x: 0, y: 300, width: 390, height: 60 },
      SCREEN,
      { width: 240, height: 800 },
    );
    expect(placed.side).toBe("center");
    expect(placed.top).toBeGreaterThanOrEqual(8);
  });

  it("right-aligns to the anchor and clamps inside the screen", () => {
    const placed = placeMenu(
      { x: 150, y: 500, width: 200, height: 60 },
      SCREEN,
      MENU,
      "end",
    );
    expect(placed.left).toBe(150 + 200 - 240);
    const wide = placeMenu(
      { x: 300, y: 500, width: 200, height: 60 },
      { width: 390, height: 844 },
      { width: 500, height: 100 },
      "end",
    );
    expect(wide.left).toBe(8);
  });

  it("left-aligns to the anchor leading edge", () => {
    const placed = placeMenu(
      { x: 20, y: 500, width: 200, height: 60 },
      SCREEN,
      MENU,
      "start",
    );
    expect(placed.left).toBe(20);
  });
});
