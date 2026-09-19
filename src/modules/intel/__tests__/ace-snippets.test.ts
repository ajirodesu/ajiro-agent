import { describe, expect, it } from "vitest";

import {
  parseAceSnippets,
  snippetLanguagesForFile,
} from "@/modules/intel/ace-snippets";

// Compact excerpt in the exact shape of the real-world
// `snippets/javascript.snippets` (conditions, comments, placeholders,
// multi-line bodies with whitespace-only lines).
const SAMPLE = `# Prototype
snippet proto
\t\${1:class_name}.prototype.\${2:method_name} = function(\${3:first_argument}) {
\t\t\${4:// body...}
\t};
# Anonymous Function
regex /((=)\\s*|(:)\\s*|(\\()|\\b)/f/(\\))?/
snippet f
\tfunction\${M1?: \${1:functionName}}($2) {
\t\t\${0}
\t}\${M2?;}\${M3?,}\${M4?)}
# Immediate function
trigger \\(?f\\(
endTrigger \\)?
snippet f(
\t(function(\${1}) {
\t\t\${0:/* code */}
\t}(\${1}));
# if
snippet if
\tif (\${1:true}) {
\t\t\${0}
\t}
snippet
\tbody without a trigger
# Empty body lands here
snippet ghost
# Trailing comment with no snippet after it
`;

describe("parseAceSnippets", () => {
  it("extracts triggers, verbatim bodies, and comment descriptions", () => {
    const snippets = parseAceSnippets(SAMPLE);
    const byTrigger = new Map(snippets.map((item) => [item.trigger, item]));

    expect(byTrigger.get("proto")).toMatchObject({
      description: "Prototype",
      body: "\t${1:class_name}.prototype.${2:method_name} = function(${3:first_argument}) {\n\t\t${4:// body...}\n\t};",
    });
    expect(byTrigger.get("f(")?.description).toBe("Immediate function");
    expect(byTrigger.get("if")?.description).toBe("if");
  });

  it("ignores condition directives but keeps the gated snippet", () => {
    const snippets = parseAceSnippets(SAMPLE);
    expect(snippets.some((item) => item.trigger === "f")).toBe(true);
    // No directive line leaks into a body or becomes a snippet.
    for (const item of snippets) {
      expect(item.trigger).not.toMatch(/^(regex|guard|trigger|endTrigger)\b/);
      expect(item.body).not.toMatch(/^regex \//m);
    }
  });

  it("skips trigger-less and body-less blocks", () => {
    const snippets = parseAceSnippets(SAMPLE);
    const triggers = snippets.map((item) => item.trigger);
    expect(triggers).not.toContain("");
    expect(triggers).not.toContain("ghost");
  });

  it("handles empty input", () => {
    expect(parseAceSnippets("")).toEqual([]);
    expect(parseAceSnippets("# only a comment\n")).toEqual([]);
  });
});

describe("snippetLanguagesForFile", () => {
  it("maps stems to intel language ids", () => {
    expect(snippetLanguagesForFile("snippets/python.snippets")).toEqual([
      "python",
    ]);
    expect(snippetLanguagesForFile("snippets/c_cpp.snippets")).toEqual([
      "c",
      "cpp",
    ]);
    expect(snippetLanguagesForFile("snippets/TSX.snippets")).toEqual([
      "tsx",
      "typescript",
    ]);
  });

  it("falls back to the stem for unknown languages", () => {
    expect(snippetLanguagesForFile("wollok.snippets")).toEqual(["wollok"]);
    expect(snippetLanguagesForFile(".snippets")).toEqual([]);
  });
});
