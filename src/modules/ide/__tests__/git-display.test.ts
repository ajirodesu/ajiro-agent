import { describe, expect, it } from "vitest";

import {
  formatRelativeTime,
  parseRemoteRepo,
} from "@/modules/ide/git-display";

const NOW = new Date("2026-09-15T12:00:00Z").getTime();
const secondsAgo = (seconds: number): number =>
  Math.floor(NOW / 1000) - seconds;

describe("git-display", () => {
  it("formats relative timestamps", () => {
    expect(formatRelativeTime(secondsAgo(10), NOW)).toBe("just now");
    expect(formatRelativeTime(secondsAgo(60), NOW)).toBe("1 minute ago");
    expect(formatRelativeTime(secondsAgo(5 * 60), NOW)).toBe("5 minutes ago");
    expect(formatRelativeTime(secondsAgo(3600), NOW)).toBe("1 hour ago");
    expect(formatRelativeTime(secondsAgo(3 * 3600), NOW)).toBe("3 hours ago");
    expect(formatRelativeTime(secondsAgo(22 * 86400), NOW)).toBe("22 days ago");
    expect(formatRelativeTime(secondsAgo(14 * 86400), NOW)).toBe("14 days ago");
    expect(formatRelativeTime(secondsAgo(60 * 86400), NOW)).toBe("2 months ago");
    expect(formatRelativeTime(secondsAgo(400 * 86400), NOW)).toBe("1 year ago");
  });

  it("clamps future timestamps to just now", () => {
    expect(formatRelativeTime(secondsAgo(-3600), NOW)).toBe("just now");
  });

  it("parses https remote urls", () => {
    expect(
      parseRemoteRepo("https://github.com/ajirodesu/Persian-Bot.git"),
    ).toEqual({
      host: "github.com",
      owner: "ajirodesu",
      repo: "Persian-Bot",
      httpsUrl: "https://github.com/ajirodesu/Persian-Bot",
    });
    expect(
      parseRemoteRepo("https://github.com/ajirodesu/Persian-Bot"),
    )?.toMatchObject({ owner: "ajirodesu", repo: "Persian-Bot" });
  });

  it("parses credential-embedded and ssh remote urls", () => {
    expect(
      parseRemoteRepo("https://user:token@github.com/o/r.git"),
    )?.toMatchObject({
      host: "github.com",
      owner: "o",
      repo: "r",
      httpsUrl: "https://github.com/o/r",
    });
    expect(parseRemoteRepo("git@github.com:o/r.git"))?.toMatchObject({
      host: "github.com",
      owner: "o",
      repo: "r",
      httpsUrl: "https://github.com/o/r",
    });
    expect(parseRemoteRepo("ssh://git@github.com/o/r.git"))?.toMatchObject({
      owner: "o",
      repo: "r",
    });
  });

  it("returns null for missing or unusable urls", () => {
    expect(parseRemoteRepo(null)).toBeNull();
    expect(parseRemoteRepo("")).toBeNull();
    expect(parseRemoteRepo("not a url")).toBeNull();
    expect(parseRemoteRepo("ftp://host/o/r.git")).toBeNull();
    expect(parseRemoteRepo("https://github.com/onlyowner")).toBeNull();
  });
});
