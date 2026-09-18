import { describe, expect, it } from "vitest";

import { secureSecretStore } from "@/core/services/secrets.web";
import type { ProviderConfig } from "@/core/types/app-state";

function provider(overrides: Partial<ProviderConfig>): ProviderConfig {
  return {
    id: "p1",
    label: "P1",
    family: "openai",
    enabled: true,
    authType: "api-key",
    ...overrides,
  } as ProviderConfig;
}

describe("secrets.web SecretStore", () => {
  it("round-trips provider API keys in memory", async () => {
    await secureSecretStore.setProviderApiKey("web-p", "sk-test");
    expect(await secureSecretStore.getProviderApiKey("web-p")).toBe("sk-test");
    expect(
      await secureSecretStore.hasProviderCredential(provider({ id: "web-p" })),
    ).toBe(true);

    await secureSecretStore.deleteProviderApiKey("web-p");
    expect(await secureSecretStore.getProviderApiKey("web-p")).toBeNull();
    expect(
      await secureSecretStore.hasProviderCredential(provider({ id: "web-p" })),
    ).toBe(false);
  });

  it("reports oauth providers as unconfigured without native plumbing", async () => {
    expect(
      await secureSecretStore.hasProviderCredential(
        provider({ authType: "oauth" }),
      ),
    ).toBe(false);
    expect(
      await secureSecretStore.hasProviderCredential(
        provider({ authType: "none" }),
      ),
    ).toBe(true);
    expect(
      await secureSecretStore.hasProviderCredential(
        provider({ enabled: false }),
      ),
    ).toBe(false);
  });

  it("round-trips MCP header values and OAuth token sessions", async () => {
    await secureSecretStore.setMcpHeaderValues("srv", { a: "1" });
    expect(await secureSecretStore.getMcpHeaderValues("srv")).toEqual({
      a: "1",
    });
    await secureSecretStore.deleteMcpHeaderValues("srv");
    expect(await secureSecretStore.getMcpHeaderValues("srv")).toEqual({});

    await secureSecretStore.setMcpOAuthTokens("srv", {
      accessToken: "at",
      refreshToken: "rt",
      tokenType: "Bearer",
      expiresAt: 1700000000,
    });
    expect(await secureSecretStore.getMcpOAuthTokens("srv")).toEqual({
      accessToken: "at",
      expiresAt: 1700000000,
      refreshToken: "rt",
      tokenType: "Bearer",
    });

    await secureSecretStore.deleteMcpOAuthTokens("srv");
    expect(await secureSecretStore.getMcpOAuthTokens("srv")).toBeNull();
  });
});
