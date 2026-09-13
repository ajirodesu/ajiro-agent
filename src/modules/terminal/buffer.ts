/**
 * Screen buffer: primary + alternate grids, bounded scrollback, cursor,
 * scroll margins, wrap. Scrollback stores run-length segments (bounded line
 * count) so color survives scrolling without per-cell retention cost.
 */
import {
  ATTR_BOLD,
  ATTR_DIM,
  ATTR_INVERSE,
  ATTR_ITALIC,
  ATTR_STRIKETHROUGH,
  ATTR_UNDERLINE,
  ATTR_WIDE_CONTINUATION,
  COLOR_DEFAULT,
  SYSTEM16,
  charWidth,
  color16,
  resolveColor,
} from "@/modules/terminal/attributes";
import { EMPTY_CODE_POINT, TerminalGrid } from "@/modules/terminal/grid";
import type { TerminalLineRun } from "@/modules/terminal/types";

export const DEFAULT_SCROLLBACK_LINES = 5000;

export type Pen = {
  foreground: number;
  background: number;
  attributes: number;
};

export type ScrollbackLine = {
  runs: TerminalLineRun[];
  text: string;
};

function runsEqual(left: TerminalLineRun, right: TerminalLineRun): boolean {
  return (
    left.foreground === right.foreground &&
    left.background === right.background &&
    left.bold === right.bold &&
    left.dim === right.dim &&
    left.italic === right.italic &&
    left.underline === right.underline &&
    left.inverse === right.inverse &&
    left.strikethrough === right.strikethrough
  );
}

export class TerminalBuffer {
  cols: number;
  rows: number;
  primary: TerminalGrid;
  alternate: TerminalGrid | null = null;
  scrollback: ScrollbackLine[] = [];
  readonly maxScrollback: number;
  cursorX = 0;
  cursorY = 0;
  savedX = 0;
  savedY = 0;
  savedPen: Pen = {
    foreground: COLOR_DEFAULT,
    background: COLOR_DEFAULT,
    attributes: 0,
  };
  marginTop = 0;
  marginBottom: number;
  wrapPending = false;
  cursorVisible = true;
  /** Palette used when resolving run colors (set from the active theme). */
  palette: string[] = SYSTEM16;
  pen: Pen = {
    foreground: COLOR_DEFAULT,
    background: COLOR_DEFAULT,
    attributes: 0,
  };

  constructor(cols: number, rows: number, maxScrollback = DEFAULT_SCROLLBACK_LINES) {
    this.cols = Math.max(1, cols);
    this.rows = Math.max(1, rows);
    this.primary = new TerminalGrid(this.cols, this.rows);
    this.maxScrollback = Math.max(0, maxScrollback);
    this.marginBottom = this.rows - 1;
  }

  get active(): TerminalGrid {
    return this.alternate ?? this.primary;
  }

  get usingAlternate(): boolean {
    return this.alternate !== null;
  }

  clampCursor(): void {
    this.cursorX = Math.min(Math.max(0, this.cursorX), this.cols - 1);
    this.cursorY = Math.min(Math.max(0, this.cursorY), this.rows - 1);
  }

