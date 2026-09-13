/**
 * ANSI/VT state-machine parser (not regex-based). Consumes JS strings
 * code-point by code-point; lone surrogates recover to U+FFFD.
 *
 * Supported: printable, C0/C1 controls (BS HT LF VT FF CR, BEL ignored),
 * ESC (c, M, 7/8, (, ), #, P/X/^/_ stubs), CSI (cursor, ED/EL, SU/SD,
 * ICH/DCH/ECH/IL/DL, SGR incl. 256/truecolor, margins, DECSET/DECRST for
 * 25/47/1047/1048/1049/2004, cursor save/restore), OSC 0/2 title + OSC 8
 * hyperlink end, plus UTF-8 decoding at the string layer.
 *
 * Unknown/unsupported sequences are ignored (VT-compatible behavior), never
 * echoed.
 */
import type { TerminalBuffer } from "@/modules/terminal/buffer";

const enum State {
  Ground,
  Escape,
  EscapeIntermediate,
  CsiEntry,
  CsiParam,
  CsiIntermediate,
  CsiIgnore,
  Osc,
  OscEscape,
  SosPmApc,
}

const MAX_PARAMS = 32;
const MAX_INTERMEDIATE = 4;
const MAX_OSC = 4096;

function isDigit(cp: number): boolean {
  return cp >= 0x30 && cp <= 0x39;
}

export class AnsiParser {
  private state: State = State.Ground;
  private params: number[] = [];
  private currentParam: number | null = null;
  private intermediate = "";
  private osc = "";
  private readonly screen: TerminalBuffer;
  private onTitle: ((title: string) => void) | null = null;

  constructor(screen: TerminalBuffer) {
    this.screen = screen;
  }

  setTitleListener(listener: ((title: string) => void) | null): void {
    this.onTitle = listener;
  }

  parse(data: string): void {
    for (const char of data) {
      let cp = char.codePointAt(0) ?? 0xfffd;
      if (cp >= 0xd800 && cp <= 0xdfff) cp = 0xfffd;
      this.step(cp);
    }
  }

  private step(cp: number): void {
    switch (this.state) {
      case State.Ground:
        this.ground(cp);
        break;
      case State.Escape:
        this.escape(cp);
        break;
      case State.EscapeIntermediate:
        this.escapeIntermediate(cp);
        break;
      case State.CsiEntry:
        this.csiEntry(cp);
        break;
      case State.CsiParam:
        this.csiParam(cp);
        break;
      case State.CsiIntermediate:
        this.csiIntermediate(cp);
        break;
      case State.CsiIgnore:
        if (cp >= 0x40 && cp <= 0x7e) this.state = State.Ground;
        break;
      case State.Osc:
        this.oscStep(cp);
        break;
      case State.OscEscape:
        if (cp === 0x5c) {
          this.finishOsc();
        } else {
          this.state = State.Osc;
          this.oscStep(cp);
        }
        break;
      case State.SosPmApc:
        if (cp === 0x9c) this.state = State.Ground;
        else if (cp === 0x1b) this.state = State.Escape;
        break;
    }
  }

  private ground(cp: number): void {
    if (cp === 0x1b) {
      this.state = State.Escape;
      return;
    }
    if (cp === 0x07) return; // BEL
    if (cp === 0x08) {
      this.screen.backspace();
      return;
    }
    if (cp === 0x09) {
      this.screen.tab();
      return;
    }
    if (cp === 0x0a || cp === 0x0b || cp === 0x0c) {
      this.screen.lineFeed();
      return;
    }
    if (cp === 0x0d) {
      this.screen.carriageReturn();
      return;
    }
    if (cp === 0x9b) {
      this.startCsi();
      return;
    }
    if (cp === 0x9d) {
      this.osc = "";
      this.state = State.Osc;
      return;
    }
    if (cp === 0x90 || cp === 0x98 || cp === 0x9e || cp === 0x9f) {
      this.state = State.SosPmApc;
      return;
    }
    if (cp < 0x20) return; // other C0: ignore
    if (cp === 0x7f) return; // DEL
    this.screen.putChar(cp);
  }

