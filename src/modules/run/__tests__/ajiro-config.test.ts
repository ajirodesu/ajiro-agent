import { describe, expect, it } from "vitest";

import {
  AJIRO_FILE_NAME,
  detectRunScript,
  generateAjiroConfig,
  parseAjiroConfig,
  parsePackageScripts,
  serializeAjiroConfig,
  syncAjiroConfig,
} from "@/modules/run/ajiro-config";

describe("ajiro-config", () => {
  it("detects the run script by priority", () => {
    expect(
      detectRunScript({ build: "x", dev: "vite", start: "node ." }),
    ).toBe("dev");
    expect(detectRunScript({ start: "node .", serve: "serve" })).toBe(
      "start",
    );
    expect(detectRunScript({ preview: "vite preview" })).toBe("preview");
    expect(detectRunScript({ build: "tsc", test: "vitest" })).toBeNull();
    expect(detectRunScript({})).toBeNull();
  });

  it("parses package.json scripts and rejects garbage", () => {
    expect(
      parsePackageScripts('{"scripts": {"dev": "vite", "n": 42}}'),
    ).toEqual({ dev: "vite" });
    expect(parsePackageScripts('{"name": "x"}')).toEqual({});
    expect(() => parsePackageScripts("not json")).toThrow();
    expect(() => parsePackageScripts("[]")).toThrow();
  });

  it("generates a fresh config from package.json", () => {
    const config = generateAjiroConfig(
      '{"scripts": {"dev": "vite", "build": "tsc"}}',
    );
    expect(config).toEqual({
      version: 1,
      run: { script: "dev", command: "npm run dev" },
    });
    expect(() => JSON.parse(serializeAjiroConfig(config))).not.toThrow();
  });

  it("generates an empty selection when nothing is runnable", () => {
    expect(generateAjiroConfig('{"scripts": {"test": "x"}}')).toEqual({
      version: 1,
      run: { script: null, command: null },
    });
  });

  it("keeps a still-valid selection verbatim on sync", () => {
    const stored = serializeAjiroConfig({
      version: 1,
      run: { script: "dev", command: "npm run dev" },
    });
    const result = syncAjiroConfig(
      stored,
      '{"scripts": {"dev": "vite --port 9999", "build": "x"}}',
      { dev: "vite --port 9999", build: "x" },
    );
    expect(result.changed).toBe(false);
    expect(result.notice).toBeNull();
    expect(result.config.run.script).toBe("dev");
  });

  it("re-syncs when the selected script vanished", () => {
    const stored = serializeAjiroConfig({
      version: 1,
      run: { script: "dev", command: "npm run dev" },
    });
    const result = syncAjiroConfig(
      stored,
      '{"scripts": {"start": "node ."}}',
      { start: "node ." },
    );
    expect(result.changed).toBe(true);
    expect(result.config.run.script).toBe("start");
    expect(result.notice).toContain("dev");
  });

  it("regenerates missing or malformed stored configs", () => {
    const fresh = syncAjiroConfig(null, '{"scripts": {"dev": "vite"}}', {
      dev: "vite",
    });
    expect(fresh.changed).toBe(true);
    expect(fresh.config.run.script).toBe("dev");
    const broken = syncAjiroConfig("{oops", '{"scripts": {}}', {});
    expect(broken.changed).toBe(true);
    expect(broken.config.run.script).toBeNull();
    expect(broken.notice).toContain("regenerated");
  });

  it("parses stored configs defensively", () => {
    expect(parseAjiroConfig(null)).toBeNull();
    expect(parseAjiroConfig("")).toBeNull();
    expect(parseAjiroConfig("{}")).toBeNull();
    expect(
      parseAjiroConfig('{"run": {"script": "dev", "command": "npm run dev"}}'),
    ).toEqual({ version: 1, run: { script: "dev", command: "npm run dev" } });
    expect(parseAjiroConfig('{"run": {"script": 42}}')).toEqual({
      version: 1,
      run: { script: null, command: null },
    });
  });

  it("uses the canonical file name", () => {
    expect(AJIRO_FILE_NAME).toBe(".ajiro");
  });
});
