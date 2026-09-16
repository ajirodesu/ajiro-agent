/**
 * Plugin permission model (prompt §50): extensions never receive every
 * capability implicitly. Required capabilities are derived from what the
 * manifest actually ships (entry point + files), presented to the user,
 * and checked by the runtime before sensitive operations.
 *
 * Acode manifests have no permission section, so requirements are inferred
 * conservatively [AJIRO ORIGINAL]. A plugin whose only content is data
 * (no entry script) needs no capabilities at all.
 */
import type { AcodePluginManifest } from "./manifest";
import type {
  ExtensionPermissionGrant,
  ExtensionPermissionKey,
} from "./models";

export const ALL_PERMISSION_KEYS: readonly ExtensionPermissionKey[] = [
  "clipboard",
  "commands",
  "editor",
  "filesystem",
  "network",
  "notifications",
  "project-access",
  "storage",
  "terminal",
  "ui",
];

export const PERMISSION_LABELS: Record<ExtensionPermissionKey, string> = {
  clipboard: "Read and write the clipboard",
  commands: "Register commands",
  editor: "Interact with the editor",
  filesystem: "Read project files",
  network: "Make network requests",
  notifications: "Show notifications",
  "project-access": "Access the active project",
  storage: "Keep private plugin storage",
  terminal: "Run terminal commands",
  ui: "Show plugin interface",
};

/**
 * Derive the capability set a manifest requires. Every installed plugin
 * gets `storage` (isolated data dir) and `ui` (its store/detail surface);
 * an entry script additionally implies commands/editor/network, matching
 * what Acode's global API hands to plugin code.
 */
export function deriveRequestedPermissions(
  manifest: AcodePluginManifest,
): ExtensionPermissionKey[] {
  const keys = new Set<ExtensionPermissionKey>(["storage", "ui"]);
  if (manifest.main) {
    keys.add("commands");
    keys.add("editor");
    keys.add("network");
  }
  if (manifest.files.length > 0) keys.add("filesystem");
  return [...keys].sort();
}

export function grantedKeys(
  grants: ExtensionPermissionGrant[],
): Set<ExtensionPermissionKey> {
  return new Set(grants.map((grant) => grant.key));
}

/**
 * Permissions the user still needs to approve on top of existing grants
 * (e.g. when an update starts requesting more capabilities).
 */
export function pendingPermissions(
  manifest: AcodePluginManifest,
  grants: ExtensionPermissionGrant[],
): ExtensionPermissionKey[] {
  const granted = grantedKeys(grants);
  return deriveRequestedPermissions(manifest).filter((key) => !granted.has(key));
}

export function grantAll(
  keys: ExtensionPermissionKey[],
  at: string,
): ExtensionPermissionGrant[] {
  return keys.map((key) => ({ grantedAt: at, key }));
}
