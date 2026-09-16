import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  SPLASH_FADE_OUT_MS,
  SPLASH_MARK_WIDTH_FRACTION,
} from "@/launch/splash";

const root = process.cwd();

function pngInfo(path: string): { width: number; height: number; colorType: number } {
  const buffer = readFileSync(path);
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    colorType: buffer[25]!,
  };
}

describe("launch splash", () => {
  it("stays instant with a ChatGPT-proportioned mark", () => {
    expect(SPLASH_FADE_OUT_MS).toBeGreaterThan(0);
    expect(SPLASH_FADE_OUT_MS).toBeLessThanOrEqual(400);
    expect(SPLASH_MARK_WIDTH_FRACTION).toBeGreaterThanOrEqual(0.15);
    expect(SPLASH_MARK_WIDTH_FRACTION).toBeLessThanOrEqual(0.4);
  });

  it("registers square high-resolution icons for every platform slot", () => {
    const config = JSON.parse(readFileSync(join(root, "app.json"), "utf8")) as {
      expo: {
        icon: string;
        ios?: { icon?: string };
        android?: { adaptiveIcon?: { foregroundImage?: string } };
      };
    };
    for (const key of [
      config.expo.icon,
      config.expo.ios?.icon,
      config.expo.android?.adaptiveIcon?.foregroundImage,
    ]) {
      expect(typeof key).toBe("string");
      const path = join(root, key as string);
      expect(existsSync(path)).toBe(true);
      const info = pngInfo(path);
      expect(info.width).toBe(info.height);
      expect(info.width).toBeGreaterThanOrEqual(1024);
    }
  });

  it("keeps the native splash imageless for an instant launch", () => {
    const config = JSON.parse(readFileSync(join(root, "app.json"), "utf8")) as {
      expo: { plugins: unknown[] };
    };
    const splash = config.expo.plugins.find(
      (plugin): plugin is [string, Record<string, unknown>] =>
        Array.isArray(plugin) && plugin[0] === "expo-splash-screen",
    );
    expect(splash).toBeTruthy();
    expect(typeof splash![1].backgroundColor).toBe("string");
    expect("image" in splash![1]).toBe(false);
  });

  it("ships a transparent splash mark for the theme overlay", () => {
    const path = join(root, "assets", "images", "new-splash-icon.png");
    expect(existsSync(path)).toBe(true);
    const info = pngInfo(path);
    expect(info.colorType).toBe(6);
    expect(info.width).toBe(info.height);
    expect(info.width).toBeGreaterThanOrEqual(512);
  });
});
