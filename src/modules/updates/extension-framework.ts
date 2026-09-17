/**
 * Shared dynamic-extension framework (Dynamic Updates prompt §§4, 11–13,
 * 19–24, 33–37, 43–46, 49).
 *
 * Skills, MCP servers, and plugins each keep their own registry shape and
 * runtime, but the update *policy* is identical: versioned catalog entries,
 * update channels, trust evaluation, revocation, native-capability gating,
 * gradual rollouts, and local health telemetry. This module is the single
 * home for that policy so the three systems cannot drift apart. It is pure
 * TypeScript with no platform imports, so it unit-tests on node.
 *
 * Deliberate limits (see docs/dynamic-updates.md):
 * - Health telemetry is local-only (prompt §49 is optional, and the app has
 *   no remote telemetry pipeline). Nothing here transmits anything.
 * - Revocation is registry-fed: the registry is the source of truth and each
 *   system evaluates it at sync/install/activate time. There is no separate
 *   revocation service.
 */

export type DynamicExtensionKind = "mcp" | "plugin" | "skill";

/** Update channels (§44). Production defaults to stable. */
export type UpdateChannel = "beta" | "preview" | "stable";

const CHANNEL_RANK: Record<UpdateChannel, number> = {
  stable: 0,
  beta: 1,
  preview: 2,
};

export function parseUpdateChannel(value: unknown): UpdateChannel | null {
  if (value === "stable" || value === "beta" || value === "preview") return value;
  return null;
}

/**
 * An entry without a channel is stable. A user on `beta` sees stable + beta;
 * a user on `preview` sees everything. Higher-risk channels never leak down.
 */
export function channelVisible(
  entryChannel: unknown,
  userChannel: UpdateChannel,
): boolean {
  const rank = CHANNEL_RANK[parseUpdateChannel(entryChannel) ?? "stable"];
  return rank <= CHANNEL_RANK[userChannel];
}

/** Trust states (§23). */
export type ExtensionTrustState =
  | "blocked"
  | "invalid"
  | "revoked"
  | "trusted"
  | "unknown"
  | "verified";

export function evaluateExtensionTrust(input: {
  hashMatches?: boolean;
  expectedHashPresent?: boolean;
  publisherTrusted?: boolean;
  revoked?: boolean;
  signatureValid?: boolean;
}): ExtensionTrustState {
  if (input.revoked) return "revoked";
  if (input.signatureValid === false) return "invalid";
  if (input.expectedHashPresent && input.hashMatches === false) return "invalid";
  if (input.signatureValid === true) return "verified";
  if (input.publisherTrusted) return "trusted";
  if (input.expectedHashPresent && input.hashMatches === true) return "trusted";
  return "unknown";
}

/**
 * The embedded native runtime's capability manifest (§36). A dynamic
 * extension declares required capabilities; the compatibility engine checks
 * them before installation so a remote package can never assume unsupported
 * native functionality. This list describes the installed binary and only
 * changes with a native rebuild.
 */
export const NATIVE_CAPABILITIES: readonly string[] = [
  "filesystem",
  "secureStorage",
  "terminal",
  "network",
  "notifications",
  "camera",
  "mcp:http",
  "mcp:sse",
  "skillRuntime",
  "pluginRuntime",
  "pluginWebview",
  "commandRegistry",
  "formatterRegistry",
  "keyBindings",
  "oauth",
  "documentPicker",
  "bluetooth",
];

export function checkNativeRequirements(required: readonly string[] | undefined | null): {
  missing: string[];
  satisfied: boolean;
} {
  const missing = (required ?? []).filter(
    (capability) => !NATIVE_CAPABILITIES.includes(capability),
  );
  return { missing, satisfied: missing.length === 0 };
}

