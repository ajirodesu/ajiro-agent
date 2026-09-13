/**
 * Packed cell colors/attributes. foreground/background are 32-bit numbers:
 * bits 24-25 select the mode (0 default, 1 system-16, 2 palette-256, 3 rgb)
 * and bits 0-23 carry the value. Keeps the grid as flat typed arrays.
 */

export const ATTR_BOLD = 1;
export const ATTR_DIM = 2;
export const ATTR_ITALIC = 4;
export const ATTR_UNDERLINE = 8;
export const ATTR_INVERSE = 16;
export const ATTR_STRIKETHROUGH = 32;
export const ATTR_WIDE_CONTINUATION = 64;

export const COLOR_DEFAULT = 0;

export function color16(index: number): number {
  return (1 << 24) | (index & 0xffff);
}

export function color256(index: number): number {
  return (2 << 24) | (index & 0xffff);
}

export function rgbColor(r: number, g: number, b: number): number {
  return (3 << 24) | ((r & 255) << 16) | ((g & 255) << 8) | (b & 255);
}

export function colorMode(color: number): 0 | 1 | 2 | 3 {
  return ((color >>> 24) & 3) as 0 | 1 | 2 | 3;
}

export function colorValue(color: number): number {
  return color & 0xffffff;
}

const HEX = "0123456789abcdef";

function toHex(value: number): string {
  return `${HEX[(value >> 4) & 15]}${HEX[value & 15]}`;
}

function rgbToCss(r: number, g: number, b: number): string {
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** Standard 16 ANSI colors (0-7 normal, 8-15 bright). */
export const SYSTEM16: string[] = [
  "#000000",
  "#cd3131",
  "#0dbc79",
  "#e5e510",
  "#2472c8",
  "#bc3fbc",
  "#11a8cd",
  "#e5e5e5",
  "#666666",
  "#f14c4c",
  "#23d18b",
  "#f5f543",
  "#3b8eea",
  "#d670d6",
  "#29b8db",
  "#ffffff",
];

function system256ToRgb(index: number): [number, number, number] {
  if (index < 16) {
    const css = SYSTEM16[index];
    return [
      parseInt(css.slice(1, 3), 16),
      parseInt(css.slice(3, 5), 16),
      parseInt(css.slice(5, 7), 16),
    ];
  }
  if (index < 232) {
    const v = index - 16;
    const r = Math.floor(v / 36);
    const g = Math.floor((v % 36) / 6);
    const b = v % 6;
    const level = (n: number) => (n === 0 ? 0 : 55 + n * 40);
    return [level(r), level(g), level(b)];
  }
  const gray = 8 + (index - 232) * 10;
  return [gray, gray, gray];
}

/**
 * Resolve a packed color to CSS. `palette` overrides the 16 system colors
 * (terminal theme). Returns null for default (caller uses fg/bg default).
 */
export function resolveColor(
  color: number,
  palette: string[],
  isBackground: boolean,
): string | null {
  const mode = colorMode(color);
  if (mode === 0) return null;
  const value = colorValue(color);
  if (mode === 1) {
    const themed = palette[value & 15];
    if (themed) return themed;
    return SYSTEM16[value & 15];
  }
  if (mode === 2) {
    const [r, g, b] = system256ToRgb(value & 255);
    return rgbToCss(r, g, b);
  }
  void isBackground;
  return rgbToCss((value >> 16) & 255, (value >> 8) & 255, value & 255);
}

/**
 * Approximate Unicode width: 0 for combining marks, 2 for wide (CJK,
 * fullwidth forms, most emoji), 1 otherwise. Malformed lone surrogates are
 * handled by the caller mapping them to U+FFFD first.
 */
export function charWidth(codePoint: number): 0 | 1 | 2 {
  if (
    (codePoint >= 0x0300 && codePoint <= 0x036f) ||
    (codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
    (codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
    (codePoint >= 0x20d0 && codePoint <= 0x20ff) ||
    (codePoint >= 0xfe20 && codePoint <= 0xfe2f)
  ) {
    return 0;
  }
  if (
    codePoint >= 0x1100 &&
    (codePoint <= 0x115f ||
      codePoint === 0x2329 ||
      codePoint === 0x232a ||
      (codePoint >= 0x2e80 && codePoint <= 0x303e) ||
      (codePoint >= 0x3041 && codePoint <= 0x33ff) ||
      (codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
      (codePoint >= 0x4e00 && codePoint <= 0xa4cf) ||
      (codePoint >= 0xa960 && codePoint <= 0xa97f) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
      (codePoint >= 0xfe10 && codePoint <= 0xfe1f) ||
      (codePoint >= 0xfe30 && codePoint <= 0xfe4f) ||
      (codePoint >= 0xff00 && codePoint <= 0xff60) ||
      (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
      (codePoint >= 0x20000 && codePoint <= 0x3fffd))
  ) {
    return 2;
  }
  // Emoji blocks commonly rendered wide on Android.
  if (
    (codePoint >= 0x1f300 && codePoint <= 0x1f5ff) ||
    (codePoint >= 0x1f600 && codePoint <= 0x1f64f) ||
    (codePoint >= 0x1f680 && codePoint <= 0x1f6ff) ||
    (codePoint >= 0x1f700 && codePoint <= 0x1f77f) ||
    (codePoint >= 0x1f780 && codePoint <= 0x1f7ff) ||
    (codePoint >= 0x1f800 && codePoint <= 0x1f8ff) ||
    (codePoint >= 0x1f900 && codePoint <= 0x1f9ff) ||
    (codePoint >= 0x2600 && codePoint <= 0x26ff) ||
    (codePoint >= 0x2700 && codePoint <= 0x27bf) ||
    codePoint === 0xfe0f
  ) {
    return 2;
  }
  return 1;
}
