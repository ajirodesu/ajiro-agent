import { describe, expect, it } from "vitest";

import {
  ANDROID_LOCAL_CAPABILITIES,
  getLinuxProvisioningStatus,
  selectRuntimeFor,
} from "@/modules/runtime/device-runtime";

describe("device runtime", () => {
  it("exposes only android_local and linux backends", () => {
    expect(ANDROID_LOCAL_CAPABILITIES.length).toBeGreaterThan(0);
    for (const capability of ANDROID_LOCAL_CAPABILITIES) {
      expect(capability.availableOnDevice).toBe(true);
    }
  });

  it("routes device-feasible operations to android_local", () => {
    for (const operation of [
      "fs.read",
      "fs.write",
      "git",
      "exec.check",
      "network.api",
    ] as const) {
      const selection = selectRuntimeFor(operation);
      expect(selection.backend).toBe("android_local");
    }
  });

  it("never selects a remote backend", () => {
    for (const operation of [
      "exec.shell",
      "package.install",
      "build",
    ] as const) {
      const selection = selectRuntimeFor(operation);
      // Deliberately untyped: the type system already forbids "remote";
      // this guards the runtime value too.
      const backend: unknown = selection.backend;
      expect(backend).not.toBe("remote");
      if (selection.backend === null) {
        expect(selection.limitation.length).toBeGreaterThan(0);
      }
    }
  });

  it("reports linux provisioning honestly", () => {
    const status = getLinuxProvisioningStatus();
    expect(status.provisioned).toBe(false);
    if (!status.provisioned) {
      expect(status.reason).toMatch(/not provisioned/i);
    }
  });
});
