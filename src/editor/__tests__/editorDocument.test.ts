import { describe, expect, it } from "vitest";

import { adaptAppThemeToEditorTheme } from "@/editor/editorThemeAdapter";
import {
  buildEditorDocument,
  escapeInlineJson,
  escapeInlineScript,
} from "@/editor/editorDocument";
import { aquaTheme } from "@/theme/aqua";

const theme = adaptAppThemeToEditorTheme(aquaTheme, null);

describe("editorDocument (offline CodeMirror factory)", () => {
  it("embeds the grammar key, theme, and document", () => {
    const html = buildEditorDocument({
      theme,
      grammarKey: "python",
      doc: "print('hi')",
    });
    expect(html).toContain('"grammarKey":"python"');
    expect(html).toContain(theme.background);
    expect(html).toContain(theme.keyword);
    expect(html).toContain("print('hi')");
    expect(html).toContain("window.AjiroCM");
    expect(html).toContain("__ajiroEditorInbox");
  });

  it("renders plain text when the grammar key is null", () => {
    const html = buildEditorDocument({
      theme,
      grammarKey: null,
      doc: "hello",
    });
    expect(html).toContain('"grammarKey":null');
  });

  it("neutralizes script-breaking document text", () => {
    const html = buildEditorDocument({
      theme,
      grammarKey: "html",
      doc: "</script><script>alert('$&${1}')</script><!--",
    });
    // Only the two structural closing tags may survive.
    expect(html.split("</script").length - 1).toBe(2);
    // The payload's closing tags are slash-escaped, then `<`-escaped.
    // (`\/` decodes to `/` inside JS string literals.)
    expect(html).toContain("\\u003c\\/script>");
  });

  it("loads nothing remote", () => {
    const html = buildEditorDocument({
      theme,
      grammarKey: "typescript",
      doc: "const a = 1;",
    });
    expect(html).not.toContain("<script src=");
    expect(html).not.toContain("<link");
    expect(html).not.toMatch(/src="https?:/);
  });

  it("exposes every inbound handler the RN bridge sends", () => {
    const html = buildEditorDocument({
      theme,
      grammarKey: null,
      doc: "",
    });
    for (const type of [
      "set-doc",
      "grammar",
      "theme",
      "undo",
      "redo",
      "indent",
      "focus",
      "search",
      "count",
    ]) {
      expect(html).toContain(`"${type}"`);
    }
  });

  it("escapeInlineScript only touches closing script tags", () => {
    expect(escapeInlineScript("a < b && c > d")).toBe("a < b && c > d");
    expect(escapeInlineScript("x</script>y")).toBe("x<\\/script>y");
    expect(escapeInlineJson('{"a":"<b>"}')).toBe('{"a":"\\u003cb>"}');
  });
});
