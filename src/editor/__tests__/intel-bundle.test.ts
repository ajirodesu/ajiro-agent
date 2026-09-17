/**
 * Vendor-output integrity: the committed intel bundle must load and serve
 * real semantic results. Guards `npm run vendor:intel` output in CI.
 */
import { describe, expect, it } from "vitest";

import { INTEL_BUNDLE_JS, INTEL_LIB_NAMES } from "@/editor/intelBundle";

describe("intel bundle", () => {
  it("embeds the lib closure", () => {
    expect(INTEL_LIB_NAMES.length).toBeGreaterThan(10);
    expect(INTEL_LIB_NAMES).toContain("lib.es2022.d.ts");
    expect(INTEL_LIB_NAMES).toContain("lib.dom.d.ts");
  });

  it("evaluates and serves completions + outline", async () => {
    const factory = new Function(
      `${INTEL_BUNDLE_JS}; return typeof AjiroIntel !== "undefined" ? AjiroIntel : null;`,
    );
    const global = factory() as {
      createSession(events: { post: () => void }): {
        setOpenDocument(uri: string, version: number, text: string): void;
        complete(
          uri: string,
          version: number,
          line: number,
          column: number,
          wordPrefix: string,
          inString: boolean,
          stringPrefix: string,
          invoked: boolean,
          trigger: string | null,
        ): Promise<{ label: string }[]>;
        outline(uri: string, version: number): Promise<{ name: string }[]>;
      };
    };
    expect(global).not.toBeNull();
    const session = global.createSession({ post: () => {} });
    session.setOpenDocument(
      "file:///project/u.ts",
      1,
      "export interface User {\n  id: number;\n}\nexport const user: User = { id: 1 };\n",
    );
    const outline = await session.outline("file:///project/u.ts", 1);
    expect(outline.map((symbol) => symbol.name)).toContain("User");
  }, 60000);
});
