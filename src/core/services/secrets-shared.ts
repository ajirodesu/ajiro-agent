/**
 * Pure, platform-free helpers shared by the native SecureStore-backed
 * secrets module and its in-memory Web Preview sibling. No expo imports.
 */

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
