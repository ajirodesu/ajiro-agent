/**
 * Pure, platform-free helpers shared by the native SecureStore-backed
 * secrets module and its in-memory Web Preview sibling. No expo imports.
 * Type-only imports (erased at runtime) keep this side-effect free.
 */
import type {
  OAuthAuthorizationServerInformation,
  OAuthClientInformation,
  OAuthTokens,
} from "@ai-sdk/mcp";
import type { McpOAuthSession } from "@/core/services/secrets";

export function getProviderApiKeyKey(providerId: string): string {
  return `provider_${providerId}_apiKey`;
}

export function getMcpHeaderValuesKey(serverId: string): string {
  return `mcp_${serverId}_headers`;
}

export function getMcpOAuthTokensKey(serverId: string): string {
  return `mcp_${serverId}_oauth_tokens`;
}

export function normalizeExpiresAt(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseHeaderValues(raw: string | null): Record<string, string> {
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] =>
          typeof entry[0] === "string" && typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

/**
 * Normalizes a stored OAuth session, including the legacy flat shape
 * (`{accessToken, ...}`) older builds wrote. Shared so native and web
 * read sessions identically.
 */
export function parseMcpOAuthSession(
  raw: string | null,
): McpOAuthSession | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);

    if (!isRecord(parsed)) {
      return null;
    }

    if (typeof parsed.accessToken === "string") {
      return {
        codeVerifier: null,
        expiresAt: normalizeExpiresAt(parsed.expiresAt),
        state: null,
        tokens: {
          access_token: parsed.accessToken,
          refresh_token:
            typeof parsed.refreshToken === "string"
              ? parsed.refreshToken
              : undefined,
          token_type:
            typeof parsed.tokenType === "string" ? parsed.tokenType : "Bearer",
        },
      };
    }

    const tokens = isRecord(parsed.tokens)
      ? (parsed.tokens as OAuthTokens)
      : null;
    const clientInformation = isRecord(parsed.clientInformation)
      ? (parsed.clientInformation as OAuthClientInformation)
      : null;
    const authorizationServerInformation = isRecord(
      parsed.authorizationServerInformation,
    )
      ? (parsed.authorizationServerInformation as unknown as OAuthAuthorizationServerInformation)
      : null;

    return {
      authorizationServerInformation,
      clientInformation,
      codeVerifier:
        typeof parsed.codeVerifier === "string" ? parsed.codeVerifier : null,
      expiresAt: normalizeExpiresAt(parsed.expiresAt),
      flowType:
        parsed.flowType === "compat" ||
        parsed.flowType === "discovered" ||
        parsed.flowType === "manual"
          ? parsed.flowType
          : null,
      redirectUri:
        typeof parsed.redirectUri === "string" ? parsed.redirectUri : null,
      resourceUrl:
        typeof parsed.resourceUrl === "string" ? parsed.resourceUrl : null,
      state: typeof parsed.state === "string" ? parsed.state : null,
      tokens: tokens && typeof tokens.access_token === "string" ? tokens : null,
    };
  } catch {
    return null;
  }
}
