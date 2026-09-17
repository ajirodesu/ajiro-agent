import { describe, expect, it, vi } from "vitest";

import {
  GITHUB_LATEST_RELEASE_URL,
  GITHUB_LICENSE_URL,
  GITHUB_REPO_URL,
  getLatestReleaseUrl,
} from "@/modules/about/app-links";

describe("about links", () => {
  it("points at the Ajiro Agent repository", () => {
    expect(GITHUB_REPO_URL).toBe("https://github.com/ajirodesu/ajiro-agent");
    expect(GITHUB_LICENSE_URL).toBe(
      "https://github.com/ajirodesu/ajiro-agent/blob/main/LICENSE",
    );
    expect(GITHUB_LATEST_RELEASE_URL).toBe(
      "https://github.com/ajirodesu/ajiro-agent/releases/latest",
    );
  });

  it("resolves the latest release dynamically from the GitHub API", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        html_url: "https://github.com/ajirodesu/ajiro-agent/releases/tag/v9.9.9",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(getLatestReleaseUrl()).resolves.toBe(
        "https://github.com/ajirodesu/ajiro-agent/releases/tag/v9.9.9",
      );
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
        "api.github.com/repos/ajirodesu/ajiro-agent/releases/latest",
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("falls back to the redirect URL when the API is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("offline")),
    );
    try {
      await expect(getLatestReleaseUrl()).resolves.toBe(
        GITHUB_LATEST_RELEASE_URL,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
