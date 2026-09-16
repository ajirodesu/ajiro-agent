import { describe, expect, it } from "vitest";

import {
  CAPSULE_HEIGHT,
  CAPSULE_WIDTH,
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
