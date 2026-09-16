/**
 * Remote repository creation for the Git Settings screen.
 *
 * Creates a real repository on the selected provider via its REST API
 * using the stored provider token, then the caller points the local
 * `origin` at the returned clone URL:
 * - GitHub: `POST /user/repos` (Bearer token, `repo` scope).
 * - Bitbucket Cloud: username lookup + `POST
 *   /2.0/repositories/{workspace}/{slug}` (Bearer token).
 * - GitLab.com: `POST /api/v4/projects` (`PRIVATE-TOKEN` header).
 *
 * Personal workspaces are fully supported. Organization creation needs an
 * organization name the dialog does not collect, so it is refused with an
 * honest validation message instead of a faked request.
 */
import type { GitProviderSlug } from "@/git-providers/providerIcons";

export type RepoLocation = "personal" | "organization";
export type RepoVisibility = "private" | "public";

export type CreateRepoInput = {
  name: string;
  description: string;
  visibility: RepoVisibility;
  location: RepoLocation;
};

export type CreatedRepo = {
  cloneUrl: string;
  htmlUrl: string;
  fullName: string;
};

const PROVIDER_LABELS: Record<GitProviderSlug, string> = {
  github: "GitHub",
  bitbucket: "Bitbucket",
  gitlab: "GitLab",
};

/** Returns an error message, or null when the name is acceptable. */
export function validateRepoName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Repository name is required";
  if (trimmed.length > 100) return "Keep the name under 100 characters";
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) {
    return "Use only letters, numbers, ., -, _";
  }
  return null;
}

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const data = (await response.json()) as {
      message?: unknown;
      error?: unknown;
    };
    if (typeof data.message === "string" && data.message) return data.message;
    if (typeof data.error === "string" && data.error) return data.error;
  } catch {
    // Fall through to the status-based message.
  }
  return `${fallback} (responded with ${response.status})`;
}

async function createGitHubRepo(
  token: string,
  input: CreateRepoInput,
): Promise<CreatedRepo> {
  const response = await fetch("https://api.github.com/user/repos", {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: input.name.trim(),
      description: input.description.trim() || undefined,
      private: input.visibility === "private",
    }),
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error("Token was rejected — it needs the repo scope");
  }
  if (response.status === 422) {
    throw new Error("GitHub rejected that name (taken or invalid)");
  }
  if (!response.ok) {
    throw new Error(await readError(response, "GitHub creation failed"));
  }
  const data = (await response.json()) as {
    clone_url?: unknown;
    html_url?: unknown;
    full_name?: unknown;
  };
  if (typeof data.clone_url !== "string" || !data.clone_url) {
    throw new Error("GitHub returned an unexpected response");
  }
  return {
    cloneUrl: data.clone_url,
    htmlUrl: typeof data.html_url === "string" ? data.html_url : data.clone_url,
    fullName:
      typeof data.full_name === "string" ? data.full_name : input.name.trim(),
  };
}

async function createBitbucketRepo(
  token: string,
  input: CreateRepoInput,
): Promise<CreatedRepo> {
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const meResponse = await fetch("https://api.bitbucket.org/2.0/user", {
    headers,
  });
  if (!meResponse.ok) {
    throw new Error("Token was rejected — sign in again");
  }
  const me = (await meResponse.json()) as { username?: unknown };
  if (typeof me.username !== "string" || !me.username) {
    throw new Error("Bitbucket returned an unexpected profile");
  }
  const slug = input.name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const response = await fetch(
    `https://api.bitbucket.org/2.0/repositories/${me.username}/${slug}`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        scm: "git",
        is_private: input.visibility === "private",
        description: input.description.trim() || undefined,
      }),
    },
  );
  if (response.status === 401 || response.status === 403) {
    throw new Error("Token was rejected — sign in again");
  }
  if (!response.ok) {
    throw new Error(await readError(response, "Bitbucket creation failed"));
  }
  const data = (await response.json()) as {
    full_name?: unknown;
    links?: { clone?: { href?: unknown; name?: unknown }[] };
  };
  const https = data.links?.clone?.find((link) => link.name === "https");
  if (typeof https?.href !== "string" || !https.href) {
    throw new Error("Bitbucket returned an unexpected response");
  }
  return {
    cloneUrl: https.href,
    htmlUrl: https.href.replace(/\.git$/, ""),
    fullName:
      typeof data.full_name === "string" ? data.full_name : slug,
  };
}

async function createGitLabRepo(
  token: string,
  input: CreateRepoInput,
): Promise<CreatedRepo> {
  const response = await fetch("https://gitlab.com/api/v4/projects", {
    method: "POST",
    headers: {
      "PRIVATE-TOKEN": token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: input.name.trim(),
      description: input.description.trim() || undefined,
      visibility: input.visibility === "private" ? "private" : "public",
    }),
  });
  if (response.status === 401) {
    throw new Error("Token was rejected — sign in again");
  }
  if (!response.ok) {
    throw new Error(await readError(response, "GitLab creation failed"));
  }
  const data = (await response.json()) as {
    http_url_to_repo?: unknown;
    web_url?: unknown;
    path_with_namespace?: unknown;
  };
  if (typeof data.http_url_to_repo !== "string" || !data.http_url_to_repo) {
    throw new Error("GitLab returned an unexpected response");
  }
  return {
    cloneUrl: data.http_url_to_repo,
    htmlUrl:
      typeof data.web_url === "string"
        ? data.web_url
        : data.http_url_to_repo,
    fullName:
      typeof data.path_with_namespace === "string"
        ? data.path_with_namespace
        : input.name.trim(),
  };
}

export async function createRemoteRepo(
  provider: GitProviderSlug,
  token: string | null,
  input: CreateRepoInput,
): Promise<CreatedRepo> {
  if (!token) {
    throw new Error(`Sign in to ${PROVIDER_LABELS[provider]} first`);
  }
  const nameError = validateRepoName(input.name);
  if (nameError) throw new Error(nameError);
  if (input.location === "organization") {
    throw new Error("Organization repos need an organization name — use Personal");
  }
  switch (provider) {
    case "github":
      return createGitHubRepo(token, input);
    case "bitbucket":
      return createBitbucketRepo(token, input);
    case "gitlab":
      return createGitLabRepo(token, input);
  }
}
