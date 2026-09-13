/**
 * On-device Linux slot (§§30, 51): provisioning state, toolchain detection,
 * and install guidance. The base APK stays lightweight (no bundled
 * userspace); a Linux environment arrives as an optional download.
 *
 * Nothing here fabricates a runtime: every entry point reports what is
 * actually present and what is missing, per the limitation-handling rule.
 *
 * Source provenance: [AJIRO ORIGINAL]; PRoot/userspace shape follows
 * publicly documented on-device Linux approaches [ENGINEERING INFERENCE].
 */
export type LinuxToolchainId =
  | "shell"
  | "coreutils"
  | "git"
  | "nodejs"
  | "npm"
  | "python"
  | "java"
  | "gradle"
  | "cmake"
  | "clang";

export type LinuxToolchainState = {
  id: LinuxToolchainId;
  label: string;
  present: boolean;
  detail: string;
};

export type LinuxProvisioningPlan = {
  provisioned: boolean;
  userspace: string | null;
  toolchains: LinuxToolchainState[];
  missing: string[];
  guidance: string;
};

const TOOLCHAIN_LABELS: Record<LinuxToolchainId, string> = {
  shell: "POSIX shell (sh)",
  coreutils: "Core utilities (ls, cp, grep, …)",
  git: "Git binary",
  nodejs: "Node.js",
  npm: "npm",
  python: "Python 3",
  java: "Java (JDK 17+)",
  gradle: "Gradle",
  cmake: "CMake",
  clang: "Clang/NDK toolchain",
};

/**
 * Detect toolchains inside an (optional) provisioned userspace root.
 * `probe` answers "does <path> exist and execute" for the userspace; on
 * stock Android without a userspace it trivially reports everything missing.
 */
export async function detectLinuxToolchains(
  probe: (path: string) => Promise<boolean>,
): Promise<LinuxToolchainState[]> {
  const paths: Record<LinuxToolchainId, string> = {
    shell: "bin/sh",
    coreutils: "bin/ls",
    git: "bin/git",
    nodejs: "bin/node",
    npm: "bin/npm",
    python: "bin/python3",
    java: "bin/java",
    gradle: "bin/gradle",
    cmake: "bin/cmake",
    clang: "bin/clang",
  };
  const states: LinuxToolchainState[] = [];
  for (const [id, path] of Object.entries(paths) as [
    LinuxToolchainId,
    string,
  ][]) {
    let present = false;
    try {
      present = await probe(path);
    } catch {
      present = false;
    }
    states.push({
      id,
      label: TOOLCHAIN_LABELS[id],
      present,
      detail: present
        ? `Found at ${path} inside the on-device userspace.`
        : `Not present. Shell/package/Linux-specific operations needing ${TOOLCHAIN_LABELS[id]} cannot run on-device yet.`,
    });
  }
  return states;
}

export function planLinuxProvisioning(
  userspace: string | null,
  toolchains: LinuxToolchainState[],
): LinuxProvisioningPlan {
  const missing = toolchains.filter((entry) => !entry.present).map((entry) => entry.id);
  const provisioned = userspace !== null && missing.length === 0;
  return {
    provisioned,
    userspace,
    toolchains,
    missing,
    guidance: provisioned
      ? "On-device Linux is ready."
      : userspace === null
        ? "Install the optional on-device Linux userspace first (downloadable package, not bundled). Then install the missing toolchains inside it."
        : `Userspace found at ${userspace}. Install missing toolchains inside it: ${missing.join(", ") || "none"}.`,
  };
}

/** Stock-Android starting point: no userspace, everything missing. */
export async function stockAndroidLinuxPlan(): Promise<LinuxProvisioningPlan> {
  const toolchains = await detectLinuxToolchains(async () => false);
  return planLinuxProvisioning(null, toolchains);
}