  private startCsi(): void {
    this.params = [];
    this.currentParam = null;
    this.intermediate = "";
    this.state = State.CsiEntry;
  }

  private pushParam(): void {
    if (this.params.length < MAX_PARAMS) {
      this.params.push(this.currentParam ?? 0);
    }
    this.currentParam = null;
  }

  private escape(cp: number): void {
    if (cp === 0x5b) {
      this.startCsi();
      return;
    }
    if (cp === 0x5d) {
      this.osc = "";
      this.state = State.Osc;
      return;
    }
    if (cp === 0x50 || cp === 0x58 || cp === 0x5e || cp === 0x5f) {
      this.state = State.SosPmApc;
      return;
    }
    if (cp === 0x63) {
      this.screen.reset();
      this.state = State.Ground;
      return;
    }
    if (cp === 0x4d) {
      // RI: reverse index.
      if (this.screen.cursorY === this.screen.marginTop) {
        this.screen.scrollDown(1);
      } else {
        this.screen.cursorUp(1);
      }
      this.state = State.Ground;
      return;
    }
    if (cp === 0x37 || cp === 0x38) {
      if (cp === 0x37) this.screen.saveCursor();
      else this.screen.restoreCursor();
      this.state = State.Ground;
      return;
    }
    if (cp === 0x28 || cp === 0x29 || cp === 0x23) {
      this.intermediate = "";
      this.state = State.EscapeIntermediate;
      return;
    }
    if (cp >= 0x20 && cp <= 0x2f) {
      this.intermediate = String.fromCodePoint(cp);
      this.state = State.EscapeIntermediate;
      return;
    }
    // Single-shift / charset leftovers and friends: ignore.
    this.state = State.Ground;
  }

  private escapeIntermediate(cp: number): void {
    if (cp >= 0x20 && cp <= 0x2f) {
      if (this.intermediate.length < MAX_INTERMEDIATE) {
        this.intermediate += String.fromCodePoint(cp);
      }
      return;
    }
    this.state = State.Ground;
  }

  private csiEntry(cp: number): void {
    if (cp >= 0x30 && cp <= 0x3f) {
      this.state = State.CsiParam;
      this.csiParam(cp);
      return;
    }
    if (cp >= 0x20 && cp <= 0x2f) {
      this.intermediate = String.fromCodePoint(cp);
      this.state = State.CsiIntermediate;
      return;
    }
    if (cp >= 0x40 && cp <= 0x7e) {
      this.dispatchCsi(cp);
      return;
    }
    this.state = State.CsiIgnore;
  }

  private csiParam(cp: number): void {
    if (isDigit(cp)) {
      const digit = cp - 0x30;
      this.currentParam = (this.currentParam ?? 0) * 10 + digit;
      if ((this.currentParam ?? 0) > 9999) this.currentParam = 9999;
      return;
    }
    if (cp === 0x3b) {
      this.pushParam();
      return;
    }
    if (cp === 0x3f) {
      // Private-mode marker (e.g. ?25, ?1049): remembered, parsing continues.
      this.intermediate = "?";
      return;
    }
    if (cp >= 0x30 && cp <= 0x3f) {
      this.state = State.CsiIgnore;
      return;
    }
    if (cp >= 0x20 && cp <= 0x2f) {
      this.pushParam();
      this.intermediate = String.fromCodePoint(cp);
      this.state = State.CsiIntermediate;
      return;
    }
    if (cp >= 0x40 && cp <= 0x7e) {
      this.pushParam();
      this.dispatchCsi(cp);
      return;
    }
    this.state = State.CsiIgnore;
  }