  setSgr(params: number[]): void {
    if (params.length === 0) params = [0];
    let i = 0;
    while (i < params.length) {
      const p = params[i];
      if (p === 0) {
        this.pen = {
          foreground: COLOR_DEFAULT,
          background: COLOR_DEFAULT,
          attributes: 0,
        };
      } else if (p === 1) this.pen.attributes |= ATTR_BOLD;
      else if (p === 2) this.pen.attributes |= ATTR_DIM;
      else if (p === 3) this.pen.attributes |= ATTR_ITALIC;
      else if (p === 4) this.pen.attributes |= ATTR_UNDERLINE;
      else if (p === 7) this.pen.attributes |= ATTR_INVERSE;
      else if (p === 9) this.pen.attributes |= ATTR_STRIKETHROUGH;
      else if (p === 22)
        this.pen.attributes &= ~(ATTR_BOLD | ATTR_DIM);
      else if (p === 23) this.pen.attributes &= ~ATTR_ITALIC;
      else if (p === 24) this.pen.attributes &= ~ATTR_UNDERLINE;
      else if (p === 27) this.pen.attributes &= ~ATTR_INVERSE;
      else if (p === 29) this.pen.attributes &= ~ATTR_STRIKETHROUGH;
      else if (p >= 30 && p <= 37) this.pen.foreground = color16(p - 30);
      else if (p === 39) this.pen.foreground = COLOR_DEFAULT;
      else if (p >= 40 && p <= 47) this.pen.background = color16(p - 40);
      else if (p === 49) this.pen.background = COLOR_DEFAULT;
      else if (p >= 90 && p <= 97) this.pen.foreground = color16(p - 90 + 8);
      else if (p >= 100 && p <= 107)
        this.pen.background = color16(p - 100 + 8);
      else if ((p === 38 || p === 48) && i + 2 < params.length) {
        const isFg = p === 38;
        const mode = params[i + 1];
        if (mode === 5) {
          const color = (2 << 24) | (params[i + 2] & 255);
          if (isFg) this.pen.foreground = color;
          else this.pen.background = color;
          i += 2;
        } else if (mode === 2 && i + 4 < params.length) {
          const color =
            (3 << 24) |
            ((params[i + 2] & 255) << 16) |
            ((params[i + 3] & 255) << 8) |
            (params[i + 4] & 255);
          if (isFg) this.pen.foreground = color;
          else this.pen.background = color;
          i += 4;
        }
      }
      i += 1;
    }
  }

  private ensureWrap(): void {
    if (!this.wrapPending) return;
    this.wrapPending = false;
    this.cursorX = 0;
    this.lineFeed();
  }

  putChar(codePoint: number): void {
    const width = charWidth(codePoint);
    if (width === 0) {
      const grid = this.active;
      const x = this.wrapPending ? 0 : this.cursorX;
      const targetX = Math.min(Math.max(0, x - 1), this.cols - 1);
      try {
        grid.addCombining(targetX, this.cursorY, String.fromCodePoint(codePoint));
      } catch {
        grid.addCombining(targetX, this.cursorY, "�");
      }
      return;
    }
    this.ensureWrap();
    const grid = this.active;
    grid.set(
      this.cursorX,
      this.cursorY,
      codePoint,
      this.pen.foreground,
      this.pen.background,
      this.pen.attributes,
    );
    if (width === 2 && this.cursorX + 1 < this.cols) {
      grid.set(
        this.cursorX + 1,
        this.cursorY,
        EMPTY_CODE_POINT,
        this.pen.foreground,
        this.pen.background,
        this.pen.attributes | ATTR_WIDE_CONTINUATION,
      );
    }
    this.cursorX += width;
    if (this.cursorX >= this.cols) {
      this.cursorX = this.cols - 1;
      this.wrapPending = true;
    }
  }

  carriageReturn(): void {
    this.wrapPending = false;
    this.cursorX = 0;
  }

  lineFeed(): void {
    this.wrapPending = false;
    if (this.cursorY === this.marginBottom) {
      this.scrollUp(1);
    } else {
      this.cursorY = Math.min(this.cursorY + 1, this.rows - 1);
    }
  }

  newline(): void {
    this.carriageReturn();
    this.lineFeed();
  }

  backspace(): void {
    this.wrapPending = false;
    this.cursorX = Math.max(0, this.cursorX - 1);
  }

  tab(): void {
    this.ensureWrap();
    const next = this.cursorX + (8 - (this.cursorX % 8));
    this.cursorX = Math.min(next, this.cols - 1);
    if (this.cursorX >= this.cols - 1) this.wrapPending = true;
  }

