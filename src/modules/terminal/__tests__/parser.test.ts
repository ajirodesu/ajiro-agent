import { describe, expect, it } from "vitest";

import { TerminalBuffer } from "@/modules/terminal/buffer";
import { AnsiParser } from "@/modules/terminal/parser";

function parseToText(data: string, cols = 80, rows = 24): string[] {
  const buffer = new TerminalBuffer(cols, rows);
  new AnsiParser(buffer).parse(data);
  return buffer.viewportRuns().map((runs) =>
    runs.map((run) => run.text).join("").replace(/\s+$/, ""),
  );
}

/** Viewport rows are full-width; assertions compare the trimmed text. */
function rowText(buffer: TerminalBuffer, y: number): string {
  return (buffer.viewportRuns()[y] ?? [])
    .map((run) => run.text)
    .join("")
    .replace(/\s+$/, "");
}

describe("ansi parser", () => {
  it("writes plain text and newlines", () => {
    const lines = parseToText("hello\r\nworld");
    expect(lines[0]).toBe("hello");
    expect(lines[1]).toBe("world");
  });

  it("handles carriage return overwrite", () => {
    const lines = parseToText("abcdef\rXY");
    expect(lines[0]).toBe("XYcdef");
  });

  it("handles backspace", () => {
    const lines = parseToText("abc\bd");
    expect(lines[0]).toBe("abd");
  });

  it("applies SGR colors and reset", () => {
    const buffer = new TerminalBuffer(80, 24);
    new AnsiParser(buffer).parse("\x1b[31mred\x1b[0mplain");
    const runs = buffer.viewportRuns()[0];
    expect(runs[0]?.text).toBe("red");
    expect(runs[0]?.foreground).not.toBeNull();
    expect(runs[1]?.text.replace(/\s+$/, "")).toBe("plain");
    expect(runs[1]?.foreground).toBeNull();
  });

  it("supports 256-color and truecolor SGR", () => {
    const buffer = new TerminalBuffer(80, 24);
    new AnsiParser(buffer).parse("\x1b[38;5;196mA\x1b[38;2;1;2;3mB");
    const runs = buffer.viewportRuns()[0];
    expect(runs[0]?.foreground).toBe("#ff0000");
    expect(runs[1]?.foreground).toBe("#010203");
  });

  it("moves the cursor with CSI", () => {
    const lines = parseToText("\x1b[2;5HX");
    expect(lines[1]?.[4]).toBe("X");
  });

  it("erases lines and display", () => {
    const lines = parseToText("hello\x1b[2K");
    expect(lines[0]).toBe("");
    const cleared = parseToText("a\r\nb\x1b[2J");
    expect(cleared[0]).toBe("");
    expect(cleared[1]).toBe("");
  });

  it("handles ED from cursor (mode 0)", () => {
    const lines = parseToText("abcdef\rXY\x1b[0J");
    expect(lines[0]).toBe("XY");
  });

  it("captures OSC titles", () => {
    const buffer = new TerminalBuffer(80, 24);
    const parser = new AnsiParser(buffer);
    let title = "";
    parser.setTitleListener((value) => {
      title = value;
    });
    parser.parse("\x1b]0;my-title\x07done");
    expect(title).toBe("my-title");
    expect(rowText(buffer, 0)).toBe("done");
  });

  it("switches alternate screen without touching scrollback", () => {
    const buffer = new TerminalBuffer(80, 24);
    const parser = new AnsiParser(buffer);
    parser.parse("main\r\n\x1b[?1049h");
    expect(buffer.usingAlternate).toBe(true);
    expect(buffer.scrollback.length).toBe(0);
    parser.parse("\x1b[?1049l");
    expect(buffer.usingAlternate).toBe(false);
  });

  it("ignores unknown sequences instead of echoing", () => {
    // ESC[99Z (unknown final) is dropped; ?2004h is accepted silently;
    // out-of-range cursor reports clamp to the viewport corner.
    const lines = parseToText("a\x1b[99Zb\x1b[?2004hc\x1b[999;999Hd");
    expect(lines.join("")).toContain("abc");
    expect(lines[lines.length - 1]?.endsWith("d")).toBe(true);
  });

  it("recovers lone surrogates", () => {
    const buffer = new TerminalBuffer(80, 24);
    new AnsiParser(buffer).parse("a\ud800b");
    expect(
      (buffer.viewportRuns()[0] ?? [])
        .map((run) => run.text)
        .join("")
        .replace(/\s+$/, ""),
    ).toBe("a�b");
  });
});
