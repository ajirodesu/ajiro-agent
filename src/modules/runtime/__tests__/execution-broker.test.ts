import { describe, expect, it } from "vitest";

import { PermissionStore, policyFromApprovalMode } from "@/modules/permissions/engine";
import { executePrivileged } from "@/modules/runtime/execution-broker";

function context() {
  return {
    permissions: { store: new PermissionStore() },
    policy: policyFromApprovalMode("ask"),
  };
}

describe("execution broker", () => {
  it("denies without executing and records provenance", async () => {
    const result = await executePrivileged({
      ...context(),
      action: { id: "rm", actionClass: "destructive", description: "delete" },
      operation: "fs.write",
      policy: { defaultDecision: "deny", perClass: {} },
    });
    expect(result.ok).toBe(false);
    expect(result.runtime).toBeNull();
    expect(result.receipt.permission).toBe("deny");
    expect(result.receipt.actionId).toBe("rm");
    expect(result.receipt.finishedAt.length).toBeGreaterThan(0);
  });

  it("returns approval-required for ask without executing", async () => {
    const result = await executePrivileged({
      ...context(),
      action: {
        id: "fs.write",
        actionClass: "filesystem-write",
        description: "write file",
      },
      operation: "fs.write",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Approval required/);
    expect(result.receipt.permission).toBe("ask");
  });

  it("reports the linux limitation instead of routing elsewhere", async () => {
    const store = new PermissionStore();
    store.allowSession("shell");
    const result = await executePrivileged({
      action: { id: "shell", actionClass: "safe", description: "shell" },
      operation: "exec.shell",
      policy: policyFromApprovalMode("auto"),
      permissions: { store },
    });
    expect(result.ok).toBe(false);
    expect(result.runtime).toBeNull();
    expect(result.error).toMatch(/Linux/i);
    expect(result.error).not.toMatch(/remote|termux/i);
  });

  it("requires a project session for project operations", async () => {
    const store = new PermissionStore();
    store.allowSession("check");
    const result = await executePrivileged({
      action: { id: "check", actionClass: "safe", description: "check" },
      operation: "exec.check",
      policy: policyFromApprovalMode("auto"),
      permissions: { store },
      execInput: { commandId: "file-stats" },
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/project folder/i);
    expect(result.runtime).toBe("android_local");
  });
});