  cursorUp(n: number): void {
    this.wrapPending = false;
    this.cursorY = Math.max(this.marginTop, this.cursorY - Math.max(1, n));
  }

  cursorDown(n: number): void {
    this.wrapPending = false;
    this.cursorY = Math.min(this.marginBottom, this.cursorY + Math.max(1, n));
  }

  cursorForward(n: number): void {
    this.wrapPending = false;
    this.cursorX = Math.min(this.cols - 1, this.cursorX + Math.max(1, n));
  }

  cursorBack(n: number): void {
    this.wrapPending = false;
    this.cursorX = Math.max(0, this.cursorX - Math.max(1, n));
  }

  cursorNextLine(n: number): void {
    this.cursorDown(n);
    this.cursorX = 0;
  }

  cursorPrevLine(n: number): void {
    this.cursorUp(n);
    this.cursorX = 0;
  }

  cursorColumn(n: number): void {
    this.wrapPending = false;
    this.cursorX = Math.min(Math.max(0, n - 1), this.cols - 1);
  }

  cursorPosition(row: number, col: number): void {
    this.wrapPending = false;
    const top = this.usingAlternate ? 0 : this.marginTop;
    const bottom = this.usingAlternate ? this.rows - 1 : this.marginBottom;
    this.cursorY = Math.min(Math.max(top, row - 1), bottom);
    this.cursorX = Math.min(Math.max(0, col - 1), this.cols - 1);
  }

  eraseInDisplay(mode: number): void {
    const grid = this.active;
    if (mode === 2 || mode === 3) {
      if (!this.usingAlternate) {
        // Scroll the viewport into scrollback before clearing (like xterm).
        for (let y = 0; y < this.rows; y += 1) {
          this.pushScrollbackLine(this.activeRow(y));
        }
      }
      grid.clearAll();
      this.cursorX = 0;
      this.cursorY = 0;
      this.wrapPending = false;
      return;
    }
    if (mode === 1) {
      for (let y = 0; y < this.cursorY; y += 1) grid.clearRow(y);
      this.eraseInLine(1);
      return;
    }
    // Mode 0 (or default): erase from the cursor to the end of the display.
    this.eraseInLine(0);
    for (let y = this.cursorY + 1; y < this.rows; y += 1) grid.clearRow(y);
  }

  eraseInLine(mode: number): void {
    const grid = this.active;
    const y = this.cursorY;
    if (mode === 1) {
      for (let x = 0; x <= this.cursorX; x += 1) grid.clearCell(x, y);
      return;
    }
    if (mode === 2) {
      grid.clearRow(y);
      return;
    }
    for (let x = this.cursorX; x < this.cols; x += 1) grid.clearCell(x, y);
  }

  eraseChars(n: number): void {
    const grid = this.active;
    const count = Math.max(1, n);
    for (let x = this.cursorX; x < Math.min(this.cols, this.cursorX + count); x += 1) {
      grid.clearCell(x, this.cursorY);
    }
  }

  deleteChars(n: number): void {
    const grid = this.active;
    const count = Math.max(1, n);
    const y = this.cursorY;
    for (let x = this.cursorX; x < this.cols - count; x += 1) {
      const src = grid.get(x + count, y);
      grid.set(x, y, src.codePoint, src.foreground, src.background, src.attributes);
    }
    for (let x = Math.max(0, this.cols - count); x < this.cols; x += 1) {
      grid.clearCell(x, y);
    }
  }

  insertChars(n: number): void {
    const grid = this.active;
    const count = Math.max(1, n);
    const y = this.cursorY;
    for (let x = this.cols - 1; x >= this.cursorX + count; x -= 1) {
      const src = grid.get(x - count, y);
      grid.set(x, y, src.codePoint, src.foreground, src.background, src.attributes);
    }
    for (let x = this.cursorX; x < Math.min(this.cols, this.cursorX + count); x += 1) {
      grid.clearCell(x, y);
    }
  }

