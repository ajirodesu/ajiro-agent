import { describe, expect, it } from "vitest";

import { formatClockTime, formatMessageDate } from "@/modules/chat/message-dates";

const NOW = new Date("2026-09-15T14:10:00").getTime();
const iso = (value: Date): string => value.toISOString();

describe("formatMessageDate", () => {
  it("labels same-day messages Today with 12-hour time", () => {
    expect(formatMessageDate(iso(new Date("2026-09-15T09:05:00")), NOW)).toBe(
      "Today, 9:05 AM",
    );
    expect(formatMessageDate(iso(new Date("2026-09-15T14:10:00")), NOW)).toBe(
      "Today, 2:10 PM",
    );
    expect(formatMessageDate(iso(new Date("2026-09-15T00:00:00")), NOW)).toBe(
      "Today, 12:00 AM",
    );
    expect(formatMessageDate(iso(new Date("2026-09-15T12:00:00")), NOW)).toBe(
      "Today, 12:00 PM",
    );
  });

  it("labels one-day-ago messages Yesterday", () => {
    expect(formatMessageDate(iso(new Date("2026-09-14T23:59:00")), NOW)).toBe(
      "Yesterday, 11:59 PM",
    );
  });

  it("labels same-year messages with month and day", () => {
    expect(formatMessageDate(iso(new Date("2026-09-11T08:30:00")), NOW)).toBe(
      "September 11, 8:30 AM",
    );
    expect(formatMessageDate(iso(new Date("2026-01-02T18:00:00")), NOW)).toBe(
      "January 2, 6:00 PM",
    );
  });

  it("labels previous-year messages with month, day, and year", () => {
    expect(formatMessageDate(iso(new Date("2025-09-11T08:30:00")), NOW)).toBe(
      "September 11 2025, 8:30 AM",
    );
  });

  it("formats compact clock times", () => {
    expect(formatClockTime(iso(new Date("2026-09-15T14:10:00")))).toBe(
      "2:10 PM",
    );
    expect(formatClockTime("not-a-date")).toBe("");
  });

  it("falls back gracefully for invalid input", () => {
    expect(formatMessageDate("not-a-date", NOW)).toBe("not-a-date");
    expect(formatMessageDate("", NOW)).toBe("Unknown date");
  });
});
