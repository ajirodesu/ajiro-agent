import { describe, expect, it } from "vitest";

import { boundImports, findUnusedImports, shouldOfferOrganizeImports } from "@/modules/intel/imports";

describe("import intelligence", () => {
  it("finds unused imports across styles", () => {
    const text = [
      `import React, { useState as State, useEffect } from "react";`,
      `import * as path from "path";`,
      `const { join } = require("path");`,
      `const fs = require("fs");`,
      `console.log(React, State, join);`,
      ``,
    ].join("\n");
    const unused = findUnusedImports(text).map((entry) => entry.name).sort();
    expect(unused).toEqual(["fs", "path", "useEffect"]);
  });

  it("binds aliased and default names", () => {
    const bound = boundImports(`import Def, { a as b } from "m";`);
    expect(bound.map((entry) => entry.name).sort()).toEqual(["Def", "b"]);
  });

  it("offers organize for unused or unsorted imports", () => {
    expect(shouldOfferOrganizeImports(`import { b } from "z";\nimport { a } from "a";\nuse(a, b);`)).toBe(true);
    expect(shouldOfferOrganizeImports(`const x = 1;\nuse(x);`)).toBe(false);
    expect(shouldOfferOrganizeImports(`import { a } from "a";\nuse(a);`)).toBe(false);
  });
});
