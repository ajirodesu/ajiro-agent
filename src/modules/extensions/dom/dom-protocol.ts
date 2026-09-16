/**
 * Identifiers shared between the plugin host document (webview side) and the
 * React Native surface. Kept in one module so the HTML builder, the injected
 * runtime, and the host can never drift apart on a name.
 */

/** Container element every plugin page is appended to. */
export const PLUGIN_PAGE_CONTAINER_ID = "ajiro-plugin-pages";

/** Function the host calls to deliver an inbound message inside the webview. */
export const PLUGIN_RUNTIME_GLOBAL = "__AjiroPluginInbox__";

/** Flag set on the webview document once the runtime script has installed. */
export const PLUGIN_READY_GLOBAL = "__AjiroPluginReady__";

/**
 * How long the host waits for the webview document to report ready before it
 * gives up on DOM-backed activation for this session.
 */
export const PLUGIN_HOST_READY_TIMEOUT_MS = 10_000;
