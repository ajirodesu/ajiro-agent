/**
 * WebView shims for the node builtins TypeScript's node `sys` touches at
 * module scope (`os.platform()`, `process.platform`, `fs.realpathSync`).
 * The language service never uses `ts.sys` (it runs on the injected
 * in-memory host), so these only need to survive module evaluation —
 * anything else throws loudly instead of silently misbehaving.
 */
export function platform() {
  return "linux";
}

export function tmpdir() {
  return "/tmp";
}

export function homedir() {
  return "/";
}

export const EOL = "\n";

export default { platform, tmpdir, homedir, EOL };
