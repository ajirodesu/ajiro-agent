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
  isRecord,
  normalizeExpiresAt,
  parseHeaderValues,
} from "@/core/services/secrets-shared";
import type {
  McpOAuthSession,
  SecretStore,
} from "@/core/services/secrets";
import type { ProviderConfig } from "@/core/types/app-state";

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

async function readSession(serverId: string): Promise<McpOAuthSession | null> {
  const raw = memory.get(getMcpOAuthTokensKey(serverId)) ?? null;
  if (!raw) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? (parsed as McpOAuthSession) : null;
  } catch {
    return null;
  }
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
    const accessToken =
      session?.tokens && typeof session.tokens.access_token === "string"
        ? session.tokens.access_token
        : null;
    if (!accessToken) {
      return null;
    }
    return {
      accessToken,
      expiresAt: normalizeExpiresAt(session?.expiresAt),
      refreshToken:
        typeof session?.tokens?.refresh_token === "string"
          ? (session.tokens.refresh_token as string)
          : null,
      tokenType:
        typeof session?.tokens?.token_type === "string"
          ? (session.tokens.token_type as string)
          : null,
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
    // OAuth token refresh needs native browser/session plumbing; API keys
    // work in-memory for the session.
    if (provider.authType === "oauth") {
      return false;
    }
    return memory.has(getProviderApiKeyKey(provider.id));
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
