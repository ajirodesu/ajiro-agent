import { describe, expect, it } from "vitest";

import { adaptAppThemeToEditorTheme } from "@/editor/editorThemeAdapter";
import {
  buildEditorDocument,
  escapeInlineJson,
  escapeInlineScript,
} from "@/editor/editorDocument";
import { chordIdFromEvent } from "@/modules/extensions/key-bindings";
import { aquaTheme } from "@/theme/aqua";

const theme = adaptAppThemeToEditorTheme(aquaTheme, null);

describe("editorDocument plugin command chords (§45)", () => {
  const html = buildEditorDocument({ theme, grammarKey: null, doc: "" });

  it("claims plugin chords through a live keydown handler", () => {
    expect(html).toContain("boundChords");
    expect(html).toContain("command-key");
    expect(html).toContain("domEventHandlers");
    // Chords are pushed by the host, so re-binding needs no reload.
    expect(html).toContain('msg.type === "keybindings"');
  });

  /**
   * The document builds chords in plain JS, the app builds them in
   * TypeScript. If those two disagree, a plugin's binding silently never
   * fires — so the inline implementation is extracted and compared here.
   */
  function inlineChordId(event: {
    altKey?: boolean;
    ctrlKey?: boolean;
    key: string;
    metaKey?: boolean;
    shiftKey?: boolean;
  }): string {
    const match = /function chordIdForEvent\(event\) \{([\s\S]*?)\n  \}/.exec(html);
    expect(match).not.toBeNull();
    const body = match?.[1] ?? "";
    const fn = new Function(`return function (event) {${body}\n}`)() as (
      value: typeof event,
    ) => string;
    return fn(event);
  }

  it("computes canonical chord ids exactly like the app does", () => {
    const events = [
      { ctrlKey: true, key: "P", shiftKey: true },
      { altKey: true, key: "Enter" },
      { key: " ", metaKey: true },
      { ctrlKey: true, key: "Escape" },
      { ctrlKey: true, key: "s" },
      { key: "F5" },
    ];
    for (const event of events) {
      expect(inlineChordId(event)).toBe(chordIdFromEvent(event));
    }
  });
});

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
      "autocomplete",
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
