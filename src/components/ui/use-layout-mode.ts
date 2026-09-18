import { useWindowDimensions } from "react-native";

import { layoutModeForWidth, type LayoutMode } from "./responsive";

/**
 * Live layout mode; re-evaluates on rotation, resize, foldables, and
 * desktop window changes via `useWindowDimensions`. Kept separate from
 * `responsive.ts` so the pure breakpoint math stays unit-testable on node.
 */
export function useLayoutMode(): LayoutMode {
  const { width } = useWindowDimensions();
  return layoutModeForWidth(width);
}
