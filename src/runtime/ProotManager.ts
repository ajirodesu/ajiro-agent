/**
 * Canonical PRoot integration.
 *
 * Single source of truth for how the app enters the Debian userspace.
 * Builds the exact argv / environment every PTY session and every headless
 * command uses — no competing command builders may exist.
 *
 * Target: `proot -r <rootfs> -0 -w /workspace -b /dev -b /proc -b /sys
 * /bin/bash [--login]`, ARM64 (`arm64-v8a`), app-private storage only.
 */
import type { ProotCommand, ProotLaunchConfig } from "@/runtime/runtimeTypes";

export const PROOT_GUEST_WORKDIR = "/workspace" as const;
export const PROOT_GUEST_SHELL = "/bin/bash" as const;

export const PROOT_DEFAULT_ENV: Record<string, string> = {
  HOME: "/root",
  PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
  TERM: "xterm-256color",
  LANG: "C.UTF-8",
};

/** Bind mounts required for a functional Debian userspace. */
export const PROOT_DEFAULT_BINDS: readonly string[] = ["/dev", "/proc", "/sys"];

/**
 * Absolute host path of the `proot` binary for the current device.
 * The binary ships per-ABI under `jniLibs/<abi>/proot` and is resolved at
 * runtime to an executable app-private copy (see native module).
 */
export function prootBinaryPath(filesDir: string, abi: string = "arm64-v8a"): string {
  const base = filesDir.endsWith("/") ? filesDir.slice(0, -1) : filesDir;
  return `${base}/bin/proot-${abi}`;
}

export class ProotManager {
  /**
   * Build the host-side PRoot command for an interactive login shell.
   * `sessionCmd` is appended after `/bin/bash` (e.g. `--login`).
   */
  buildInteractiveShell(config: ProotLaunchConfig, sessionCmd = "--login"): ProotCommand {
    return this.build(config, [PROOT_GUEST_SHELL, sessionCmd]);
  }

  /**
   * Build the host-side PRoot command for a headless tool invocation:
   * `/bin/bash -lc <command>` inside `/workspace`.
   */
  buildHeadlessCommand(config: ProotLaunchConfig, command: string): ProotCommand {
    return this.build(config, [PROOT_GUEST_SHELL, "-lc", command]);
  }

  private build(config: ProotLaunchConfig, guestCmd: string[]): ProotCommand {
    const workDir = config.workDir || PROOT_GUEST_WORKDIR;
    const argv: string[] = [
      "{PROOT}",
      "-r",
      config.rootfsPath,
      "-0",
      "-w",
      workDir,
    ];
    for (const bind of PROOT_DEFAULT_BINDS) {
      argv.push("-b", bind);
    }
    // /workspace on the host maps to /workspace in the guest so agent file
    // tools and the Linux userspace observe the same tree.
    argv.push("-b", `${config.rootfsPath}/workspace:${PROOT_GUEST_WORKDIR}`);
    argv.push("--kill-on-exit");
    argv.push(...guestCmd);
    return {
      argv,
      env: { ...PROOT_DEFAULT_ENV, ...(config.extraEnv ?? {}) },
    };
  }

  /**
   * Render a shell-quoted command line for logging/diagnostics.
   * Never log secrets through here — argv contains paths only.
   */
  formatArgv(argv: string[]): string {
    return argv
      .map((part) => (/^[A-Za-z0-9_./:=-]+$/.test(part) ? part : `'${part.replace(/'/g, `'\\''`)}'`))
      .join(" ");
  }
}

/** Application-wide singleton. */
export const prootManager = new ProotManager();
