import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createRemoteRepo,
  validateRepoName,
} from "@/git-providers/createRemoteRepo";

function mockFetch(
  responses: { status: number; body: unknown }[],
): { url: string; init?: RequestInit }[] {
  const calls: { url: string; init?: RequestInit }[] = [];
  const queue = [...responses];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const next = queue.shift() ?? { status: 500, body: {} };
      return {
        ok: next.status >= 200 && next.status < 300,
        status: next.status,
        json: async () => next.body,
      } as Response;
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createRemoteRepo", () => {
  it("validates the repository name", () => {
    expect(validateRepoName("")).toBe("Repository name is required");
    expect(validateRepoName("   ")).toBe("Repository name is required");
    expect(validateRepoName("my repo")).toContain("Use only");
    expect(validateRepoName("ok-name_1.x")).toBeNull();
  });

  it("requires a token and a personal location", async () => {
    await expect(
      createRemoteRepo("github", null, {
        name: "r",
        description: "",
        visibility: "private",
        location: "personal",
      }),
    ).rejects.toThrow("Sign in to GitHub first");
    await expect(
      createRemoteRepo("github", "t", {
        name: "r",
        description: "",
        visibility: "private",
        location: "organization",
      }),
    ).rejects.toThrow("Organization repos");
    await expect(
      createRemoteRepo("github", "t", {
        name: "",
        description: "",
        visibility: "private",
        location: "personal",
      }),
    ).rejects.toThrow("Repository name is required");
  });

  it("creates a private GitHub repo via the API", async () => {
    const calls = mockFetch([
      {
        status: 201,
        body: {
          clone_url: "https://github.com/o/r.git",
          html_url: "https://github.com/o/r",
          full_name: "o/r",
        },
      },
    ]);
    const created = await createRemoteRepo("github", "token", {
      name: "r",
      description: "hi",
      visibility: "private",
      location: "personal",
    });
    expect(created).toEqual({
      cloneUrl: "https://github.com/o/r.git",
      htmlUrl: "https://github.com/o/r",
      fullName: "o/r",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.github.com/user/repos");
    const init = calls[0]!.init!;
    expect(init.method).toBe("POST");
    expect(
      (init.headers as Record<string, string>).Authorization,
    ).toBe("Bearer token");
    expect(JSON.parse(init.body as string)).toMatchObject({
      name: "r",
      description: "hi",
      private: true,
    });
  });

  it("maps GitHub auth and validation failures", async () => {
    mockFetch([{ status: 401, body: {} }]);
    await expect(
      createRemoteRepo("github", "bad", {
        name: "r",
        description: "",
        visibility: "private",
        location: "personal",
      }),
    ).rejects.toThrow("repo scope");
    mockFetch([{ status: 422, body: {} }]);
    await expect(
      createRemoteRepo("github", "t", {
        name: "r",
        description: "",
        visibility: "public",
        location: "personal",
      }),
    ).rejects.toThrow("taken or invalid");
  });

  it("creates a Bitbucket repo under the token username", async () => {
    const calls = mockFetch([
      { status: 200, body: { username: "someone" } },
      {
        status: 201,
        body: {
          full_name: "someone/r",
          links: {
            clone: [
              { href: "https://someone@bitbucket.org/someone/r.git", name: "https" },
              { href: "git@bitbucket.org:someone/r.git", name: "ssh" },
            ],
          },
        },
      },
    ]);
    const created = await createRemoteRepo("bitbucket", "token", {
      name: "R",
      description: "",
      visibility: "public",
      location: "personal",
    });
    expect(created.cloneUrl).toBe(
      "https://someone@bitbucket.org/someone/r.git",
    );
    expect(calls[1]!.url).toBe(
      "https://api.bitbucket.org/2.0/repositories/someone/r",
    );
    expect(JSON.parse(calls[1]!.init!.body as string)).toMatchObject({
      scm: "git",
      is_private: false,
    });
  });

  it("creates a GitLab project with the private-token header", async () => {
    const calls = mockFetch([
      {
        status: 201,
        body: {
          http_url_to_repo: "https://gitlab.com/o/r.git",
          web_url: "https://gitlab.com/o/r",
          path_with_namespace: "o/r",
        },
      },
    ]);
    const created = await createRemoteRepo("gitlab", "token", {
      name: "r",
      description: "d",
      visibility: "private",
      location: "personal",
    });
    expect(created.cloneUrl).toBe("https://gitlab.com/o/r.git");
    expect(
      (calls[0]!.init!.headers as Record<string, string>)["PRIVATE-TOKEN"],
    ).toBe("token");
    expect(JSON.parse(calls[0]!.init!.body as string)).toMatchObject({
      visibility: "private",
    });
    mockFetch([{ status: 400, body: { message: "Name is invalid" } }]);
    await expect(
      createRemoteRepo("gitlab", "token", {
        name: "r",
        description: "",
        visibility: "private",
        location: "personal",
      }),
    ).rejects.toThrow("Name is invalid");
  });
});
