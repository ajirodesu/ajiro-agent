/**
 * Shared theme helpers: rgb triplets to hex/css, and the shared
 * typography + shadow builders. Geometry (spacing/radii/sizes) is NOT
 * defined here — it stays shared and untouched per the reference
 * architecture (shape tokens live once, color varies by theme).
 */
import type { RnShadow, ThemeEffects, ThemeTypography } from "@/theme/types";

function channel(value: number): string {
  const clamped = Math.min(255, Math.max(0, Math.round(value)));
  return clamped.toString(16).padStart(2, "0");
}

export function rgb(r: number, g: number, b: number): string {
  return `#${channel(r)}${channel(g)}${channel(b)}`.toUpperCase();
}

export function rgba(
  r: number,
  g: number,
  b: number,
  alpha: number,
): string {
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(
    b,
  )}, ${alpha})`;
}

export const SHARED_TYPOGRAPHY: ThemeTypography = {
  ui: "system-ui",
  brand: "ui-serif",
  mono: "ui-monospace",
};

function shadow(
  color: string,
  offsetY: number,
  opacity: number,
  radius: number,
  elevation: number,
): RnShadow {
  return {
    shadowColor: color,
    shadowOffset: { width: 0, height: offsetY },
    shadowOpacity: opacity,
    shadowRadius: radius,
    elevation,
  };
}

const SHADOW_COLOR = "#000000";

export function softShadows(): Pick<
  ThemeEffects,
  | "shadowSoftSm"
  | "shadowSoftMd"
  | "shadowSoftLg"
  | "shadowCardRest"
  | "shadowCardHover"
> {
  const sm = shadow(SHADOW_COLOR, 2, 0.3, 8, 2);
  const md = shadow(SHADOW_COLOR, 8, 0.36, 24, 6);
  const lg = shadow(SHADOW_COLOR, 16, 0.4, 48, 12);
  return {
    shadowSoftSm: sm,
    shadowSoftMd: md,
    shadowSoftLg: lg,
    shadowCardRest: sm,
    shadowCardHover: md,
  };
}
