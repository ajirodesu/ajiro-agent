import { describe, expect, it } from "vitest";

import {
  DESKTOP_BREAKPOINT,
  expandedSidebarWidth,
  layoutModeForWidth,
  SIDEBAR_COMPACT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  sidebarWidthForState,
  TABLET_BREAKPOINT,
} from "@/components/ui/responsive";

describe("responsive breakpoints", () => {
  it("uses the documented thresholds", () => {
    expect(TABLET_BREAKPOINT).toBe(768);
    expect(DESKTOP_BREAKPOINT).toBe(1280);
  });

  it("maps phones, tablets, and desktops by viewport width", () => {
    expect(layoutModeForWidth(360)).toBe("mobile");
    expect(layoutModeForWidth(767)).toBe("mobile");
    expect(layoutModeForWidth(768)).toBe("tablet");
    expect(layoutModeForWidth(1024)).toBe("tablet");
    expect(layoutModeForWidth(1279)).toBe("tablet");
    expect(layoutModeForWidth(1280)).toBe("desktop");
    expect(layoutModeForWidth(1920)).toBe("desktop");
    expect(layoutModeForWidth(3440)).toBe("desktop");
  });

  it("fails closed to mobile on nonsense input", () => {
    expect(layoutModeForWidth(Number.NaN)).toBe("mobile");
    expect(layoutModeForWidth(-100)).toBe("mobile");
  });
});

describe("sidebar widths", () => {
  it("scales proportionally within usable bounds", () => {
    // Narrow tablet window: floored, never crowding content out.
    expect(expandedSidebarWidth(768)).toBe(SIDEBAR_MIN_WIDTH);
    // Mid tablet: proportional.
    expect(expandedSidebarWidth(1024)).toBe(307);
    // Desktop and ultrawide: capped.
    expect(expandedSidebarWidth(1280)).toBe(SIDEBAR_MAX_WIDTH);
    expect(expandedSidebarWidth(3440)).toBe(SIDEBAR_MAX_WIDTH);
    for (const width of [320, 600, 834, 1024, 1440, 2560]) {
      const sidebar = expandedSidebarWidth(width);
      expect(sidebar).toBeGreaterThanOrEqual(SIDEBAR_MIN_WIDTH);
      expect(sidebar).toBeLessThanOrEqual(SIDEBAR_MAX_WIDTH);
      expect(sidebar).toBeLessThan(width);
    }
  });

  it("falls back to the minimum on nonsense input", () => {
    expect(expandedSidebarWidth(0)).toBe(SIDEBAR_MIN_WIDTH);
    expect(expandedSidebarWidth(Number.NaN)).toBe(SIDEBAR_MIN_WIDTH);
  });

  it("resolves compact to the fixed icon rail", () => {
    expect(SIDEBAR_COMPACT_WIDTH).toBe(76);
    expect(sidebarWidthForState(1440, true)).toBe(SIDEBAR_COMPACT_WIDTH);
    expect(sidebarWidthForState(1440, false)).toBe(
      expandedSidebarWidth(1440),
    );
  });

  it("fits 48px rail buttons inside the compact rail gutters", () => {
    // The persistent panel uses px-sp-2 (8px) gutters when compact; rail
    // buttons are 48px wide. If either constant changes, this test forces
    // the fit to be re-checked instead of silently clipping icons.
    const compactGutter = 8;
    const railButton = 48;
    expect(SIDEBAR_COMPACT_WIDTH - compactGutter * 2).toBeGreaterThanOrEqual(
      railButton,
    );
  });
});
