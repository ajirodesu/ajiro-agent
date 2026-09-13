import { describe, expect, it } from "vitest";

import {
  evaluatePermission,
  isPreAuthorized,
  PermissionStore,
  policyFromApprovalMode,
} from "@/modules/permissions/engine";

describe("permission engine", () => {
  it("ask mode prompts for writes but pre-authorizes reads", () => {
    const policy = policyFromApprovalMode("ask");
    const store = new PermissionStore();
    expect(
      evaluatePermission(
        policy,
        { id: "fs.read", actionClass: "read-only", description: "read" },
        { store },
      ),
    ).toBe("allow_once");
    expect(
      evaluatePermission(
        policy,
        {
          id: "fs.write",
          actionClass: "filesystem-write",
          description: "write",
        },
        { store },
      ),
    ).toBe("ask");
  });

  it("auto mode still denies destructive and privileged", () => {
    const policy = policyFromApprovalMode("auto");
    const store = new PermissionStore();
    expect(
      evaluatePermission(
        policy,
        { id: "rm", actionClass: "destructive", description: "delete" },
        { store },
      ),
    ).toBe("deny");
    expect(
      evaluatePermission(
        policy,
        { id: "su", actionClass: "privileged", description: "root" },
        { store },
      ),
    ).toBe("deny");
  });

  it("session and project grants authorize without overriding deny", () => {
    const policy = policyFromApprovalMode("ask");
    const store = new PermissionStore();
    store.allowSession("fs.write");
    expect(
      evaluatePermission(
        policy,
        {
          id: "fs.write",
          actionClass: "filesystem-write",
          description: "write",
        },
        { store },
      ),
    ).toBe("allow_session");

    store.allowProject("project-a", "net.api");
    expect(
      evaluatePermission(
        policy,
        { id: "net.api", actionClass: "network", description: "fetch" },
        { store, projectScope: "project-a" },
      ),
    ).toBe("allow_project");

    // A grant never overrides an explicit deny rule.
    store.allowSession("rm");
    expect(
      evaluatePermission(
        {
          defaultDecision: "ask",
          perClass: { destructive: "deny" },
        },
        { id: "rm", actionClass: "destructive", description: "delete" },
        { store },
      ),
    ).toBe("deny");
  });

  it("classifies pre-authorized decisions", () => {
    expect(isPreAuthorized("allow_once")).toBe(true);
    expect(isPreAuthorized("allow_session")).toBe(true);
    expect(isPreAuthorized("allow_project")).toBe(true);
    expect(isPreAuthorized("ask")).toBe(false);
    expect(isPreAuthorized("deny")).toBe(false);
  });

  it("treats allow-list mode as ask-first at the engine layer", () => {
    const policy = policyFromApprovalMode("allowList");
    const store = new PermissionStore();
    expect(
      evaluatePermission(
        policy,
        {
          id: "fs.write",
          actionClass: "filesystem-write",
          description: "write",
        },
        { store },
      ),
    ).toBe("ask");
    expect(
      evaluatePermission(
        policy,
        { id: "fs.read", actionClass: "read-only", description: "read" },
        { store },
      ),
    ).toBe("allow_once");
  });
});
