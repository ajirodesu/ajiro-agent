import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { EMPTY_SETTINGS } from "@/providers/app-state/constants";
import { getThemedAssetFile } from "@/theme/themed-asset-sources";
import {
  DEFAULT_THEME_ID,
  resolveStartupThemeId,
} from "@/theme/themes";

/**
 * Fresh-install default theme lock: a brand-new install has an empty
 * settings map (no seeded theme keys anywhere in migrations), so every
 * layer that resolves "no stored preference" must land on aqua —
 * startup resolution, pre-hydration snapshot defaults, and artwork.
 */
describe("fresh install defaults to aqua", () => {
  it("resolves an empty settings map to aqua", () => {
    expect(
      resolveStartupThemeId({
        storedThemeId: undefined,
        storedThemeMode: undefined,
        hasThemeModeKey: false,
      }),
    ).toBe("aqua");
    expect(DEFAULT_THEME_ID).toBe("aqua");
  });

  it("starts the pre-hydration snapshot on aqua", () => {
    expect(EMPTY_SETTINGS.themeId).toBe("aqua");
  });

  it("seeds no theme keys in migrations", () => {
    const root = join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "..",
    );
    const migrations = readFileSync(
      join(root, "src", "core", "db", "migrations.ts"),
      "utf8",
    );
    expect(migrations).not.toMatch(/theme_id/);
    expect(migrations).not.toMatch(/theme_mode/);
  });

  it("falls back to aqua artwork with no stored theme", () => {
    expect(getThemedAssetFile("icon", undefined, null)).toBe("icon-aqua.png");
    expect(getThemedAssetFile("splash", null, "dark")).toBe(
      "splash-icon-aqua.png",
    );
  });
});
