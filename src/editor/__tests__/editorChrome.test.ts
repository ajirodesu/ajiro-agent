import { describe, expect, it } from "vitest";

import { diffLines, charSpansForPair } from "@/editor/editorDiff";
import {
  checkFormat,
  computeDiagnostics,
  countBySeverity,
  formatBuffer,
  formatRelativeTime,
} from "@/editor/editorDiagnostics";
import { gutterCharsForLineCount } from "@/editor/editorGutterSpec";
import { RevisionLog, shouldSnapshot } from "@/editor/editorRevisions";

describe("editorGutterSpec", () => {
  it("sizes the number cell from the largest line number", () => {
    expect(gutterCharsForLineCount(9)).toBe(2);
    expect(gutterCharsForLineCount(999)).toBe(3);
    expect(gutterCharsForLineCount(12345)).toBe(5);
  });
});

describe("editorDiagnostics", () => {
  it("reports a real JS syntax error with its line", async () => {
    const diagnostics = await computeDiagnostics("app.js", "const a = ;");
    expect(diagnostics.some((d) => d.severity === "error")).toBe(true);
    expect(diagnostics[0].line).toBeGreaterThanOrEqual(1);
  });

  it("parses clean JS with zero diagnostics", async () => {
    expect(await computeDiagnostics("app.js", "const a = 1;\n")).toEqual([]);
  });

  it("validates JSON with the real parser", async () => {
    const bad = await computeDiagnostics("data.json", '{"a":}');
    expect(bad.some((d) => d.severity === "error")).toBe(true);
    const good = await computeDiagnostics("data.json", '{"a":1}');
    expect(good).toEqual([]);
  });

  it("flags TODO markers as warnings and counts severities", async () => {
    const diagnostics = await computeDiagnostics("note.txt", "// TODO fix\n");
    const counts = countBySeverity(diagnostics);
    expect(counts.warnings).toBe(1);
    expect(counts.errors).toBe(0);
  });

  it("formats JSON for real and reports validity", async () => {
    expect(formatBuffer("data.json", '{"b":2,"a":1}')).toContain('"a": 1');
    expect(formatBuffer("data.json", '{"a":}')).toBeNull();
    expect((await checkFormat("data.json", '{"a":1}')).valid).toBe(true);
    expect((await checkFormat("data.json", '{"a":}')).valid).toBe(false);
    expect((await checkFormat("note.txt", "hi")).unsupported).toBe(true);
  });

  it("formats relative timestamps", () => {
    const now = Date.parse("2026-09-16T12:00:00.000Z");
    expect(
      formatRelativeTime("2026-09-16T11:59:58.000Z", now),
    ).toBe("just now");
    expect(formatRelativeTime("2026-09-16T11:00:00.000Z", now)).toBe(
      "1 hour ago",
    );
  });
});

describe("editorDiff", () => {
  it("diffs identical content to pure context", () => {
    const rows = diffLines("a\nb\n", "a\nb\n");
    expect(rows.every((r) => r.kind === "context")).toBe(true);
  });

  it("pairs a changed line with inline character spans", () => {
    const rows = diffLines("hello world", "hello worldd");
    const change = rows.find((r) => r.kind === "change");
    expect(change?.kind).toBe("change");
    if (change?.kind === "change") {
      expect(change.rightText).toBe("hello worldd");
      expect(change.rightSpan.end - change.rightSpan.start).toBe(1);
    }
  });

  it("leaves a blank gutter cell on the side with no line", () => {
    const rows = diffLines("a\nb\n", "a\nb\nc\n");
    const added = rows.find((r) => r.kind === "add");
    expect(added?.kind).toBe("add");
    if (added?.kind === "add") {
      expect(added.leftNo).toBeNull();
      expect(added.rightNo).toBe(3);
    }
  });

  it("computes a single appended character span", () => {
    const { rightSpan } = charSpansForPair("abc", "abcd");
    expect(rightSpan).toEqual({ start: 3, end: 4 });
  });
});

describe("editorRevisions", () => {
  it("snapshots meaningful edits and ignores identical text", () => {
    const log = new RevisionLog();
    expect(shouldSnapshot(null, "a")).toBe(true);
    expect(shouldSnapshot("a", "a")).toBe(false);
    const first = log.capture("a", { name: null, avatarUri: null });
    expect(first).not.toBeNull();
    expect(log.capture("a", { name: null, avatarUri: null })).toBeNull();
    expect(log.size).toBe(1);
  });

  it("bounds the log so phones cannot OOM", () => {
    const log = new RevisionLog();
    for (let i = 0; i < 150; i += 1) {
      log.capture(`content-${i}`, { name: null, avatarUri: null });
    }
    expect(log.size).toBe(100);
    expect(log.latest()?.content).toBe("content-149");
  });
});
