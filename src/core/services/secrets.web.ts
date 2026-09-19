/**
 * Web Preview secrets: same `SecretStore` interface as the native module,
 * backed by an in-memory map. Keys entered during a preview session work
 * for that session (providers connect, OAuth completes); nothing persists
 * and nothing touches disk. A console warning states this once.
 */
import {
  getMcpHeaderValuesKey,
  getMcpOAuthTokensKey,
  getProviderApiKeyKey,
  normalizeExpiresAt,
  parseHeaderValues,
  parseMcpOAuthSession,
} from "@/core/services/secrets-shared";
import type { SecretStore } from "@/core/services/secrets";
import type { ProviderConfig } from "@/core/types/app-state";

// Re-exported so type consumers resolve identically on both platforms.
export type {
  McpOAuthSession,
  McpOAuthTokens,
  SecretStore,
} from "@/core/services/secrets";

const memory = new Map<string, string>();

let warned = false;

function warnOnce() {
  if (!warned) {
    warned = true;
    console.warn(
      "[web-preview] Secrets are held in memory for this session only; nothing is persisted.",
    );
  }
}

async function readSession(serverId: string) {
  // Shared parser: web reads sessions (including legacy shapes) exactly
  // like native does.
  return parseMcpOAuthSession(
    memory.get(getMcpOAuthTokensKey(serverId)) ?? null,
  );
}

export const secureSecretStore: SecretStore = {
  async deleteProviderApiKey(providerId) {
    warnOnce();
    memory.delete(getProviderApiKeyKey(providerId));
  },
  async deleteMcpHeaderValues(serverId) {
    warnOnce();
    memory.delete(getMcpHeaderValuesKey(serverId));
  },
  async deleteMcpOAuthTokens(serverId) {
    warnOnce();
    memory.delete(getMcpOAuthTokensKey(serverId));
  },
  async getMcpHeaderValues(serverId) {
    warnOnce();
    return parseHeaderValues(
      memory.get(getMcpHeaderValuesKey(serverId)) ?? null,
    );
  },
  async getMcpOAuthSession(serverId) {
    warnOnce();
    return readSession(serverId);
  },
  async getMcpOAuthTokens(serverId: string) {
    warnOnce();
    const session = await readSession(serverId);

    if (!session?.tokens?.access_token) {
      return null;
    }

    return {
      accessToken: session.tokens.access_token,
      expiresAt: session.expiresAt ?? null,
      refreshToken: session.tokens.refresh_token ?? null,
      tokenType: session.tokens.token_type ?? null,
    };
  },
  async getProviderApiKey(providerId) {
    warnOnce();
    return memory.get(getProviderApiKeyKey(providerId)) ?? null;
  },
  async hasProviderCredential(provider: ProviderConfig) {
    warnOnce();
    if (!provider.enabled) {
      return false;
    }
    if (provider.authType === "none") {
      return true;
    }
    // OAuth token refresh needs native browser/session plumbing, so
    // OAuth providers stay unconfigured in preview (deliberate).
    if (provider.authType === "oauth") {
      return false;
    }

    const apiKey = memory.get(getProviderApiKeyKey(provider.id));

    if (!apiKey) {
      return false;
    }

    if (provider.family === "openai-compatible") {
      return Boolean(provider.baseUrl?.trim());
    }

    return true;
  },
  async setProviderApiKey(providerId, apiKey) {
    warnOnce();
    memory.set(getProviderApiKeyKey(providerId), apiKey);
  },
  async setMcpHeaderValues(serverId, headers) {
    warnOnce();
    memory.set(getMcpHeaderValuesKey(serverId), JSON.stringify(headers));
  },
  async setMcpOAuthSession(serverId, session) {
    warnOnce();
    memory.set(getMcpOAuthTokensKey(serverId), JSON.stringify(session));
  },
  async setMcpOAuthTokens(serverId, tokens) {
    warnOnce();
    const session = (await readSession(serverId)) ?? {};
    await this.setMcpOAuthSession(serverId, {
      ...session,
      expiresAt: normalizeExpiresAt(tokens.expiresAt),
      tokens: {
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken ?? undefined,
        token_type: tokens.tokenType ?? "Bearer",
      },
    });
  },
};
