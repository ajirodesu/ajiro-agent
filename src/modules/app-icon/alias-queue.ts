/**
 * Coalescing serializer for launcher-icon swaps. Pure — no React, no RN.
 *
 * The theme can change as fast as the user can tap (dark ↔ light ↔ aqua),
 * and each swap is an async native call. Without ordering, two in-flight
 * calls can land out of order and leave the home screen showing a theme the
 * user already moved off. This queue:
 *
 * - serializes calls, so two component-enable writes never interleave;
 * - drops superseded requests that are still waiting, so rapid toggles cost
 *   at most one call for the newest theme instead of N calls in sequence;
 * - always ends on the LAST requested suffix, so the final icon can never be
 *   stale.
 *
 * A request already handed to the native side cannot be cancelled (there is
 * no cancel API) — the queue guarantees the newest one runs after it.
 */
export function createAliasQueue(
  apply: (suffix: string | null) => Promise<void>,
): (suffix: string | null) => Promise<void> {
  let tail: Promise<void> = Promise.resolve();
  let latest = 0;

  return (suffix) => {
    const sequence = ++latest;
    const run = tail.then(async () => {
      // A newer theme arrived while this request waited its turn.
      if (sequence !== latest) {
        return;
      }
      await apply(suffix);
    });
    // Keep the chain alive even if a call rejects: one failed swap must not
    // wedge every later theme change.
    tail = run.catch(() => {});
    return run;
  };
}