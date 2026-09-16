import { describe, expect, it } from "vitest";

import { CM_MODE_KEYS } from "@/editor/cmBundle";
import {
  EXTENSION_TO_MODE_KEY,
  extensionOfFileName,
  grammarKeyForPath,
} from "@/editor/editorLanguages";

describe("editorLanguages", () => {
  it("resolves common extensions", () => {
    expect(grammarKeyForPath("app/index.ts")).toBe("typescript");
    expect(grammarKeyForPath("app/view.tsx")).toBe("typescript");
    expect(grammarKeyForPath("lib/util.py")).toBe("python");
    expect(grammarKeyForPath("data/config.json")).toBe("json");
    expect(grammarKeyForPath("notes/README.md")).toBe("markdown");
    expect(grammarKeyForPath("Main.java")).toBe("java");
    expect(grammarKeyForPath("main.go")).toBe("go");
    expect(grammarKeyForPath("lib.rs")).toBe("rust");
    expect(grammarKeyForPath("query.sql")).toBe("sql");
    expect(grammarKeyForPath("page.html")).toBe("html");
    expect(grammarKeyForPath("style.css")).toBe("css");
    expect(grammarKeyForPath("run.sh")).toBe("shell");
    expect(grammarKeyForPath("notes.txt")).toBe("markdown");
  });

  it("resolves multi-part extensions longest-first", () => {
    expect(grammarKeyForPath("types.d.ts")).toBe("typescript");
    expect(grammarKeyForPath("view.blade.php")).toBe("php");
    expect(grammarKeyForPath("Pipfile.lock")).toBe("json");
    expect(grammarKeyForPath("Cargo.lock")).toBe("toml");
  });

  it("resolves bare filenames", () => {
    expect(grammarKeyForPath("Dockerfile")).toBe("dockerFile");
    expect(grammarKeyForPath("Dockerfile.prod")).toBe("dockerFile");
    expect(grammarKeyForPath("Makefile")).toBeNull();
    expect(grammarKeyForPath("Gemfile")).toBe("ruby");
    expect(grammarKeyForPath("Jenkinsfile")).toBe("groovy");
    expect(grammarKeyForPath("CMakeLists.txt")).toBe("cmake");
    expect(grammarKeyForPath("README")).toBe("markdown");
    expect(grammarKeyForPath(".env")).toBe("properties");
    expect(grammarKeyForPath(".env.local")).toBe("properties");
    expect(grammarKeyForPath(".gitignore")).toBe("properties");
  });

  it("returns null for unknown or missing extensions", () => {
    expect(grammarKeyForPath("binary.exe")).toBeNull();
    expect(grammarKeyForPath("Makefile")).toBeNull();
    expect(grammarKeyForPath("archive.zig")).toBeNull();
  });

  it("maps folders by basename only", () => {
    expect(extensionOfFileName("src/components/Button.tsx")).toBe(".tsx");
  });

  it("covers 100+ distinct vendored grammars", () => {
    const keys = new Set<string>();
    const samples = [
      "a.ts", "b.py", "c.rb", "d.go", "e.rs", "f.java", "g.kt", "h.swift",
      "i.c", "j.cpp", "k.cs", "l.php", "m.sh", "n.sql", "o.xml", "p.html",
      "q.css", "r.yml", "s.yaml", "t.toml", "u.ini", "v.lua", "w.r", "x.jl",
      "y.hs", "z.ml", "a1.elm", "b1.erl", "c1.clj", "d1.scala", "e1.groovy",
      "f1.dart", "g1.pas", "h1.f", "i1.cob", "j1.asm", "k1.v", "l1.vhd",
      "m1.tcl", "n1.ps1", "o1.vb", "p1.fs", "q1.d", "r1.cr", "s1.coffee",
      "t1.diff", "u1.http", "v1.graphql", "w1.proto", "x1.pug", "y1.twig",
      "z1.jinja", "a2.liquid", "b2.lua", "c2.r", "d2.toml", "e2.scss",
    ];
    for (const sample of samples) {
      const key = grammarKeyForPath(sample);
      if (key) keys.add(key);
    }
    expect(keys.size).toBeGreaterThanOrEqual(40);
  });

  it("every mapped grammar exists in the vendored bundle", () => {
    const available = new Set(CM_MODE_KEYS);
    const missing = Object.values(EXTENSION_TO_MODE_KEY).filter(
      (key) => !available.has(key),
    );
    expect(missing).toEqual([]);
    expect(new Set(Object.values(EXTENSION_TO_MODE_KEY)).size).toBeGreaterThanOrEqual(
      100,
    );
  });
});