  private csiIntermediate(cp: number): void {
    if (cp >= 0x20 && cp <= 0x2f) {
      if (this.intermediate.length < MAX_INTERMEDIATE) {
        this.intermediate += String.fromCodePoint(cp);
      }
      return;
    }
    if (cp >= 0x40 && cp <= 0x7e) {
      this.dispatchCsi(cp);
      return;
    }
    this.state = State.CsiIgnore;
  }

  private param(index: number, fallback: number): number {
    const value = this.params[index];
    if (value === undefined || value === 0) return fallback;
    return value;
  }

  private dispatchCsi(final: number): void {
    this.state = State.Ground;
    const screen = this.screen;
    const privateMode = this.intermediate.includes("?");
    const finalChar = String.fromCodePoint(final);

    if (privateMode) {
      if (finalChar === "h" || finalChar === "l") {
        const set = finalChar === "h";
        for (const p of this.params.length > 0 ? this.params : [0]) {
          if (p === 25) screen.setCursorVisible(set);
          else if (p === 47 || p === 1047 || p === 1049) {
            screen.useAlternateScreen(set);
            if (p === 1049 && !set) screen.restoreCursor();
            if (p === 1049 && set) screen.saveCursor();
          } else if (p === 1048) {
            if (set) screen.saveCursor();
            else screen.restoreCursor();
          }
          // ?2004 (bracketed paste) and others: accepted, no-op.
        }
      }
      return;
    }

    switch (finalChar) {
      case "A":
        screen.cursorUp(this.param(0, 1));
        break;
      case "B":
      case "e":
        screen.cursorDown(this.param(0, 1));
        break;
      case "C":
      case "a":
        screen.cursorForward(this.param(0, 1));
        break;
      case "D":
        screen.cursorBack(this.param(0, 1));
        break;
      case "E":
        screen.cursorNextLine(this.param(0, 1));
        break;
      case "F":
        screen.cursorPrevLine(this.param(0, 1));
        break;
      case "G":
      case "`":
        screen.cursorColumn(this.param(0, 1));
        break;
      case "H":
      case "f":
        screen.cursorPosition(this.param(0, 1), this.param(1, 1));
        break;
      case "d":
        screen.cursorPosition(this.param(0, 1), screen.cursorX + 1);
        break;
      case "J":
        screen.eraseInDisplay(this.param(0, 0));
        break;
      case "K":
        screen.eraseInLine(this.param(0, 0));
        break;
      case "X":
        screen.eraseChars(this.param(0, 1));
        break;
      case "P":
        screen.deleteChars(this.param(0, 1));
        break;
      case "@":
        screen.insertChars(this.param(0, 1));
        break;
      case "L":
        screen.insertLines(this.param(0, 1));
        break;
      case "M":
        screen.deleteLines(this.param(0, 1));
        break;
      case "S":
        screen.scrollUp(this.param(0, 1));
        break;
      case "T":
        screen.scrollDown(this.param(0, 1));
        break;
      case "m":
        screen.setSgr(this.params);
        break;
      case "r":
        screen.setMargins(this.param(0, 1), this.param(1, screen.rows));
        break;
      case "s":
        screen.saveCursor();
        break;
      case "u":
        screen.restoreCursor();
        break;
      default:
        break;
    }
  }

  private oscStep(cp: number): void {
    if (cp === 0x07) {
      this.finishOsc();
      return;
    }
    if (cp === 0x1b) {
      this.state = State.OscEscape;
      return;
    }
    if (this.osc.length < MAX_OSC) {
      try {
        this.osc += String.fromCodePoint(cp);
      } catch {
        this.osc += "�";
      }
    }
  }

  private finishOsc(): void {
    this.state = State.Ground;
    const match = /^(\d+);([\s\S]*)$/.exec(this.osc);
    if (!match) return;
    const code = match[1];
    const payload = match[2] ?? "";
    if (code === "0" || code === "2") {
      this.onTitle?.(payload);
    }
    // OSC 8 (hyperlinks) and others: accepted, no visual link support.
    this.osc = "";
  }
}
