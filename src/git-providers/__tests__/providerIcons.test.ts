import { describe, expect, it } from "vitest";

import { PROVIDER_BRANDS } from "@/git-providers/providerIcons";

describe("providerIcons (self-hosted brand marks)", () => {
  it("ships official vector data for every connection provider", () => {
    for (const slug of ["github", "bitbucket", "gitlab"] as const) {
      const brand = PROVIDER_BRANDS[slug];
      expect(brand.title).toBeTruthy();
      expect(brand.hex).toMatch(/^[0-9a-fA-F]{6}$/);
      expect(brand.path.length).toBeGreaterThan(50);
    }
  });
});
