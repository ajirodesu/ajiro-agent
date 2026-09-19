import { describe, expect, it } from "vitest";

import {
  hueDelta,
  hslToRgb,
  rgbToHsl,
  SAT_FLOOR,
  shiftPixel,
  SOURCE_HUE,
  THEMED_ICON_VARIANTS,
} from "../../../scripts/themed-icon-specs.mjs";

describe("themed-icon specs", () => {
  it("round-trips rgb through hsl", () => {
    for (const [r, g, b] of [
      [52, 224, 190],
      [218, 119, 86],
      [156, 135, 245],
      [7, 14, 17],
    ]) {
      const { h, s, l } = rgbToHsl(r, g, b);
      const [rr, gg, bb] = hslToRgb(h, s, l);
      expect(Math.abs(rr - r)).toBeLessThanOrEqual(1);
      expect(Math.abs(gg - g)).toBeLessThanOrEqual(1);
      expect(Math.abs(bb - b)).toBeLessThanOrEqual(1);
    }
  });

  it("computes the shortest signed hue delta", () => {
    expect(hueDelta(SOURCE_HUE, 18)).toBe(-154);
    expect(hueDelta(SOURCE_HUE, 252)).toBe(80);
    expect(hueDelta(10, 350)).toBe(-20);
    expect(hueDelta(350, 10)).toBe(20);
  });

  it("shifts saturated pixels and spares near-gray ones", () => {
    const { h: fromHue } = rgbToHsl(52, 224, 190);
    const shifted = shiftPixel(52, 224, 190, hueDelta(fromHue, 18));
    expect(shifted).not.toBeNull();
    const { h } = rgbToHsl(shifted![0], shifted![1], shifted![2]);
    expect(Math.abs(h - 18)).toBeLessThan(2);
    expect(shiftPixel(128, 128, 128, 80)).toBeNull();
    expect(shiftPixel(0, 0, 0, 80)).toBeNull();
  });

  it("declares one default plus uniquely-aliased variants", () => {
    const withAlias = THEMED_ICON_VARIANTS.filter((v) => v.aliasSuffix);
    expect(
      THEMED_ICON_VARIANTS.filter((v) => !v.aliasSuffix).map((v) => v.variant),
    ).toEqual(["aqua"]);
    expect(new Set(withAlias.map((v) => v.aliasSuffix)).size).toBe(
      withAlias.length,
    );
    expect(new Set(withAlias.map((v) => v.file)).size).toBe(withAlias.length);
    expect(SAT_FLOOR).toBeGreaterThan(0);
  });
});
