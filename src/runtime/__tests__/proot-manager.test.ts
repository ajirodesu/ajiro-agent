import { describe, expect, it } from "vitest";

import {
  PROOT_DEFAULT_ENV,
  PROOT_GUEST_SHELL,
  PROOT_GUEST_WORKDIR,
  prootManager,
} from "@/runtime/ProotManager";

describe("ProotManager (canonical PRoot integration)", () => {
  it("builds the interactive shell command with required flags", () => {
    const cmd = prootManager.buildInteractiveShell({
      rootfsPath: "/data/data/app/files/rootfs",
      workDir: "/workspace",
    });
    expect(cmd.argv[0]).toBe("{PROOT}");
    expect(cmd.argv).toContain("-r");
    expect(cmd.argv).toContain("/data/data/app/files/rootfs");
    expect(cmd.argv).toContain("-0");
    expect(cmd.argv).toContain("-w");
    expect(cmd.argv).toContain(PROOT_GUEST_WORKDIR);
    for (const bind of ["/dev", "/proc", "/sys"]) {
      const idx = cmd.argv.indexOf(bind);
      expect(idx).toBeGreaterThan(-1);
      expect(cmd.argv[idx - 1]).toBe("-b");
    }
    expect(cmd.argv.slice(-2)).toEqual([PROOT_GUEST_SHELL, "--login"]);
    expect(cmd.argv).toContain("--kill-on-exit");
  });

  it("binds the host workspace into the guest", () => {
    const cmd = prootManager.buildHeadlessCommand(
      { rootfsPath: "/r", workDir: "/workspace" },
      "ls -la",
    );
    expect(cmd.argv).toContain("/r/workspace:/workspace");
    expect(cmd.argv.slice(-3)).toEqual([PROOT_GUEST_SHELL, "-lc", "ls -la"]);
  });

  it("provides the required guest environment", () => {
    const cmd = prootManager.buildInteractiveShell({ rootfsPath: "/r", workDir: "/workspace" });
    expect(cmd.env.HOME).toBe("/root");
    expect(cmd.env.TERM).toBe("xterm-256color");
    expect(cmd.env.PATH).toBe(PROOT_DEFAULT_ENV.PATH);
  });

  it("merges extra env over defaults", () => {
    const cmd = prootManager.buildInteractiveShell({
      rootfsPath: "/r",
      workDir: "/workspace",
      extraEnv: { TERM: "xterm", FOO: "bar" },
    });
    expect(cmd.env.TERM).toBe("xterm");
    expect(cmd.env.FOO).toBe("bar");
    expect(cmd.env.HOME).toBe("/root");
  });

  it("shell-quotes argv for diagnostics", () => {
    expect(prootManager.formatArgv(["proot", "-r", "/a b/c"])).toBe("proot -r '/a b/c'");
  });
});
