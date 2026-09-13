import { describe, expect, it } from "vitest";

import { TerminalBuffer } from "@/modules/terminal/buffer";
import { nextMatchIndex, searchTerminalLines } from "@/modules/terminal/search";
import { TerminalSession } from "@/modules/terminal/session";

function text(buffer: TerminalBuffer, y: number): string {
  return (buffer.viewportRuns()[y] ?? [])
    .map((run) => run.text)
    .join("")
    .replace(/\s+$/, "");
}

describe("terminal buffer", () => {
  it("wraps long lines and scrolls", () => {
    const buffer = new TerminalBuffer(10, 3);
    buffer.putChar(65);
    for (let i = 0; i < 25; i += 1) buffer.putChar(66 + (i % 20));
    expect(text(buffer, 0).length).toBe(10);
    expect(buffer.scrollback.length).toBe(0);
    // Fill past the viewport: oldest rows move to scrollback.
    for (let row = 0; row < 5; row += 1) {
      buffer.carriageReturn();
      buffer.lineFeed();
      for (let i = 0; i < 10; i += 1) buffer.putChar(48 + row);
    }
    expect(buffer.scrollback.length).toBeGreaterThan(0);
  });

  it("bounds scrollback memory", () => {
    const buffer = new TerminalBuffer(10, 2, 5);
    for (let row = 0; row < 20; row += 1) {
      for (let i = 0; i < 10; i += 1) buffer.putChar(65);
      buffer.carriageReturn();
      buffer.lineFeed();
    }
    expect(buffer.scrollback.length).toBeLessThanOrEqual(5);
  });

  it("handles wide characters as two cells", () => {
    const buffer = new TerminalBuffer(10, 2);
    buffer.putChar("あ".codePointAt(0) ?? 0);
    buffer.putChar(65);
    expect(text(buffer, 0)).toBe("あA");
    expect(buffer.cursorX).toBe(3);
  });

  it("attaches combining marks without advancing", () => {
    const buffer = new TerminalBuffer(10, 2);
    buffer.putChar(101); // e
    buffer.putChar(0x0301); // combining acute
    expect(text(buffer, 0)).toBe("é");
    expect(buffer.cursorX).toBe(1);
  });

  it("toggles the alternate screen", () => {
    const buffer = new TerminalBuffer(10, 2);
    buffer.putChar(65);
    buffer.useAlternateScreen(true);
    expect(text(buffer, 0)).toBe("");
    buffer.putChar(66);
    buffer.useAlternateScreen(false);
    expect(text(buffer, 0)).toBe("A");
  });

  it("resizes without losing output", () => {
    const buffer = new TerminalBuffer(20, 4);
    for (const char of "hello-resize") buffer.putChar(char.codePointAt(0) ?? 0);
    buffer.resize(10, 4);
    expect(buffer.cols).toBe(10);
    const kept = buffer.scrollback.map((line) => line.text).join(" ");
    expect(kept).toContain("hello-resize");
  });
});

describe("terminal session", () => {
  it("echoes submitted lines and records history", async () => {
    const session = new TerminalSession(40, 10);
    const written: string[] = [];
    session.attachProcessWriter(async (data) => {
      written.push(data);
    });
    await session.submitLine("hello");
    await session.submitLine("hello");
    await session.submitLine("world");
    expect(session.history.all()).toEqual(["hello", "world"]);
    expect(written).toEqual(["hello\n", "hello\n", "world\n"]);
    const snap = session.snapshot();
    // Echoed lines live on the viewport rows (scrollback only collects
    // rows scrolled off the top).
    expect(
      snap.lines.map((runs) => runs.map((run) => run.text).join("")).join(" "),
    ).toContain("hello");
  });

  it("emits resize and exit events", () => {
    const session = new TerminalSession(40, 10);
    const types: string[] = [];
    session.onEvent((event) => {
      types.push(event.type);
    });
    session.resize(80, 24);
    session.handleExit(0);
    expect(types).toContain("resize");
    expect(types).toContain("exit");
    expect(session.exitCode).toBe(0);
  });

  it("recalls history with up/down", async () => {
    const session = new TerminalSession(40, 10);
    session.attachProcessWriter(async () => {});
    await session.submitLine("first");
    await session.submitLine("second");
    await session.sendControl("up");
    const snap = session.snapshot();
    const viewportText = snap.lines
      .map((runs) => runs.map((run) => run.text).join(""))
      .join(" ");
    expect(viewportText).toContain("second");
  });
});

describe("terminal search", () => {
  it("finds matches with positions", () => {
    const matches = searchTerminalLines(
      ["hello world", "HELLO again", "nothing"],
      "hello",
      false,
    );
    expect(matches.length).toBe(2);
    expect(matches[0]).toMatchObject({ lineIndex: 0, start: 0, end: 5 });
  });

  it("respects case sensitivity", () => {
    expect(searchTerminalLines(["Hello"], "hello", true).length).toBe(0);
    expect(searchTerminalLines(["Hello"], "hello", false).length).toBe(1);
  });

  it("cycles next/prev with wraparound", () => {
    const matches = searchTerminalLines(["a", "a", "a"], "a", true);
    expect(nextMatchIndex(matches, -1, "next")).toBe(0);
    expect(nextMatchIndex(matches, 2, "next")).toBe(0);
    expect(nextMatchIndex(matches, 0, "prev")).toBe(2);
    expect(nextMatchIndex([], 0, "next")).toBe(-1);
  });
});
