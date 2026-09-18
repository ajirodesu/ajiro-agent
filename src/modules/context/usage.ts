/**
 * Context-usage math for the OpenCode-style usage ring and detail panel.
 *
 * Pure functions only (no React), so the percentage logic — denominator
 * selection, threshold tones, live streaming estimates — is unit-tested.
 * The ring percentage is always computed against the real active model's
 * context window; unknown windows yield null, never a guessed number.
 *
 * Author: AjiroDesu
 */

export type RingTone = "unknown" | "ok" | "warn" | "critical";

/** Green below 60%, amber 60–85%, red above 85%. */
export function contextRingTone(percent: number | null): RingTone {
  if (percent === null || !Number.isFinite(percent)) {
    return "unknown";
  }

  if (percent >= 85) {
    return "critical";
  }

  if (percent >= 60) {
    return "warn";
  }

  return "ok";
}

export type RingTonePalette = {
  destructive: string;
  success: string;
  warning: string;
};

/** Ring colors resolved from the active theme (never hardcoded). */
export function ringToneColor(
  tone: Exclude<RingTone, "unknown">,
  palette: RingTonePalette,
): string {
  if (tone === "critical") return palette.destructive;
  if (tone === "warn") return palette.warning;
  return palette.success;
}



/**
 * Percentage of the context window currently loaded. Returns null when either
 * side is unknown so the UI renders an "unknown" state instead of a
 * miscalculated number (never over 100%: clamped, since estimates can exceed
 * the window on long turns).
 */
export function computeContextLoad(input: {
  contextWindow: number | null;
  usedTokens: number | null;
}): number | null {
  const { contextWindow, usedTokens } = input;

  if (
    contextWindow === null ||
    usedTokens === null ||
    !Number.isFinite(contextWindow) ||
    !Number.isFinite(usedTokens) ||
    contextWindow <= 0 ||
    usedTokens < 0
  ) {
    return null;
  }

  return Math.min(100, (Math.round((usedTokens / contextWindow) * 1000) / 10));
}

/** Rough live token estimate from streamed characters (~4 chars per token). */
export function estimateStreamingTokens(charCount: number): number {
  if (!Number.isFinite(charCount) || charCount <= 0) {
    return 0;
  }

  return Math.ceil(charCount / 4);
}

export function formatTokenNumber(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }

  return Math.round(value).toLocaleString("en-US");
}

/**
 * Share of input tokens served from cache (0–1), or null when no cache data
 * exists. Cache-write tokens are billed input, not hits, so only reads count.
 */
export function cacheHitRatio(input: {
  cacheReadTokens: number | null;
  noCacheTokens: number | null;
}): number | null {
  const { cacheReadTokens, noCacheTokens } = input;

  if (
    cacheReadTokens === null ||
    noCacheTokens === null ||
    !Number.isFinite(cacheReadTokens) ||
    !Number.isFinite(noCacheTokens)
  ) {
    return null;
  }

  const denominator = cacheReadTokens + noCacheTokens;

  if (denominator <= 0) {
    return null;
  }

  return cacheReadTokens / denominator;
}

/** Sum with null-tolerance: null only when every value is missing. */
export function sumNullable(values: (number | null)[]): number | null {
  let sawValue = false;
  let total = 0;

  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      sawValue = true;
      total += value;
    }
  }

  return sawValue ? total : null;
}
