/**
 * Themed launcher-icon specs shared by the generator
 * (`scripts/make-themed-icons.mjs`) and unit tests. Pure ESM, no deps.
 *
 * Strategy: the shipped artwork is an aqua (~172°) glow on near-black
 * teal. Each variant hue-rotates the artwork toward its theme primary so
 * glow AND background stay coherent. Near-gray pixels (saturation below
 * SAT_FLOOR) and near-black pixels (range below RANGE_FLOOR) keep their
 * hue to avoid noise/artifacts.
 */
export const SOURCE_HUE = 172;

export const SAT_FLOOR = 0.08;
export const RANGE_FLOOR = 6;

export const THEMED_ICON_VARIANTS = [
  { variant: "aqua", hue: 172, aliasSuffix: null, file: null },
  { variant: "burnt", hue: 18, aliasSuffix: "ThemedIconBurnt", file: "icon-burnt.png" },
  { variant: "indigo", hue: 252, aliasSuffix: "ThemedIconIndigo", file: "icon-indigo.png" },
  { variant: "dark", hue: 217, aliasSuffix: "ThemedIconDark", file: "icon-dark.png" },
  { variant: "light", hue: 200, aliasSuffix: "ThemedIconLight", file: "icon-light.png" },
];

/** Shortest signed hue delta in degrees, range (-180, 180]. */
export function hueDelta(fromHue, toHue) {
  return ((((toHue - fromHue) % 360) + 540) % 360) - 180;
}

export function rgbToHsl(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const range = max - min;
  const light = (max + min) / 2;
  if (range === 0) {
    return { h: 0, s: 0, l: light };
  }
  const sat = light > 0.5 ? range / (2 - max - min) : range / (max + min);
  let hue = 0;
  if (max === rn) {
    hue = ((gn - bn) / range + (gn < bn ? 6 : 0)) * 60;
  } else if (max === gn) {
    hue = ((bn - rn) / range + 2) * 60;
  } else {
    hue = ((rn - gn) / range + 4) * 60;
  }
  return { h: hue, s: sat, l: light };
}

export function hslToRgb(h, s, l) {
  const hue = ((h % 360) + 360) % 360;
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const hk = hue / 360;
  return [
    Math.round(channel(hk + 1 / 3) * 255),
    Math.round(channel(hk) * 255),
    Math.round(channel(hk - 1 / 3) * 255),
  ];
}

/**
 * Shift one pixel toward the target hue. Returns null when the pixel must
 * be left untouched (near-gray or near-black).
 */
export function shiftPixel(r, g, b, delta) {
  const range = Math.max(r, g, b) - Math.min(r, g, b);
  if (range < RANGE_FLOOR) {
    return null;
  }
  const { h, s, l } = rgbToHsl(r, g, b);
  if (s < SAT_FLOOR) {
    return null;
  }
  return hslToRgb(h + delta, s, l);
}