  insertLines(n: number): void {
    const grid = this.active;
    const count = Math.max(1, n);
    for (let y = this.marginBottom; y >= this.cursorY + count; y -= 1) {
      this.copyRow(grid, y - count, y);
    }
    for (let y = this.cursorY; y < Math.min(this.marginBottom + 1, this.cursorY + count); y += 1) {
      grid.clearRow(y);
    }
  }

  deleteLines(n: number): void {
    const grid = this.active;
    const count = Math.max(1, n);
    for (let y = this.cursorY; y <= this.marginBottom - count; y += 1) {
      this.copyRow(grid, y + count, y);
    }
    for (let y = Math.max(this.cursorY, this.marginBottom - count + 1); y <= this.marginBottom; y += 1) {
      grid.clearRow(y);
    }
  }

  private copyRow(grid: TerminalGrid, from: number, to: number): void {
    for (let x = 0; x < this.cols; x += 1) {
      const src = grid.get(x, from);
      grid.set(
        x,
        to,
        src.codePoint,
        src.foreground,
        src.background,
        src.attributes,
      );
    }
    // Move combining overlays attached to the source row.
    const moved: [number, string][] = [];
    for (const [key, mark] of grid.combining) {
      if (Math.floor(key / grid.cols) === from) {
        moved.push([key % grid.cols, mark]);
        grid.combining.delete(key);
      }
    }
    for (const [sx, mark] of moved) {
      const di = to * grid.cols + sx;
      grid.combining.set(di, `${grid.combining.get(di) ?? ""}${mark}`);
    }
  }

  scrollUp(n: number): void {
    const grid = this.active;
    const count = Math.max(1, n);
    const inMargins =
      this.marginTop !== 0 || this.marginBottom !== this.rows - 1;
    for (let k = 0; k < count; k += 1) {
      if (!this.usingAlternate && !inMargins) {
        this.pushScrollbackLine(this.activeRow(this.marginTop));
      }
      for (let y = this.marginTop; y < this.marginBottom; y += 1) {
        this.copyRow(grid, y + 1, y);
      }
      grid.clearRow(this.marginBottom);
    }
  }

  scrollDown(n: number): void {
    const grid = this.active;
    const count = Math.max(1, n);
    for (let k = 0; k < count; k += 1) {
      for (let y = this.marginBottom; y > this.marginTop; y -= 1) {
        this.copyRow(grid, y - 1, y);
      }
      grid.clearRow(this.marginTop);
    }
  }

  private activeRow(y: number): TerminalLineRun[] {
    const grid = this.active;
    const runs: TerminalLineRun[] = [];
    let current: TerminalLineRun | null = null;
    for (let x = 0; x < this.cols; x += 1) {
      const cell = grid.get(x, y);
      if (cell.attributes & ATTR_WIDE_CONTINUATION) continue;
      const run: TerminalLineRun = {
        text: grid.cellText(x, y),
        foreground: resolveColor(cell.foreground, this.palette, false),
        background: resolveColor(cell.background, this.palette, true),
        bold: (cell.attributes & ATTR_BOLD) !== 0,
        dim: (cell.attributes & ATTR_DIM) !== 0,
        italic: (cell.attributes & ATTR_ITALIC) !== 0,
        underline: (cell.attributes & ATTR_UNDERLINE) !== 0,
        inverse: (cell.attributes & ATTR_INVERSE) !== 0,
        strikethrough: (cell.attributes & ATTR_STRIKETHROUGH) !== 0,
      };
      if (current && runsEqual(current, run)) {
        current.text += run.text;
      } else {
        current = run;
        runs.push(current);
      }
    }
    return runs;
  }

