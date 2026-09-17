/**
 * Bundled TypeScript library files (§5).
 *
 * The language service needs real `lib.*.d.ts` files for globals. They ship
 * offline inside the intel vendor bundle (embedded as text by
 * `scripts/vendor-intel.mjs`); Node tests read them from the installed
 * `typescript` package. The entry list here is the single source of truth —
 * the vendor script embeds exactly the transitive closure below.
 */
export const LIB_ENTRY: readonly string[] = ["ES2022", "DOM", "DOM.Iterable"];

export const VIRTUAL_LIB_DIR = "/__ajiro_lib__";

export type LibFileReader = (fileName: string) => string | null;

/** `/// <reference lib="X" />` targets inside a lib file. */
export function referencedLibs(content: string): string[] {
  const out: string[] = [];
  const pattern = /\/\/\/\s*<reference\s+lib="([^"]+)"\s*\/>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    const name = match[1];
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

export function libFileNameFor(lib: string): string {
  return `lib.${lib.toLowerCase()}.d.ts`;
}

/**
 * Transitive closure of lib files starting from entry libs. `readPackageLib`
 * reads a `lib.*.d.ts` file by file name (vendor script: fs; tests: fs).
 * Unknown/missing files are skipped, never fatal — the service degrades to
 * fewer globals rather than failing to start.
 */
export function resolveLibClosure(
  readPackageLib: (fileName: string) => string | null,
  entryLibs: readonly string[] = LIB_ENTRY,
): Map<string, string> {
  const collected = new Map<string, string>();
  const queue = entryLibs.map(libFileNameFor);
  const seen = new Set<string>();
  while (queue.length > 0) {
    const fileName = queue.pop() as string;
    if (seen.has(fileName)) continue;
    seen.add(fileName);
    const content = readPackageLib(fileName);
    if (content === null) continue;
    collected.set(fileName, content);
    for (const lib of referencedLibs(content)) {
      const dep = libFileNameFor(lib);
      if (!seen.has(dep)) queue.push(dep);
    }
  }
  return collected;
}
