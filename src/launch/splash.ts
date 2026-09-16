/**
 * Launch splash tuning — single source of truth for the themed splash
 * overlay rendered in the root layout.
 *
 * - The native splash layer is imageless (plain black, instant to paint);
 *   this overlay takes over on the first frame with the user's ACTIVE
 *   theme background and the transparent splash mark, so the splash always
 *   matches the theme — light, dark, or any custom theme.
 * - The mark is small and centered, ChatGPT-splash proportioned (roughly
 *   a quarter of the screen width).
 * - The overlay fades out fast once mounted and never blocks touches, so
 *   cold start stays instant with no artificial delay.
 */
export const SPLASH_FADE_OUT_MS = 250;

/** Mark width as a fraction of the screen width. */
export const SPLASH_MARK_WIDTH_FRACTION = 0.28;
