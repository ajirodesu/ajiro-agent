import { describe, expect, it } from "vitest";

import { buildZip, crc32Hex, parseZip } from "../zip";

const text = (value: string) => new TextEncoder().encode(value);

describe("zip archive round-trip", () => {
  it("writes and reads stored entries byte-for-byte", () => {
    const bytes = buildZip([
      { data: text('{"a":1}'), name: "manifest.json" },
      { data: text("hello"), name: "docs/readme.md" },
      { data: new Uint8Array([0, 255, 1, 2, 3]), name: "bin/data.bin" },
    ]);
    const entries = parseZip(bytes);
    expect(entries.map((entry) => entry.name)).toEqual([
      "manifest.json",
      "docs/readme.md",
      "bin/data.bin",
    ]);
    expect(new TextDecoder().decode(entries[0]!.data)).toBe('{"a":1}');
    expect([...entries[2]!.data]).toEqual([0, 255, 1, 2, 3]);
  });

  it("rejects unsafe, duplicate, and empty names on write", () => {
    expect(() => buildZip([{ data: text("x"), name: "../evil" }])).toThrow(
      /Unsafe/,
    );
    expect(() => buildZip([{ data: text("x"), name: "/abs" }])).toThrow(
      /Unsafe/,
    );
    expect(() => buildZip([{ data: text("x"), name: "a\\b" }])).toThrow(
      /Unsafe/,
    );
    expect(() =>
      buildZip([
        { data: text("x"), name: "a" },
        { data: text("y"), name: "a" },
      ]),
    ).toThrow(/Duplicate/);
  });

  it("rejects corrupt archives, CRC mismatches, and traversal on read", () => {
    expect(() => parseZip(text("not a zip"))).toThrow(/zip archive/);
    const bytes = buildZip([{ data: text("hello"), name: "ok.txt" }]);
    // "ok.txt" is 6 chars: local header (30) + name (6) = data at 36..40.
    const tampered = bytes.slice();
    tampered[38]! ^= 0xff;
    expect(() => parseZip(tampered)).toThrow(/integrity/);
    const truncated = bytes.slice(0, bytes.length - 30);
    expect(() => parseZip(truncated)).toThrow(/zip archive|corrupt|truncated/);
  });

  it("computes stable crc32 hex checksums", () => {
    expect(crc32Hex(text(""))).toBe("00000000");
    expect(crc32Hex(text("hello"))).toBe(crc32Hex(text("hello")));
    expect(crc32Hex(text("hello"))).not.toBe(crc32Hex(text("world")));
  });
});