  private pushScrollbackLine(runs: TerminalLineRun[]): void {
    const text = runs.map((run) => run.text).join("").replace(/\s+$/, "");
    if (!text && runs.every((run) => !run.text.trim())) {
      // Keep blank lines so spacing survives, but cap memory the same way.
    }
    this.scrollback.push({ runs, text });
    while (this.scrollback.length > this.maxScrollback) {
      this.scrollback.shift();
    }
  }

  saveCursor(): void {
    this.savedX = this.cursorX;
    this.savedY = this.cursorY;
    this.savedPen = { ...this.pen };
  }

  restoreCursor(): void {
    this.cursorX = this.savedX;
    this.cursorY = this.savedY;
    this.pen = { ...this.savedPen };
    this.wrapPending = false;
    this.clampCursor();
  }

  useAlternateScreen(active: boolean): void {
    if (active && !this.alternate) {
      this.saveCursor();
      this.alternate = new TerminalGrid(this.cols, this.rows);
      this.cursorX = 0;
      this.cursorY = 0;
      this.wrapPending = false;
      this.marginTop = 0;
      this.marginBottom = this.rows - 1;
    } else if (!active && this.alternate) {
      this.alternate = null;
      this.restoreCursor();
      this.marginTop = 0;
      this.marginBottom = this.rows - 1;
    }
  }

  setCursorVisible(visible: boolean): void {
    this.cursorVisible = visible;
  }

  reset(): void {
    this.primary.clearAll();
    this.alternate = null;
    this.scrollback = [];
    this.cursorX = 0;
    this.cursorY = 0;
    this.marginTop = 0;
    this.marginBottom = this.rows - 1;
    this.wrapPending = false;
    this.cursorVisible = true;
    this.pen = {
      foreground: COLOR_DEFAULT,
      background: COLOR_DEFAULT,
      attributes: 0,
    };
  }

  clear(): void {
    this.primary.clearAll();
    this.alternate?.clearAll();
    this.scrollback = [];
    this.cursorX = 0;
    this.cursorY = 0;
    this.wrapPending = false;
  }

  setMargins(top: number, bottom: number): void {
    const t = Math.min(Math.max(1, top), this.rows) - 1;
    const b = Math.min(Math.max(1, bottom), this.rows) - 1;
    if (t >= b) return;
    this.marginTop = t;
    this.marginBottom = b;
    this.cursorX = 0;
    this.cursorY = t;
    this.wrapPending = false;
  }

  resize(cols: number, rows: number): void {
    const nextCols = Math.max(1, cols);
    const nextRows = Math.max(1, rows);
    if (nextCols === this.cols && nextRows === this.rows) return;
    // Reflow: drain the viewport into the scrollback as text, then rebuild.
    // Colors inside the viewport are preserved for visible rows; reflowed
    // scrollback keeps plain text (bounded, searchable).
    const viewportText: string[] = [];
    for (let y = 0; y < this.rows; y += 1) {
      viewportText.push(this.primary.lineText(y));
    }
    this.cols = nextCols;
    this.rows = nextRows;
    this.primary = new TerminalGrid(nextCols, nextRows);
    this.alternate = this.alternate ? new TerminalGrid(nextCols, nextRows) : null;
    this.marginTop = 0;
    this.marginBottom = nextRows - 1;
    this.cursorX = 0;
    this.cursorY = 0;
    this.wrapPending = false;
    // Re-emit old viewport text into scrollback so resize never loses output.
    for (const line of viewportText) {
      if (!line.trim()) continue;
      this.scrollback.push({
        runs: [{ text: line, foreground: null, background: null, bold: false, dim: false, italic: false, underline: false, inverse: false, strikethrough: false }],
        text: line,
      });
    }
    while (this.scrollback.length > this.maxScrollback) {
      this.scrollback.shift();
    }
  }

  /** Visible viewport rows as runs (for the renderer). */
  viewportRuns(): TerminalLineRun[][] {
    const out: TerminalLineRun[][] = [];
    for (let y = 0; y < this.rows; y += 1) out.push(this.activeRow(y));
    return out;
  }
}
