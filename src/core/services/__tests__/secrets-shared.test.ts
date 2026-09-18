import { describe, expect, it } from "vitest";

import {
  getMcpHeaderValuesKey,
  getMcpOAuthTokensKey,
  getProviderApiKeyKey,
  isRecord,
  normalizeExpiresAt,
  parseHeaderValues,
} from "@/core/services/secrets-shared";

describe("secrets-shared key builders", () => {
  it("namespaces provider, header, and oauth keys distinctly", () => {
    expect(getProviderApiKeyKey("openai")).toBe("provider_openai_apiKey");
    expect(getMcpHeaderValuesKey("srv")).toBe("mcp_srv_headers");
    expect(getMcpOAuthTokensKey("srv")).toBe("mcp_srv_oauth_tokens");
  });
});

describe("normalizeExpiresAt", () => {
  it("keeps finite numbers and nulls everything else", () => {
    expect(normalizeExpiresAt(1700000000)).toBe(1700000000);
    expect(normalizeExpiresAt(null)).toBeNull();
    expect(normalizeExpiresAt(undefined)).toBeNull();
    expect(normalizeExpiresAt("1700000000")).toBeNull();
    expect(normalizeExpiresAt(Number.NaN)).toBeNull();
    expect(normalizeExpiresAt(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("isRecord", () => {
  it("accepts plain objects only", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord([])).toBe(false);
    expect(isRecord("x")).toBe(false);
  });
});

describe("parseHeaderValues", () => {
  it("returns {} for null, malformed JSON, and non-objects", () => {
    expect(parseHeaderValues(null)).toEqual({});
    expect(parseHeaderValues("not json")).toEqual({});
    expect(parseHeaderValues("[1,2]")).toEqual({});
    expect(parseHeaderValues('"str"')).toEqual({});
  });

  it("keeps string pairs and drops non-string values", () => {
    expect(
      parseHeaderValues(
        JSON.stringify({ a: "1", b: 2, c: null, d: { e: 1 } }),
      ),
    ).toEqual({ a: "1" });
  });
});
