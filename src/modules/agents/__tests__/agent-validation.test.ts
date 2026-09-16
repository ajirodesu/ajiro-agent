import { describe, expect, it } from "vitest";

import {
  describeAgentMetadataError,
  getAgentMetadataError,
  isValidAgentName,
  validateAgentDraft,
} from "@/modules/agents/agent-validation";

describe("agent-validation", () => {
  it("accepts a well-formed name", () => {
    expect(isValidAgentName("pdf-helper")).toBe(true);
    expect(isValidAgentName("PDF")).toBe(false);
    expect(isValidAgentName("a/b")).toBe(false);
    expect(isValidAgentName("..")).toBe(false);
    expect(isValidAgentName("x".repeat(81))).toBe(false);
  });

  it("requires frontmatter and a valid name", () => {
    expect(getAgentMetadataError(null)).toEqual({ type: "required" });
    expect(getAgentMetadataError("description: ok")).toEqual({ type: "nameRequired" });
    expect(getAgentMetadataError("name: Bad_Name\ndescription: ok")).toEqual({
      type: "nameInvalid",
    });
    expect(getAgentMetadataError("- just\n- a\n- list")).toEqual({ type: "mapping" });
    expect(getAgentMetadataError("name: [unclosed")).toEqual({ type: "syntax" });
    expect(getAgentMetadataError("name: ok")).toBeUndefined();
    expect(
      getAgentMetadataError("name: ok\ndescription: Helps with pdf work."),
    ).toBeUndefined();
  });

  it("accepts a title alias and validates a present description", () => {
    expect(getAgentMetadataError("title: ok")).toBeUndefined();
    expect(
      getAgentMetadataError("name: ok\ndescription: |\n  line one\n  line two"),
    ).toEqual({ type: "descriptionInvalid" });
  });

  it("locks the pack name on import", () => {
    expect(
      getAgentMetadataError("name: other", { expectedName: "pdf" }),
    ).toEqual({ expectedName: "pdf", type: "nameLocked" });
    expect(getAgentMetadataError("name: pdf", { expectedName: "pdf" })).toBeUndefined();
  });

  it("describes every error", () => {
    expect(describeAgentMetadataError({ type: "required" })).toMatch(/frontmatter/);
    expect(
      describeAgentMetadataError({ expectedName: "pdf", type: "nameLocked" }),
    ).toMatch(/pdf/);
  });

  it("validates editor drafts", () => {
    const valid = {
      description: "Helps with pdf work.",
      mode: "all",
      modelRef: "",
      name: "pdf-helper",
      prompt: "You are a helper.",
      temperature: "",
    };
    expect(validateAgentDraft(valid)).toEqual([]);
    expect(validateAgentDraft({ ...valid, name: "" })[0]?.field).toBe("name");
    expect(validateAgentDraft({ ...valid, prompt: "  " })[0]?.field).toBe("prompt");
    expect(validateAgentDraft({ ...valid, mode: "boss" })[0]?.field).toBe("mode");
    expect(validateAgentDraft({ ...valid, modelRef: "oops" })[0]?.field).toBe("modelRef");
    expect(validateAgentDraft({ ...valid, temperature: "hot" })[0]?.field).toBe(
      "temperature",
    );
    expect(validateAgentDraft({ ...valid, temperature: "3" })[0]?.field).toBe(
      "temperature",
    );
    expect(
      validateAgentDraft({ ...valid, description: "one\ntwo" })[0]?.field,
    ).toBe("description");
  });
});
