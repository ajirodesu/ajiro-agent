import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import {
  getThemedAssetFile,
  resolveThemedAssetFile,
  themedAssetFileName,
  THEMED_ASSET_FALLBACK_VARIANT,
} from "@/theme/themed-asset-sources";
import type { AppThemeId } from "@/theme/types";

const ASSETS = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "assets",
  "images",
);

describe("getThemedAssetFile", () => {
  it("maps every known theme id to its own variant file", () => {
    expect(getThemedAssetFile("icon", "aqua", "dark")).toBe("icon-aqua.png");
    expect(getThemedAssetFile("icon", "burnt", "light")).toBe(
      "icon-burnt.png",
    );
    expect(getThemedAssetFile("icon", "indigo", "light")).toBe(
      "icon-indigo.png",
    );
    expect(getThemedAssetFile("icon", "dark", "dark")).toBe("icon-dark.png");
    expect(getThemedAssetFile("icon", "light", "light")).toBe(
      "icon-light.png",
    );
    expect(getThemedAssetFile("splash", "burnt", "dark")).toBe(
      "splash-icon-burnt.png",
    );
  });

  it("resolves system through the device scheme, defaulting to dark", () => {
    expect(getThemedAssetFile("icon", "system", "light")).toBe(
      "icon-light.png",
    );
    expect(getThemedAssetFile("icon", "system", "dark")).toBe("icon-dark.png");
    expect(getThemedAssetFile("icon", "system", null)).toBe("icon-dark.png");
    expect(getThemedAssetFile("icon", "system", undefined)).toBe(
      "icon-dark.png",
    );
  });

  it("falls back to the default variant for unknown or missing themes", () => {
    const fallback = `icon-${THEMED_ASSET_FALLBACK_VARIANT}.png`;
    expect(getThemedAssetFile("icon", "nope" as AppThemeId, "dark")).toBe(
      fallback,
    );
    expect(getThemedAssetFile("icon", null, "dark")).toBe(fallback);
    expect(getThemedAssetFile("icon", undefined, "dark")).toBe(fallback);
    expect(getThemedAssetFile("splash", "nope" as AppThemeId, "light")).toBe(
      `splash-${fallback}`,
    );
  });

  it("has every resolved file on disk for both kinds", () => {
    const themes: AppThemeId[] = [
      "system",
      "light",
      "dark",
      "aqua",
      "burnt",
      "indigo",
    ];
    for (const themeId of themes) {
      for (const kind of ["icon", "splash"] as const) {
        for (const scheme of ["light", "dark", null] as const) {
          const file = getThemedAssetFile(kind, themeId, scheme);
          expect(existsSync(join(ASSETS, file)), file).toBe(true);
        }
      }
    }
  });

  it("names files per kind and variant", () => {
    expect(themedAssetFileName("icon", "burnt")).toBe("icon-burnt.png");
    expect(themedAssetFileName("splash", "burnt")).toBe("splash-icon-burnt.png");
    expect(themedAssetFileName("splash", THEMED_ASSET_FALLBACK_VARIANT)).toBe(
      "splash-icon-aqua.png",
    );
  });

  it("falls back within the same kind when artwork is unbundled", () => {
    const bundled = new Set(["icon-aqua.png", "splash-icon-aqua.png"]);
    const hasFile = (file: string) => bundled.has(file);
    // Bundled → returned unchanged.
    expect(resolveThemedAssetFile("icon", "icon-aqua.png", hasFile)).toBe(
      "icon-aqua.png",
    );
    // A missing splash mark degrades to the splash fallback — never to the
    // square app icon.
    expect(
      resolveThemedAssetFile("splash", "splash-icon-neon.png", hasFile),
    ).toBe("splash-icon-aqua.png");
    expect(resolveThemedAssetFile("icon", "icon-neon.png", hasFile)).toBe(
      "icon-aqua.png",
    );
  });

  it("warns in dev — never throws — for unknown themes and missing artwork", () => {
    const warnings: string[] = [];
    const spy = vi
      .spyOn(console, "warn")
      .mockImplementation((message?: unknown) => {
        warnings.push(String(message));
      });
    vi.stubGlobal("__DEV__", true);
    try {
      // Unknown / null theme id → default theme, with a warning.
      expect(getThemedAssetFile("icon", "nope" as AppThemeId, "dark")).toBe(
        "icon-aqua.png",
      );
      expect(resolveThemedAssetFile("icon", "icon-neon.png", () => false)).toBe(
        "icon-aqua.png",
      );
    } finally {
      vi.unstubAllGlobals();
      spy.mockRestore();
    }
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('Unknown theme "nope"');
    expect(warnings[1]).toContain('Missing artwork "icon-neon.png"');
  });
});
