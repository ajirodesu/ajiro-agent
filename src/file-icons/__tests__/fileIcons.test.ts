import { describe, expect, it } from "vitest";

import {
  FILE_ICON_DEFAULT,
  FILE_ICON_FILES,
  FILE_ICON_FILE_EXTENSIONS,
  FILE_ICON_FILE_NAMES,
  FILE_ICON_SVGS,
} from "@/file-icons/fileIconManifest";
import {
  iconNameForFile,
  svgForFile,
  svgForIcon,
} from "@/file-icons/resolveFileIcon";

function manifestIconFor(basename: string): string {
  const lower = basename.toLowerCase();
  return (
    FILE_ICON_FILE_NAMES[lower] ??
    FILE_ICON_FILE_EXTENSIONS[lower.split(".").pop() ?? ""] ??
    FILE_ICON_DEFAULT
  );
}

describe("resolveFileIcon (manifest-driven, nothing hardcoded)", () => {
  it("resolves exact file names ahead of their extensions", () => {
    expect(iconNameForFile("Dockerfile")).toBe(
      FILE_ICON_FILE_NAMES["dockerfile"],
    );
    expect(iconNameForFile("docker-compose.yml")).toBe(
      FILE_ICON_FILE_NAMES["docker-compose.yml"] ??
        FILE_ICON_FILE_EXTENSIONS["yml"],
    );
    // package.json is an exact match; its icon must NOT be the plain json one.
    expect(iconNameForFile("package.json")).toBe(
      FILE_ICON_FILE_NAMES["package.json"],
    );
    expect(FILE_ICON_FILE_NAMES["package.json"]).not.toBe(
      FILE_ICON_FILE_EXTENSIONS["json"],
    );
  });

  it("resolves compound extensions longest-first", () => {
    expect(FILE_ICON_FILE_EXTENSIONS["test.tsx"]).toBeTruthy();
    expect(iconNameForFile("component.test.tsx")).toBe(
      FILE_ICON_FILE_EXTENSIONS["test.tsx"],
    );
    expect(iconNameForFile("types.d.ts")).toBe(
      FILE_ICON_FILE_EXTENSIONS["d.ts"] ?? FILE_ICON_FILE_EXTENSIONS["ts"],
    );
  });

  it("resolves single trailing extensions from manifest data", () => {
    for (const sample of [
      "app.ts",
      "notes.md",
      "photo.png",
      "picture.jpg",
      "graphic.svg",
      "clip.mp4",
      "song.mp3",
      "doc.pdf",
      "main.py",
      "main.go",
      "lib.rs",
      "Main.java",
    ]) {
      expect(iconNameForFile(sample)).toBe(manifestIconFor(sample));
      expect(iconNameForFile(sample)).not.toBe(FILE_ICON_DEFAULT);
    }
  });

  it("matches dotfiles and case-insensitively", () => {
    expect(iconNameForFile(".gitignore")).toBe(
      FILE_ICON_FILE_NAMES[".gitignore"] ?? FILE_ICON_DEFAULT,
    );
    expect(iconNameForFile("APP.TS")).toBe(iconNameForFile("app.ts"));
    expect(iconNameForFile("src/app.TS")).toBe(iconNameForFile("app.ts"));
  });

  it("falls back to the default file icon when the manifest has no match", () => {
    expect(iconNameForFile("archive.zzzqxj")).toBe(FILE_ICON_DEFAULT);
    expect(iconNameForFile("xqzyblorp")).toBe(FILE_ICON_DEFAULT);
    expect(iconNameForFile("trailing.")).toBe(FILE_ICON_DEFAULT);
  });

  it("ships SVG art for every icon the manifest can resolve", () => {
    const resolvable = new Set([
      ...Object.values(FILE_ICON_FILE_NAMES),
      ...Object.values(FILE_ICON_FILE_EXTENSIONS),
      FILE_ICON_DEFAULT,
    ]);
    const missing = [...resolvable].filter(
      (name) => svgForIcon(name) === null,
    );
    expect(missing).toEqual([]);
    expect(svgForFile("anything.zzzqxj")).toBe(svgForIcon(FILE_ICON_DEFAULT));
  });

  it("resolves the app-owned .ajiro config icon", () => {
    expect(FILE_ICON_FILE_EXTENSIONS["ajiro"]).toBe("ajiro");
    expect(svgForFile(".ajiro")).not.toBe(svgForIcon(FILE_ICON_DEFAULT));
    const xml = svgForFile("project/.ajiro");
    expect(xml).toBeTruthy();
    expect(xml).toContain("<image");
    expect(xml).toContain("data:image/png;base64,");
  });

  it("ships valid SVG documents as self-hosted assets", () => {
    for (const sample of ["app.ts", "Dockerfile", "clip.mp4", "doc.pdf"]) {
      const xml = svgForFile(sample);
      expect(xml).toBeTruthy();
      expect(xml!.trimStart().startsWith("<svg")).toBe(true);
      // No remote references (the xmlns namespace identifier is static,
      // not a fetch). Real fetches would look like these patterns.
      expect(xml).not.toMatch(/xlink:href="https?:|<image[^>]*href="https?:|url\(https?:|@import/);
    }
    expect(Object.keys(FILE_ICON_FILES).length).toBeGreaterThan(500);
    expect(Object.keys(FILE_ICON_SVGS).length).toBeGreaterThan(500);
  });
});
