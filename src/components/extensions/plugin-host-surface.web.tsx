/**
 * Web Preview plugin host: mounts nothing. Entry-script plugins need the
 * native WebView document, which browsers cannot provide; the runtime
 * detects the missing execution host and falls back to declarative
 * activation (diagnosed, retryable) instead of marking plugins broken.
 * No plugin code executes here, and nothing is installed, enabled, or
 * run as a side effect of previewing.
 */
export function PluginHostSurface() {
  return null;
}
