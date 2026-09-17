/**
 * WebView `process` shim (see os.js header). Injected by esbuild into every
 * module that references the free identifier `process`.
 */
function cwd() {
  return "/";
}

export const process = {
  platform: "linux",
  env: { NODE_ENV: "production" },
  versions: {},
  execArgv: [],
  argv: [],
  cwd,
};
