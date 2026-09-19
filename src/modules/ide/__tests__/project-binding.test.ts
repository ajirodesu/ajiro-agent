import { describe, expect, it } from "vitest";

import type { ExternalFolderSession } from "@/core/types/app-state";
import {
  isProjectBound,
  PROJECT_LOCK_MESSAGE,
  requireProjectUnbound,
} from "@/modules/ide/project-binding";

const SESSION = {
  uri: "content://project",
  displayName: "demo",
} as ExternalFolderSession;

describe("project binding", () => {
  it("treats a stored session as bound and nullish as unbound", () => {
    expect(isProjectBound(SESSION)).toBe(true);
    expect(isProjectBound(null)).toBe(false);
    expect(isProjectBound(undefined)).toBe(false);
  });

  it("refuses to switch once bound", () => {
    expect(() => requireProjectUnbound(SESSION)).toThrow(
      PROJECT_LOCK_MESSAGE,
    );
    expect(() => requireProjectUnbound(null)).not.toThrow();
    expect(() => requireProjectUnbound(undefined)).not.toThrow();
  });
});
