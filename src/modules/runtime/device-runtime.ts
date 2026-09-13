/**
 * Device-only execution backends.
 *
 * Source provenance:
 * - [AJIRO ORIGINAL] the two-backend constraint itself: Ajiro performs its
 *   coding workload only on the Android device.
 * - [ANDROID] android_local reflects what an Android app can genuinely do
 *   (app-private files, Storage Access Framework URIs, in-process JS
 *   libraries, network APIs). It is NOT desktop Linux; see each capability's
 *   notes.
 * - [ENGINEERING INFERENCE] the linux backend slot (optional on-device
 *   Linux/PRoot userspace). Provisioning is not bundled; selection reports
 *   the limitation explicitly instead of routing elsewhere.
 *
 * There is deliberately NO "remote" backend: no cloud shell, no PC fallback,
 * no remote terminal, no remote build runtime. Network APIs (model providers,
 * GitHub, package registries) are communication, not execution.
 */

export type RuntimeBackend = "android_local" | "linux";

export type AndroidCapabilityId =
  | "fs.read"
  | "fs.write.scoped"
  | "git.local"
  | "exec.checks"
  | "network.api"
  | "clipboard"
  | "notifications.local";

export type AndroidCapability = {
  id: AndroidCapabilityId;
  /** Human-readable capability summary for limitation messages. */
  description: string;
  /** True when usable on stock Android with the app's own permissions. */
  availableOnDevice: boolean;
  notes: string;
};

/** [ANDROID] Capabilities genuinely available to the app on stock Android. */
export const ANDROID_LOCAL_CAPABILITIES: AndroidCapability[] = [
  {
    id: "fs.read",
    description: "Read files in app storage and SAF-granted directories",
    availableOnDevice: true,
    notes:
      "Scoped to app-private storage plus user-granted SAF tree URIs. " +
      "No unrestricted filesystem access is assumed.",
  },
  {
    id: "fs.write.scoped",
    description: "Write files inside the authorized project scope",
    availableOnDevice: true,
    notes:
      "Writes stay inside the active project/session scope and remain " +
      "approval-gated. Staged-write review applies to destructive operations.",
  },
  {
    id: "git.local",
    description: "Git via in-process isomorphic-git over the SAF adapter",
    availableOnDevice: true,
    notes:
      "Pure-JS implementation; no git binary. Worktrees and some advanced " +
      "operations may be unavailable — reported per operation.",
  },
  {
    id: "exec.checks",
    description: "Fixed allow-list of in-process code checks",
    availableOnDevice: true,
    notes:
      "Stable command IDs (typecheck-js, lint-js, grep-count, file-stats, " +
      "git-status), never a shell string. There is no general shell on " +
      "stock Android: Runtime.getRuntime().exec() can only run the app's " +
      "own bundled binaries.",
  },
  {
    id: "network.api",
    description: "HTTPS API calls (providers, GitHub, registries, MCP)",
    availableOnDevice: true,
    notes:
      "Communication, not execution. Mutations require explicit approval.",
  },
  {
    id: "clipboard",
    description: "Clipboard read/write via platform APIs",
    availableOnDevice: true,
    notes: "Paste into the terminal; copy transcript selections out.",
  },
  {
    id: "notifications.local",
    description: "Local notifications for run progress",
    availableOnDevice: true,
    notes: "Requires the user-granted notification permission.",
  },
];

export type LinuxProvisioningStatus =
  | { provisioned: false; reason: string }
  | { provisioned: true; detail: string };

/**
 * [ENGINEERING INFERENCE] On-device Linux/PRoot is an optional slot, not a
 * bundled runtime: shipping a full userspace inside the base APK would
 * violate the lightweight budget. Until a downloadable toolchain is
 * provisioned, selection must fail closed with an actionable message.
 */
export function getLinuxProvisioningStatus(): LinuxProvisioningStatus {
  return {
    provisioned: false,
    reason:
      "On-device Linux is not provisioned on this device yet. " +
      "It requires an optional downloadable Linux userspace (PRoot) plus " +
      "toolchains, which are not bundled with the base app. " +
      "Only android_local operations are available.",
  };
}

export type OperationKind =
  | "fs.read"
  | "fs.write"
  | "git"
  | "exec.check"
  | "exec.shell"
  | "package.install"
  | "build"
  | "network.api";

export type RuntimeSelection =
  | { backend: RuntimeBackend; capability: string }
  | { backend: null; limitation: string };

/**
 * Runtime selector: Requested Operation -> Capability Detection ->
 * android_local OR linux. Never remote.
 */
export function selectRuntimeFor(operation: OperationKind): RuntimeSelection {
  switch (operation) {
    case "fs.read":
    case "fs.write":
    case "git":
    case "exec.check":
    case "network.api":
      return {
        backend: "android_local",
        capability: operation,
      };
    case "exec.shell":
    case "package.install":
    case "build": {
      const linux = getLinuxProvisioningStatus();
      if (linux.provisioned) {
        return { backend: "linux", capability: operation };
      }
      return {
        backend: null,
        limitation:
          `Operation "${operation}" needs a fuller Linux userspace than ` +
          `stock Android exposes to apps. ${linux.reason}`,
      };
    }
  }
}
