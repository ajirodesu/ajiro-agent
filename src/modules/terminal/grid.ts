/**
 * Flat cell grid: four parallel Int32Arrays, no per-cell objects on the hot
 * path. Wide characters occupy two cells (second flagged continuation);
 * combining marks are overlaid via a sparse map (rare path).
 */
import {
  ATTR_WIDE_CONTINUATION,
  COLOR_DEFAULT,
} from "@/modules/terminal/attributes";
import type { TerminalCell } from "@/modules/terminal/types";

export const EMPTY_CODE_POINT = 32;

export class TerminalGrid {
  readonly cols: number;
  readonly rows: number;
  readonly codePoints: Int32Array;
  readonly foregrounds: Int32Array;
  readonly backgrounds: Int32Array;
  readonly attributes: Int32Array;
  readonly combining = new Map<number, string>();

  constructor(cols: number, rows: number) {
    this.cols = Math.max(1, cols);
    this.rows = Math.max(1, rows);
    const size = this.cols * this.rows;
    this.codePoints = new Int32Array(size).fill(EMPTY_CODE_POINT);
    this.foregrounds = new Int32Array(size).fill(COLOR_DEFAULT);
    this.backgrounds = new Int32Array(size).fill(COLOR_DEFAULT);
    this.attributes = new Int32Array(size);
  }

  index(x: number, y: number): number {
    return y * this.cols + x;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && x < this.cols && y >= 0 && y < this.rows;
  }

  get(x: number, y: number): TerminalCell {
    const i = this.index(x, y);
    return {
      codePoint: this.codePoints[i],
      foreground: this.foregrounds[i],
      background: this.backgrounds[i],
      attributes: this.attributes[i],
    };
  }

  set(
    x: number,
    y: number,
    codePoint: number,
    foreground: number,
    background: number,
    attributes: number,
  ): void {
    if (!this.inBounds(x, y)) return;
    const i = this.index(x, y);
    this.codePoints[i] = codePoint;
    this.foregrounds[i] = foreground;
    this.backgrounds[i] = background;
    this.attributes[i] = attributes;
    this.combining.delete(i);
  }

  clearCell(x: number, y: number): void {
    this.set(x, y, EMPTY_CODE_POINT, COLOR_DEFAULT, COLOR_DEFAULT, 0);
  }

  clearRow(y: number): void {
    if (y < 0 || y >= this.rows) return;
    for (let x = 0; x < this.cols; x += 1) this.clearCell(x, y);
  }

  clearAll(): void {
    this.codePoints.fill(EMPTY_CODE_POINT);
    this.foregrounds.fill(COLOR_DEFAULT);
    this.backgrounds.fill(COLOR_DEFAULT);
    this.attributes.fill(0);
    this.combining.clear();
  }

  addCombining(x: number, y: number, mark: string): void {
    if (!this.inBounds(x, y)) return;
    const i = this.index(x, y);
    this.combining.set(i, `${this.combining.get(i) ?? ""}${mark}`);
  }

  cellText(x: number, y: number): string {
    if (!this.inBounds(x, y)) return "";
    const i = this.index(x, y);
    if (this.attributes[i] & ATTR_WIDE_CONTINUATION) return "";
    let text: string;
    try {
      text = String.fromCodePoint(this.codePoints[i]);
    } catch {
      text = "�";
    }
    return `${text}${this.combining.get(i) ?? ""}`;
  }

  lineText(y: number): string {
    let text = "";
    for (let x = 0; x < this.cols; x += 1) text += this.cellText(x, y);
    return text.replace(/\s+$/, "");
  }
}
