/**
 * `terminal-pty` Expo module entry.
 *
 * NOTE: this file is intentionally thin. The canonical typed surface is
 * `src/native/TerminalBridge.ts` (`terminalBridge` singleton) — always use
 * that. This entry exists only because Expo autolinking requires a module
 * `main`; it re-exports the bridge types for native-module consumers.
 */
export type { CommandResult } from "@/native/nativeTypes";
export type { TerminalBridge } from "@/native/TerminalBridge";
export { terminalBridge } from "@/native/TerminalBridge";
