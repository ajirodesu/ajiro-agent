import { describe, expect, it } from "vitest";

import {
  CAPSULE_GAP,
  CAPSULE_HEIGHT,
  CAPSULE_PADDING,
  CAPSULE_SLOT_WIDTH,
  CAPSULE_TITLE_PADDING,
  CAPSULE_WIDTH,
  CAPSULE_WIDE_WIDTH,
  capsuleWidth,
  CONTAINER_BORDER,
  FOOTER_ICON_SIZE,
  HEADER_HEIGHT,
  ICON_CONTAINER,
  ICON_GLYPH,
  ICON_INNER,
  ICON_STROKE,
  withAlpha,
} from "@/components/ui/chrome-spec";

describe("shared chrome spec", () => {
  it("keeps header, container, and footer dimensions uniform", () => {
    expect(HEADER_HEIGHT).toBe(64);
    expect(ICON_CONTAINER).toBe(48);
    expect(ICON_INNER).toBe(40);
    expect(ICON_GLYPH).toBe(20);
    expect(ICON_STROKE).toBe(2);
    expect(CONTAINER_BORDER).toBe(1);
    expect(CAPSULE_WIDTH).toBe(ICON_CONTAINER * 2);
    expect(CAPSULE_HEIGHT).toBe(ICON_CONTAINER);
    expect(FOOTER_ICON_SIZE).toBe(35);
  });

  it("keeps the title capsule on the same tokens as the icon containers", () => {
    // The header title capsule must match the circular icon container
    // exactly (height + border); the test pins the relationship rather
    // than literal values so the design can evolve in one place.
    expect(CAPSULE_HEIGHT).toBe(ICON_CONTAINER);
    expect(typeof CAPSULE_TITLE_PADDING).toBe("number");
    expect(CAPSULE_TITLE_PADDING).toBeGreaterThan(0);
  });

  it("sizes merged capsules from one slot formula", () => {
    // Two slots (static header capsules) → 96; three slots (the Main/Chat
    // after-chat capsule) → 144, i.e. one circle width per icon.
    expect(capsuleWidth(2)).toBe(CAPSULE_WIDTH);
    expect(capsuleWidth(3)).toBe(CAPSULE_WIDE_WIDTH);
    expect(CAPSULE_WIDE_WIDTH).toBe(ICON_CONTAINER * 3);
    expect(CAPSULE_SLOT_WIDTH).toBe(ICON_INNER + CAPSULE_GAP);
    // Collapsed circle = one slot's icon plus the capsule padding either
    // side, which is what lets a 3-slot capsule animate back to a circle.
    expect(CAPSULE_WIDTH - CAPSULE_PADDING * 2).toBe(
      ICON_INNER * 2 + CAPSULE_GAP,
    );
    expect(ICON_INNER + CAPSULE_PADDING * 2).toBe(ICON_CONTAINER);
  });

  it("derives shadow stops from the theme background", () => {
    expect(withAlpha("#000000", 0.55)).toBe("rgba(0, 0, 0, 0.55)");
    expect(withAlpha("#FFFFFF", 0)).toBe("rgba(255, 255, 255, 0)");
    expect(withAlpha("#abc", 1)).toBe("rgba(170, 187, 204, 1)");
    expect(withAlpha("#0A84FF", 0.18)).toBe("rgba(10, 132, 255, 0.18)");
  });

  it("falls back gracefully for non-hex colors", () => {
    expect(withAlpha("transparent", 0.5)).toBe("transparent");
    expect(withAlpha("red", 0.5)).toBe("red");
    expect(withAlpha("#000000", 5)).toBe("rgba(0, 0, 0, 1)");
    expect(withAlpha("#000000", -2)).toBe("rgba(0, 0, 0, 0)");
  });
});
