/**
 * MCP preset compatibility + update statuses (Dynamic Updates prompt
 * §§6–7, 11, 13, 24, 35–37, 43–45).
 *
 * The runtime speaks Streamable HTTP and SSE and nothing else, so a preset
 * naming any other transport is a future MCP server, not a broken one: it
 * reports `requires-app-update` instead of failing. Revocation (§24) wins
 * over everything; channel visibility (§44) and gradual rollouts (§45) gate
 * discovery without touching installation.
 */
import {
  channelVisible,
  checkNativeRequirements,
  compareDynamicVersions,
  rolloutAllows,
  type DynamicUpdateStatus,
  type UpdateChannel,
} from "@/modules/updates/extension-framework";
import type { McpServerConfig } from "@/core/types/app-state";
import type { McpServerPreset } from "./catalog";

export type McpPresetSupport = {
  reason: string | null;
  status: DynamicUpdateStatus;
};

/**
 * Can this install run the preset at all? Pure: the caller supplies the app
 * version (Constants.expoConfig?.version at the UI layer) and platform.
 * Version floors and unknown transports mean a newer app would help
 * (`requires-app-update`); an exceeded ceiling or a wrong platform means no
 * app update fixes it (`incompatible`, §35).
 */
export function checkMcpPresetSupport(
  preset: McpServerPreset,
  options: { appVersion?: string | null; platform?: string | null } = {},
): McpPresetSupport {
  if (preset.revoked) {
    return { reason: "This MCP server was revoked by the registry.", status: "revoked" };
  }
  if (preset.platforms.length > 0 && options.platform) {
    const current = options.platform.toLowerCase();
    if (!preset.platforms.includes(current)) {
      return {
        reason: `This MCP server does not support ${options.platform}.`,
        status: "incompatible",
      };
    }
  }
  if (preset.transport !== "http" && preset.transport !== "sse") {
    return {
      reason: `Transport "${preset.transport}" needs a newer Ajiro Agent.`,
      status: "requires-app-update",
    };
  }
  if (preset.minAppVersion && options.appVersion) {
    try {
      if (compareDynamicVersions(options.appVersion, preset.minAppVersion) < 0) {
        return {
          reason: `Needs Ajiro Agent ${preset.minAppVersion} or newer.`,
          status: "requires-app-update",
        };
      }
    } catch {
      // Unparseable versions fail open here; the server connection itself is
      // the real check, and a guessing gate would be worse than none.
    }
  }
  if (preset.maxAppVersion && options.appVersion) {
    try {
      if (compareDynamicVersions(options.appVersion, preset.maxAppVersion) > 0) {
        return {
          reason: `Supports Ajiro Agent up to ${preset.maxAppVersion}; this install is newer.`,
          status: "incompatible",
        };
      }
    } catch {
      // Same fail-open reasoning as the floor above.
    }
  }
  const native = checkNativeRequirements(preset.requiredCapabilities);
  if (!native.satisfied) {
    return {
      reason: `Needs native capabilities this install lacks: ${native.missing.join(", ")}.`,
      status: "requires-app-update",
    };
  }
  if (preset.deprecated) {
    return { reason: "This MCP server is deprecated by its publisher.", status: "deprecated" };
  }
  return { reason: null, status: "not-installed" };
}

/** Preset ids that must be configured before this one (§6 dependencies). */
export function findMissingMcpDependencies(
  preset: Pick<McpServerPreset, "dependencies" | "id">,
  configuredIds: readonly string[],
): string[] {
  const configured = new Set(configuredIds);
  return preset.dependencies.filter(
    (dependency) => dependency !== preset.id && !configured.has(dependency),
  );
}

/** Installed servers whose preset was revoked upstream (§24). */
export function findRevokedMcpServers(
  presets: readonly McpServerPreset[],
  installed: readonly Pick<McpServerConfig, "id" | "url">[],
): Pick<McpServerConfig, "id" | "url">[] {
  const revokedIds = new Set(
    presets.filter((preset) => preset.revoked).map((preset) => preset.id),
  );
  return installed.filter((server) => revokedIds.has(server.id));
}

/**
 * Store status for one preset: discovery gates first (channel, rollout),
 * then support, then configuration drift against an installed server.
 * Installed servers record no version, so the update signal is field drift
 * (endpoint, transport, auth) plus a declared preset version — both real,
 * neither guessed.
 */
export function deriveMcpPresetStatus(
  preset: McpServerPreset,
  installed: Pick<
    McpServerConfig,
    | "authMode"
    | "enabled"
    | "oauthAuthorizationUrl"
    | "oauthTokenUrl"
    | "transport"
    | "url"
  > | null,
  options: {
    appVersion?: string | null;
    channel?: UpdateChannel;
    platform?: string | null;
  } = {},
): McpPresetSupport {
  if (!channelVisible(preset.channel, options.channel ?? "stable")) {
    return { reason: null, status: "not-installed" };
  }
  if (!rolloutAllows(preset.rolloutPercent, `mcp:${preset.id}`)) {
    return { reason: null, status: "not-installed" };
  }
  const support = checkMcpPresetSupport(preset, options);
  if (support.status !== "not-installed") return support;
  if (!installed) return support;
  if (!installed.enabled) return { reason: null, status: "disabled" };
  if (mcpPresetDrifted(preset, installed)) {
    const version = preset.version ? ` (v${preset.version})` : "";
    return {
      reason: `The registry configuration changed upstream${version}.`,
      status: "update-available",
    };
  }
  return { reason: null, status: "installed" };
}

function mcpPresetDrifted(
  preset: McpServerPreset,
  installed: Pick<
    McpServerConfig,
    | "authMode"
    | "oauthAuthorizationUrl"
    | "oauthTokenUrl"
    | "transport"
    | "url"
  >,
): boolean {
  return (
    installed.url !== preset.url ||
    installed.transport !== preset.transport ||
    installed.authMode !== preset.authMode ||
    (installed.oauthAuthorizationUrl ?? null) !== preset.oauthAuthorizationUrl ||
    (installed.oauthTokenUrl ?? null) !== preset.oauthTokenUrl
  );
}

/** Drop revoked presets from discovery (§24): they must not be installable. */
export function filterRevokedMcpPresets(
  presets: readonly McpServerPreset[],
): McpServerPreset[] {
  return presets.filter((preset) => !preset.revoked);
}
