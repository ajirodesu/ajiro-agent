/**
 * WebView `fs` shim (see os.js header). Only `realpathSync` (with a
 * missing `.native`) is load-bearing at module scope; everything else
 * throws if the compiler ever reaches for the real filesystem — the
 * in-memory host serves all files instead.
 */
function unavailable(name) {
  return () => {
    throw new Error(`fs.${name} is unavailable in the offline WebView bundle`);
  };
}

export const realpathSync = Object.assign((path) => path, { native: void 0 });
export const existsSync = () => false;
export const statSync = unavailable("statSync");
export const readFileSync = unavailable("readFileSync");
export const writeFileSync = unavailable("writeFileSync");
export const readdirSync = unavailable("readdirSync");
export const watch = unavailable("watch");

export default {
  realpathSync,
  existsSync,
  statSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  watch,
};
