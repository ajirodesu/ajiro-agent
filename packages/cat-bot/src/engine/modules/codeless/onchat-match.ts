/** onChat content matcher (Detection Mode + Keyword/Pattern + Case Sensitive). */
import type { CodelessOnChatConfig } from "./command-config.types";

export function matchesOnChatMessage(
  message: string,
  config: CodelessOnChatConfig,
): boolean {
  const text = String(message ?? "");
  const keyword = String(config?.keyword ?? "");
  if (!text || !keyword) return false;
  const haystack = config.caseSensitive ? text : text.toLowerCase();
  const needle = config.caseSensitive ? keyword : keyword.toLowerCase();
  switch (config.detectionMode) {
    case "exact":
      return haystack === needle;
    case "startsWith":
      return haystack.startsWith(needle);
    case "regex":
      try {
        return new RegExp(keyword, config.caseSensitive ? "" : "i").test(text);
      } catch {
        return false;
      }
    case "contains":
    default:
      return haystack.includes(needle);
  }
}
