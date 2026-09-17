/**
 * Honest per-language capability matrix (§6).
 *
 * `semantic: true` is claimed ONLY where a real local analyzer backs it
 * (TypeScript/JavaScript via the bundled compiler service, JSON via schema
 * + parser). Everything else is syntax-level: grammar highlighting, word
 * completion, regex outline, bracket/fold support from CodeMirror. The UI
 * reads this matrix to label Syntax vs Semantic vs Formatting vs
 * Diagnostics vs Navigation support — never the reverse.
 */
import type { IntelCapabilities } from "@/modules/intel/types";

export interface LanguageCapabilityEntry extends IntelCapabilities {
  languageId: string;
  label: string;
  /** Why semantic is or isn't available (shown in UI details). */
  note: string;
}

const FULL_SEMANTIC: IntelCapabilities = {
  semantic: true,
  syntax: true,
  formatting: true,
  diagnostics: true,
  navigation: true,
};

const SYNTAX_ONLY: IntelCapabilities = {
  semantic: false,
  syntax: true,
  formatting: false,
  diagnostics: false,
  navigation: false,
};

function entry(
  languageId: string,
  label: string,
  capabilities: IntelCapabilities,
  note: string,
): LanguageCapabilityEntry {
  return { languageId, label, ...capabilities, note };
}

export const LANGUAGE_CAPABILITIES: readonly LanguageCapabilityEntry[] = [
  entry("typescript", "TypeScript", FULL_SEMANTIC, "Full semantic engine: bundled TypeScript compiler language service."),
  entry("javascript", "JavaScript", FULL_SEMANTIC, "Full semantic engine: bundled TypeScript compiler language service (JS with checkJs semantics where configured)."),
  entry("tsx", "TSX", FULL_SEMANTIC, "TypeScript service with JSX enabled."),
  entry("jsx", "JSX", FULL_SEMANTIC, "TypeScript service with JSX enabled."),
  entry(
    "json",
    "JSON",
    { ...SYNTAX_ONLY, formatting: true, diagnostics: true },
    "Parser-backed diagnostics + canonical formatter; no type system.",
  ),
  entry("python", "Python", SYNTAX_ONLY, "Syntax highlighting, word completion, and outline only. No local type inference on device."),
  entry("html", "HTML", { ...SYNTAX_ONLY, formatting: false, diagnostics: false }, "Grammar + Emmet completions; no DOM-aware semantics."),
  entry("css", "CSS", SYNTAX_ONLY, "Grammar completion only."),
  entry("scss", "SCSS", SYNTAX_ONLY, "Grammar completion only."),
  entry("sql", "SQL", SYNTAX_ONLY, "Keyword completion from the grammar; no schema awareness."),
  entry("java", "Java", SYNTAX_ONLY, "Syntax highlighting and outline only. No JVM toolchain on device."),
  entry("kotlin", "Kotlin", SYNTAX_ONLY, "Syntax highlighting only. No Kotlin compiler on device."),
  entry("cpp", "C/C++", SYNTAX_ONLY, "Syntax highlighting and outline only. No clangd on device."),
  entry("csharp", "C#", SYNTAX_ONLY, "Syntax highlighting and outline only. No Roslyn on device."),
  entry("go", "Go", SYNTAX_ONLY, "Syntax highlighting and outline only. No gopls on device."),
  entry("rust", "Rust", SYNTAX_ONLY, "Syntax highlighting and outline only. No rust-analyzer on device."),
  entry("php", "PHP", SYNTAX_ONLY, "Syntax highlighting and outline only."),
  entry("yaml", "YAML", { ...SYNTAX_ONLY, diagnostics: true }, "Parser-backed diagnostics; no schema validation."),
  entry("markdown", "Markdown", SYNTAX_ONLY, "Prose editing; no semantics."),
  entry("xml", "XML", { ...SYNTAX_ONLY, diagnostics: true }, "Well-formedness diagnostics; no schema validation."),
  entry("vue", "Vue", SYNTAX_ONLY, "Grammar highlighting (html/css/js regions); no SFC type-checking."),
  entry("angular", "Angular", SYNTAX_ONLY, "Grammar highlighting; no Angular language service."),
  entry("plaintext", "Plain Text", { ...SYNTAX_ONLY, syntax: false }, "No language support."),
];

const BY_ID = new Map(LANGUAGE_CAPABILITIES.map((entry) => [entry.languageId, entry]));

export function capabilitiesFor(languageId: string): LanguageCapabilityEntry {
  return (
    BY_ID.get(languageId) ?? {
      languageId,
      label: languageId,
      ...SYNTAX_ONLY,
      note: "Unknown language: syntax-level support only.",
    }
  );
}

/** Languages the UI may advertise as having semantic IntelliSense. */
export function semanticLanguages(): string[] {
  return LANGUAGE_CAPABILITIES.filter((entry) => entry.semantic).map((entry) => entry.languageId);
}
