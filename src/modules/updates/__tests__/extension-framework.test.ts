import { describe, expect, it } from "vitest";

import {
  channelVisible,
  checkNativeRequirements,
  compareDynamicVersions,
  createExtensionHealthLog,
  describeDynamicUpdateStatus,
  evaluateExtensionTrust,
  NATIVE_CAPABILITIES,
  parseRevocationList,
  parseUpdateChannel,
  rolloutAllows,
} from "../extension-framework";

describe("update channels", () => {
  it("parses known channels and rejects the rest", () => {
    expect(parseUpdateChannel("stable")).toBe("stable");
    expect(parseUpdateChannel("beta")).toBe("beta");
    expect(parseUpdateChannel("preview")).toBe("preview");
    expect(parseUpdateChannel("nightly")).toBeNull();
    expect(parseUpdateChannel(null)).toBeNull();
  });

  it("never leaks higher-risk channels downward", () => {
    expect(channelVisible(undefined, "stable")).toBe(true);
    expect(channelVisible("stable", "stable")).toBe(true);
    expect(channelVisible("beta", "stable")).toBe(false);
    expect(channelVisible("beta", "beta")).toBe(true);
    expect(channelVisible("preview", "beta")).toBe(false);
    expect(channelVisible("preview", "preview")).toBe(true);
    expect(channelVisible("stable", "preview")).toBe(true);
  });
});

describe("trust evaluation", () => {
  it("ranks revocation and failed validation first", () => {
    expect(evaluateExtensionTrust({ revoked: true })).toBe("revoked");
    expect(evaluateExtensionTrust({ signatureValid: false })).toBe("invalid");
    expect(
      evaluateExtensionTrust({ expectedHashPresent: true, hashMatches: false }),
    ).toBe("invalid");
  });

  it("prefers signatures, then trust, then hashes, then unknown", () => {
    expect(evaluateExtensionTrust({ signatureValid: true })).toBe("verified");
    expect(evaluateExtensionTrust({ publisherTrusted: true })).toBe("trusted");
    expect(
      evaluateExtensionTrust({ expectedHashPresent: true, hashMatches: true }),
    ).toBe("trusted");
    expect(evaluateExtensionTrust({})).toBe("unknown");
  });
});

describe("native capabilities", () => {
  it("lists the embedded runtime surface", () => {
    expect(NATIVE_CAPABILITIES).toContain("mcp:http");
    expect(NATIVE_CAPABILITIES).toContain("mcp:sse");
    expect(NATIVE_CAPABILITIES).toContain("pluginRuntime");
    expect(NATIVE_CAPABILITIES).toContain("skillRuntime");
  });

  it("reports exactly the missing capabilities", () => {
    expect(checkNativeRequirements(["network", "mcp:http"]).satisfied).toBe(true);
    const result = checkNativeRequirements(["network", "mcp:stdio", "arKit"]);
    expect(result.satisfied).toBe(false);
    expect(result.missing).toEqual(["mcp:stdio", "arKit"]);
  });

  it("treats absent requirements as satisfied", () => {
    expect(checkNativeRequirements(null).satisfied).toBe(true);
    expect(checkNativeRequirements([]).satisfied).toBe(true);
  });
});

describe("version comparison", () => {
  it("orders numerically, not lexicographically", () => {
    expect(compareDynamicVersions("1.10.0", "1.9.0")).toBeGreaterThan(0);
    expect(compareDynamicVersions("1.0", "1.0.0")).toBe(0);
    expect(compareDynamicVersions("2.0.0", "10.0.0")).toBeLessThan(0);
    expect(compareDynamicVersions("1.2.3", "1.2.3")).toBe(0);
  });
});

describe("gradual rollouts", () => {
  it("passes unset and full rollouts, blocks empty ones", () => {
    expect(rolloutAllows(undefined, "x")).toBe(true);
    expect(rolloutAllows(100, "x")).toBe(true);
    expect(rolloutAllows(0, "x")).toBe(false);
  });

  it("is deterministic per id and roughly proportional", () => {
    const ids = Array.from({ length: 200 }, (_, index) => `ext-${index}`);
    expect(ids.every((id) => rolloutAllows(50, id) === rolloutAllows(50, id))).toBe(true);
    const admitted = ids.filter((id) => rolloutAllows(50, id)).length;
    expect(admitted).toBeGreaterThan(50);
    expect(admitted).toBeLessThan(150);
  });
});

describe("revocation lists", () => {
  it("accepts strings and id-shaped records", () => {
    const revoked = parseRevocationList(["a", { id: "b" }, { slug: "c" }, 42, " "]);
    expect([...revoked].sort()).toEqual(["a", "b", "c"]);
    expect(parseRevocationList(null).size).toBe(0);
  });
});

describe("status labels", () => {
  it("names every store-visible state", () => {
    expect(describeDynamicUpdateStatus("requires-app-update")).toBe("Requires App Update");
    expect(describeDynamicUpdateStatus("revoked")).toBe("Revoked");
    expect(describeDynamicUpdateStatus("latest")).toBe("Latest");
  });
});

describe("health log", () => {
  it("records locally and caps the buffer", () => {
    const log = createExtensionHealthLog();
    for (let index = 0; index < 250; index += 1) {
      log.record("skill", `skill-${index}`, "install-success");
    }
    expect(log.events()).toHaveLength(200);
    expect(log.events()[0]?.extensionId).toBe("skill-50");
    log.clear();
    expect(log.events()).toHaveLength(0);
  });
});
