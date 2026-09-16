import { describe, expect, it } from "vitest";

import {
  ManifestError,
  authorLabel,
  normalizePackagePath,
  parsePluginManifest,
  validatePluginId,
} from "../manifest";
import { ZipError, crc32, readPluginPackage } from "../zip";
import { buildZip, zipOfFiles } from "./helpers";

const VALID_MANIFEST = {
  $schema: "https://acode.app/schema/plugin/v0.1.0.json",
  author: { email: "me@example.com", github: "someone", name: "Someone" },
  id: "com.example.plugin",
  keywords: ["foo", "bar"],
  license: "MIT",
  main: "dist/main.js",
  minVersionCode: 963,
  name: "Example Plugin",
  price: 0,
  repository: "https://github.com/example/plugin",
  unknownFutureField: { keep: true },
  version: "1.2.3",
};

describe("plugin manifest", () => {
  it("parses a valid manifest with unknown fields preserved", () => {
    const manifest = parsePluginManifest(
      JSON.stringify(VALID_MANIFEST),
      ["dist/main.js", "icon.png", "plugin.json", "readme.md"],
    );
    expect(manifest.id).toBe("com.example.plugin");
    expect(manifest.version).toBe("1.2.3");
    expect(manifest.main).toBe("dist/main.js");
    expect(manifest.keywords).toEqual(["foo", "bar"]);
    expect((manifest.raw as Record<string, unknown>).unknownFutureField).toEqual({
      keep: true,
    });
    expect(authorLabel(manifest.author)).toBe("Someone");
  });

  it("rejects malformed JSON", () => {
    expect(() => parsePluginManifest("{nope", null)).toThrow(ManifestError);
  });

  it("rejects missing id / version", () => {
    const withoutId = { ...VALID_MANIFEST };
    delete (withoutId as Record<string, unknown>).id;
    expect(() => parsePluginManifest(JSON.stringify(withoutId))).toThrow(
      /"id" is required/,
    );

    const withoutVersion = { ...VALID_MANIFEST };
    delete (withoutVersion as Record<string, unknown>).version;
    expect(() => parsePluginManifest(JSON.stringify(withoutVersion))).toThrow(
      /"version" is required/,
    );
  });

  it("rejects invalid versions and ids", () => {
    expect(() =>
      parsePluginManifest(JSON.stringify({ ...VALID_MANIFEST, version: "abc" })),
    ).toThrow(/version/);
    expect(() => validatePluginId("../evil")).toThrow();
    expect(() => validatePluginId("ok.plugin-1")).not.toThrow();
  });

  it("rejects unsafe package paths", () => {
    expect(() => normalizePackagePath("../escape.js", "files entry")).toThrow(
      /traverse/,
    );
    expect(() => normalizePackagePath("/absolute.js", "files entry")).toThrow(
      /absolute/,
    );
    expect(() => normalizePackagePath("a\\b.js", "files entry")).toThrow(
      /forward slashes/,
    );
    expect(() => normalizePackagePath("https://x/y.js", "files entry")).toThrow(
      /package-relative/,
    );
    expect(normalizePackagePath("./a//b.js", "files entry")).toBe("a/b.js");
  });

  it("rejects out-of-range price and minVersionCode", () => {
    expect(() =>
      parsePluginManifest(JSON.stringify({ ...VALID_MANIFEST, price: 20000 })),
    ).toThrow(/price/);
    expect(() =>
      parsePluginManifest(
        JSON.stringify({ ...VALID_MANIFEST, minVersionCode: -1 }),
      ),
    ).toThrow(/minVersionCode/);
  });
});

describe("zip package reader", () => {
  it("reads STORE and DEFLATE entries with CRC verification", () => {
    const stored = zipOfFiles(
      { "plugin.json": JSON.stringify(VALID_MANIFEST), "a.txt": "a" },
      { store: true },
    );
    const deflated = zipOfFiles(
      { "plugin.json": JSON.stringify(VALID_MANIFEST), "a.txt": "a" },
      { store: false },
    );
    for (const zip of [stored, deflated]) {
      const pkg = readPluginPackage(zip);
      expect(pkg.files.get("a.txt")).toEqual(new TextEncoder().encode("a"));
      expect(pkg.prefix).toBe("");
    }
  });

  it("supports single-root-folder packages (GitHub archive style)", () => {
    const zip = zipOfFiles(
      {
        "main.js": "entry();",
        "plugin.json": JSON.stringify(VALID_MANIFEST),
      },
      { prefix: "acode-plugin-main/" },
    );
    const pkg = readPluginPackage(zip);
    expect(pkg.prefix).toBe("acode-plugin-main/");
    expect(pkg.files.has("main.js")).toBe(true);
  });

  it("rejects archives without plugin.json", () => {
    const zip = zipOfFiles({ "not-the-manifest.json": "{}" });
    expect(() => readPluginPackage(zip)).toThrow(/plugin.json is missing/);
  });

  it("rejects corrupted archives", () => {
    const zip = zipOfFiles({ "plugin.json": "{}" });
    const corrupted = zip.slice(0, zip.length - 12);
    expect(() => readPluginPackage(corrupted)).toThrow(ZipError);
    expect(() => readPluginPackage(new Uint8Array([1, 2, 3]))).toThrow(ZipError);
  });

  it("rejects path traversal entries", () => {
    const zip = buildZip([
      {
        data: new TextEncoder().encode("{}"),
        name: "../evil.json",
        store: true,
      },
    ]);
    expect(() => readPluginPackage(zip)).toThrow();
  });

  it("rejects absolute path entries", () => {
    const zip = buildZip([
      { data: new TextEncoder().encode("{}"), name: "/etc/evil", store: true },
    ]);
    expect(() => readPluginPackage(zip)).toThrow(/absolute/);
  });

  it("rejects symlink entries", () => {
    const data = new TextEncoder().encode("{}");
    const zip = buildZip([
      { data, name: "plugin.json", store: true },
      { data, name: "link.js", store: true },
    ]);
    // Patch the central directory external attributes of the second entry
    // to carry S_IFLNK (0o120000 << 16).
    const view = new DataView(zip.buffer);
    let patched = false;
    for (let i = 0; i < zip.length - 46 && !patched; i += 1) {
      if (view.getUint32(i, true) === 0x02014b50) {
        const nameLength = view.getUint16(i + 28, true);
        const name = new TextDecoder().decode(
          zip.subarray(i + 46, i + 46 + nameLength),
        );
        if (name === "link.js") {
          view.setUint32(i + 38, (0o120777 << 16) >>> 0, true);
          patched = true;
        }
      }
    }
    expect(patched).toBe(true);
    expect(() => readPluginPackage(zip)).toThrow(/symlink/);
  });

  it("detects a flipped byte through CRC", () => {
    const source = new TextEncoder().encode(JSON.stringify(VALID_MANIFEST));
    const zip = buildZip([{ data: source, name: "plugin.json", store: true }]);
    expect(crc32(source)).toBe(crc32(source));
    // Flip one stored byte inside the file data: header (30) + name (11).
    zip[41] ^= 0xff;
    expect(() => readPluginPackage(zip)).toThrow(/Integrity/);
  });
});