/** Numeric-aware version comparison (§11): 1.10.0 > 1.9.0, "1.0" == "1.0.0". */
export function compareDynamicVersions(left: string, right: string): number {
  const parts = (value: string) =>
    value
      .split(/[-+]/)[0]
      .split(".")
      .map((part) => {
        const numeric = Number.parseInt(part, 10);
        return Number.isNaN(numeric) ? part : numeric;
      });
  const l = parts(left.trim());
  const r = parts(right.trim());
  for (let index = 0; index < Math.max(l.length, r.length); index += 1) {
    const a = l[index] ?? 0;
    const b = r[index] ?? 0;
    if (typeof a === "number" && typeof b === "number") {
      if (a !== b) return a < b ? -1 : 1;
    } else if (String(a) !== String(b)) {
      return String(a) < String(b) ? -1 : 1;
    }
  }
  return 0;
}

/**
 * Gradual rollout gate (§45). `rolloutPercent` 0–100 from the registry entry;
 * undefined means fully rolled out. Deterministic per extension id so a
 * device does not flap between builds.
 */
export function rolloutAllows(
  rolloutPercent: number | undefined | null,
  stableId: string,
): boolean {
  if (rolloutPercent === undefined || rolloutPercent === null) return true;
  if (rolloutPercent <= 0) return false;
  if (rolloutPercent >= 100) return true;
  let hash = 2166136261;
  for (let index = 0; index < stableId.length; index += 1) {
    hash ^= stableId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 100 < rolloutPercent;
}

/** Parse a registry `revoked` list (§24) into a lookup set. */
export function parseRevocationList(value: unknown): Set<string> {
  const revoked = new Set<string>();
  const list = Array.isArray(value) ? value : value ? [value] : [];
  for (const entry of list) {
    if (typeof entry === "string" && entry.trim()) revoked.add(entry.trim());
    else if (entry && typeof entry === "object") {
      const record = entry as Record<string, unknown>;
      const id = record.id ?? record.pluginId ?? record.slug;
      if (typeof id === "string" && id.trim()) revoked.add(id.trim());
    }
  }
  return revoked;
}

/** Store-visible update states (§43), computed from real registry data. */
export type DynamicUpdateStatus =
  | "deprecated"
  | "disabled"
  | "incompatible"
  | "installed"
  | "latest"
  | "not-installed"
  | "offline"
  | "requires-app-update"
  | "revoked"
  | "update-available";

export const DYNAMIC_UPDATE_STATUS_LABELS: Record<DynamicUpdateStatus, string> = {
  deprecated: "Deprecated",
  disabled: "Disabled",
  incompatible: "Incompatible",
  installed: "Installed",
  latest: "Latest",
  "not-installed": "Not installed",
  offline: "Offline",
  "requires-app-update": "Requires App Update",
  revoked: "Revoked",
  "update-available": "Update Available",
};

export function describeDynamicUpdateStatus(status: DynamicUpdateStatus): string {
  return DYNAMIC_UPDATE_STATUS_LABELS[status];
}

/**
 * Local-only health telemetry (§49, optional; the app has no remote
 * telemetry pipeline and must not transmit extension contents). Capped
 * ring buffer; the app may persist it, but nothing here touches the
 * network or storage.
 */
export type ExtensionHealthEventKind =
  | "incompatible"
  | "install-failure"
  | "install-success"
  | "revoked"
  | "rollback"
  | "update-failure"
  | "update-success";

export type ExtensionHealthEvent = {
  at: number;
  detail?: string;
  kind: ExtensionHealthEventKind;
  extensionId: string;
  extensionKind: DynamicExtensionKind;
};

export const MAX_HEALTH_EVENTS = 200;

export function createExtensionHealthLog() {
  let events: ExtensionHealthEvent[] = [];
  return {
    events(): ExtensionHealthEvent[] {
      return [...events];
    },
    record(
      extensionKind: DynamicExtensionKind,
      extensionId: string,
      kind: ExtensionHealthEventKind,
      detail?: string,
    ): void {
      events.push({ at: Date.now(), detail, extensionId, extensionKind, kind });
      if (events.length > MAX_HEALTH_EVENTS) {
        events = events.slice(events.length - MAX_HEALTH_EVENTS);
      }
    },
    clear(): void {
      events = [];
    },
  };
}

export type ExtensionHealthLog = ReturnType<typeof createExtensionHealthLog>;
