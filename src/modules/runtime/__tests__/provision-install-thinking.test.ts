import { describe, expect, it } from "vitest";

import {
  installApk,
  requestApkInstall,
} from "@/modules/device/apk-install";
import {
  detectLinuxToolchains,
  planLinuxProvisioning,
  stockAndroidLinuxPlan,
} from "@/modules/runtime/linux-provision";
import {
  progressText,
  statusForTool,
  thinkingLabel,
} from "@/modules/runtime/thinking";

describe("linux provisioning", () => {
  it("reports stock android honestly", async () => {
    const plan = await stockAndroidLinuxPlan();
    expect(plan.provisioned).toBe(false);
    expect(plan.missing.length).toBeGreaterThan(0);
    expect(plan.guidance).toContain("userspace");
  });

  it("detects present toolchains through the probe", async () => {
    const states = await detectLinuxToolchains(async (path) =>
      path === "bin/sh" || path === "bin/git",
    );
    const byId = new Map(states.map((entry) => [entry.id, entry]));
    expect(byId.get("shell")?.present).toBe(true);
    expect(byId.get("git")?.present).toBe(true);
    expect(byId.get("gradle")?.present).toBe(false);
    const plan = planLinuxProvisioning("/data/linux", states);
    expect(plan.provisioned).toBe(false);
    expect(plan.missing).toContain("gradle");
  });
});

describe("apk install gating", () => {
  it("requires approval before opening the installer", async () => {
    const staged = requestApkInstall({ uri: "file:///x.apk" });
    const denied = await installApk(
      { status: staged.status, detail: { uri: "file:///x.apk" } },
      async () => {},
    );
    expect(denied.ok).toBe(false);
    let opened: string | null = null;
    const allowed = await installApk(
      { status: "approved", detail: { uri: "file:///x.apk" } },
      async (uri) => {
        opened = uri;
      },
    );
    expect(allowed.ok).toBe(true);
    expect(opened).toBe("file:///x.apk");
    expect(() => requestApkInstall({ uri: "" })).toThrow();
  });
});

describe("thinking presentation", () => {
  it("labels statuses without leaking internals", () => {
    expect(thinkingLabel("thinking")).toBe("Thinking…");
    expect(thinkingLabel("testing")).toBe("Running tests…");
    expect(statusForTool("readFile")).toBe("reading");
    expect(statusForTool("runTests")).toBe("testing");
    expect(statusForTool("mystery")).toBe("thinking");
    expect(progressText("building", 42)).toBe("Building… 42%");
    expect(progressText("building", 999)).toBe("Building… 100%");
  });
});
