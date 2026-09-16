import { describe, expect, it } from "vitest";

import {
  appendCapped,
  buildShareLink,
  detectServerUrl,
  shellQuote,
  stripAnsi,
} from "@/modules/run/run-log";

describe("run-log", () => {
  it("strips ANSI color and cursor sequences", () => {
    expect(stripAnsi("\u001b[32mok\u001b[0m")).toBe("ok");
    expect(stripAnsi("\u001b[2K\rline")).toBe("line");
    expect(stripAnsi("plain")).toBe("plain");
    expect(stripAnsi("a\u0007b")).toBe("ab");
  });

  it("detects printed server urls", () => {
    expect(
      detectServerUrl("Vite ready\n  ➜  Local:   http://localhost:5173/"),
    ).toEqual({ url: "http://localhost:5173", port: 5173 });
    expect(detectServerUrl("listening on http://127.0.0.1:3000/api")).toEqual(
      { url: "http://127.0.0.1:3000/api", port: 3000 },
    );
    expect(detectServerUrl("bind 0.0.0.0:8080")).toBeNull();
    expect(
      detectServerUrl("Network: http://0.0.0.0:8080/"),
    ).toEqual({ url: "http://127.0.0.1:8080", port: 8080 });
    expect(detectServerUrl("no url here")).toBeNull();
  });

  it("quotes shell paths safely", () => {
    expect(shellQuote("/a/b c")).toBe("'/a/b c'");
    expect(shellQuote("o'clock")).toBe("'o'\\''clock'");
  });

  it("prefers LAN links and falls back to loopback", () => {
    expect(buildShareLink("192.168.1.20", 5173)).toEqual({
      url: "http://192.168.1.20:5173",
      scope: "lan",
    });
    expect(buildShareLink("0.0.0.0", 5173).scope).toBe("local");
    expect(buildShareLink(null, 3000)).toEqual({
      url: "http://127.0.0.1:3000",
      scope: "local",
    });
    expect(buildShareLink("not-an-ip", 3000).scope).toBe("local");
  });

  it("caps the console buffer", () => {
    expect(appendCapped(["a", "b"], "c", 3)).toEqual(["a", "b", "c"]);
    expect(appendCapped(["a", "b", "c"], "d", 3)).toEqual(["b", "c", "d"]);
    expect(appendCapped(["a"], "", 3)).toEqual(["a"]);
  });
});
