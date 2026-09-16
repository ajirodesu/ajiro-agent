/**
 * Editor gutter spec — the SOLE spacing contract for the CodeMirror
 * line-number gutter, fold chevrons, separator line, and code margin.
 *
 * All values are RELATIVE units (em/ch) tied to the editor's font size, so
 * the margin stays proportional when the user changes font size or density.
 * No fixed pixel widths except the 1px separator line. Colors are never
 * hardcoded here — the WebView theme adapter supplies them from AppTheme.
 */
export const EDITOR_GUTTER_SPEC = {
  /** Padding from the gutter's outer left edge to the number cell (~1ch). */
  leftInset: "1ch",
  /** Min number-cell width so a 9-line file doesn't jitter (fits "99"). */
  minNumberChars: 2,
  /** Gap between the centered number and the chevron cell (fixed, small). */
  numberToChevronGap: "0.5ch",
  /** Chevron cell width — reserved on every row so the separator stays straight. */
  chevronCellWidth: "1.6ch",
  /** Separator line width — exactly 1px, full viewport height. */
  separatorWidthPx: 1,
  /** Left padding between the separator and the first code character. */
  codeMarginLeft: "1.25ch",
  /** Matching right-side code padding before line wrap. */
  codePaddingRight: "1.25ch",
} as const;

export type EditorGutterSpec = typeof EDITOR_GUTTER_SPEC;

/**
 * Stable gutter cell width in characters: sized for the largest line number
 * in the file so the separator never reflows mid-session.
 */
export function gutterCharsForLineCount(lineCount: number): number {
  const digits = String(Math.max(1, Math.floor(lineCount))).length;
  return Math.max(EDITOR_GUTTER_SPEC.minNumberChars, digits);
}
