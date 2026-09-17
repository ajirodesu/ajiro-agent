/**
 * Canonical Ajiro Agent links + latest-release resolution.
 *
 * The latest-release URL is resolved dynamically at runtime via the GitHub
 * Releases API so Share always points at the current release — never a
 * hardcoded fixed-version URL. The `/releases/latest` redirect is the
 * fallback (GitHub itself resolves it to the newest release).
 */
import type { Platform as PlatformType, Share as ShareType } from "react-native";

export const GITHUB_REPO_URL = "https://github.com/ajirodesu/ajiro-agent";
export const GITHUB_LICENSE_URL =
  "https://github.com/ajirodesu/ajiro-agent/blob/main/LICENSE";
export const GITHUB_LATEST_RELEASE_URL =
  "https://github.com/ajirodesu/ajiro-agent/releases/latest";

const LATEST_RELEASE_API_URL =
  "https://api.github.com/repos/ajirodesu/ajiro-agent/releases/latest";

/** Resolve the current latest-release page URL, with redirect fallback. */
export async function getLatestReleaseUrl(): Promise<string> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(LATEST_RELEASE_API_URL, {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        signal: controller.signal,
      });
      if (response.ok) {
        const data = (await response.json()) as { html_url?: unknown };
        if (typeof data?.html_url === "string" && data.html_url.trim()) {
          return data.html_url.trim();
        }
      }
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    // Network/API failure — fall through to the redirect URL below.
  }
  return GITHUB_LATEST_RELEASE_URL;
}

/** Open the native share sheet with a link to the latest release. */
export async function shareLatestRelease(
  deps?: { Platform: PlatformType; Share: ShareType },
): Promise<void> {
  const { Platform, Share } =
    deps ?? ((await import("react-native")) as unknown as typeof deps & {});
  const url = await getLatestReleaseUrl();
  if (Platform.OS === "ios") {
    await Share.share({ url, message: "Get Ajiro Agent (latest release)" });
  } else {
    await Share.share({ message: `Get Ajiro Agent (latest release): ${url}` });
  }
}
