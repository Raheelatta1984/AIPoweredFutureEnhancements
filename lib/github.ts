/**
 * GitHub Contents API client used to publish a handover document into the
 * consuming repository. Failure is always surfaced — a stage move is refused
 * rather than pretending the document exists (docs/DECISIONS.md).
 */

import { resolveGithubToken } from "./github-credentials.ts";

/**
 * API base. `GITHUB_API_URL` makes this testable and adds GitHub Enterprise support
 * (https://ghe.example.com/api/v3); it defaults to the public API.
 */
function apiBase(): string {
  const configured = process.env.GITHUB_API_URL?.trim();
  return (configured || "https://api.github.com").replace(/\/+$/, "");
}

export type GithubConfig = { token: string | null; repo: string; branch?: string };

export type PublishResult = {
  ok: boolean;
  path: string;
  htmlUrl?: string;
  commitSha?: string;
  error?: string;
};

/** Env token first, then the token an admin stored on /tenants. */
export function githubToken(): string | null {
  return resolveGithubToken();
}

export function githubConfigured(): boolean {
  return githubToken() !== null;
}

export function defaultBranch(): string {
  return process.env.GITHUB_DEFAULT_BRANCH?.trim() || "main";
}

export function splitRepo(repo: string): { owner: string; name: string } | null {
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec((repo ?? "").trim());
  if (!match) return null;
  return { owner: match[1], name: match[2].replace(/\.git$/, "") };
}

/** Normalises "docs/enhancements/" -> "docs/enhancements" and rejects traversal. */
export function normaliseDir(dir: string, fallback = "docs/enhancements"): string {
  const cleaned = (dir ?? "")
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/{2,}/g, "/");
  if (!cleaned || cleaned.includes("..")) return fallback;
  return cleaned;
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "ai-powered-future-enhancements-hub",
  };
}

function toBase64(content: string): string {
  return Buffer.from(content, "utf8").toString("base64");
}

export type RemoteDoc = { path: string; sha: string; htmlUrl?: string };

async function getContent(config: GithubConfig & { token: string }, path: string, branch: string) {
  const { owner, name } = splitRepo(config.repo) ?? { owner: "", name: "" };
  const url = `${apiBase()}/repos/${owner}/${name}/contents/${encodeURI(path)}?ref=${encodeURIComponent(branch)}`;
  const response = await fetch(url, { headers: authHeaders(config.token), cache: "no-store" });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`GitHub read failed (${response.status}): ${await safeMessage(response)}`);
  }
  const data = (await response.json()) as { sha?: string; html_url?: string; content?: string };
  return { sha: data.sha ?? "", htmlUrl: data.html_url, content: data.content };
}

async function safeMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string };
    return body?.message ?? response.statusText;
  } catch {
    return response.statusText;
  }
}

/**
 * Creates or updates a file through the Contents API.
 * Returns a result object instead of throwing so callers can show the failure.
 */
export async function publishDocument(
  config: GithubConfig,
  path: string,
  content: string,
  message: string,
): Promise<PublishResult> {
  const repo = splitRepo(config.repo);
  if (!repo) return { ok: false, path, error: `Invalid github_repo "${config.repo}" — expected "owner/repo".` };
  if (!config.token) return { ok: false, path, error: "GITHUB_TOKEN is not configured on the hub, so nothing was published." };

  const branch = config.branch || defaultBranch();
  try {
    const existing = await getContent({ ...config, token: config.token }, path, branch);
    const url = `${apiBase()}/repos/${repo.owner}/${repo.name}/contents/${encodeURI(path)}`;
    const body: Record<string, unknown> = {
      message,
      content: toBase64(content),
      branch,
    };
    if (existing?.sha) body.sha = existing.sha;
    const response = await fetch(url, {
      method: "PUT",
      headers: { ...authHeaders(config.token), "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    if (!response.ok) {
      return { ok: false, path, error: `GitHub publish failed (${response.status}): ${await safeMessage(response)}` };
    }
    const data = (await response.json()) as { commit?: { sha?: string }; content?: { html_url?: string } };
    return {
      ok: true,
      path,
      commitSha: data.commit?.sha,
      htmlUrl: data.content?.html_url,
    };
  } catch (error) {
    return { ok: false, path, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Lists Markdown files under a folder (one level, no recursion). */
export async function listDocuments(
  config: GithubConfig,
  dir: string,
  branch = defaultBranch(),
): Promise<{ ok: boolean; docs: RemoteDoc[]; error?: string }> {
  const repo = splitRepo(config.repo);
  if (!repo) return { ok: false, docs: [], error: `Invalid github_repo "${config.repo}".` };
  if (!config.token) return { ok: false, docs: [], error: "GITHUB_TOKEN is not configured on the hub." };
  try {
    const url = `${apiBase()}/repos/${repo.owner}/${repo.name}/contents/${encodeURI(normaliseDir(dir))}?ref=${encodeURIComponent(branch)}`;
    const response = await fetch(url, { headers: authHeaders(config.token), cache: "no-store" });
    if (response.status === 404) return { ok: true, docs: [] };
    if (!response.ok) {
      return { ok: false, docs: [], error: `GitHub listing failed (${response.status}): ${await safeMessage(response)}` };
    }
    const data = (await response.json()) as Array<{ name: string; path: string; sha: string; html_url?: string; type: string }>;
    const docs = data
      .filter((entry) => entry.type === "file" && entry.name.endsWith(".md"))
      .map((entry) => ({ path: entry.path, sha: entry.sha, htmlUrl: entry.html_url }));
    return { ok: true, docs };
  } catch (error) {
    return { ok: false, docs: [], error: error instanceof Error ? error.message : String(error) };
  }
}

/** Reads a single document's text (used by the handover reconciliation view). */
export async function readDocument(
  config: GithubConfig,
  path: string,
  branch = defaultBranch(),
): Promise<{ ok: boolean; content?: string; error?: string }> {
  const repo = splitRepo(config.repo);
  if (!repo) return { ok: false, error: `Invalid github_repo "${config.repo}".` };
  if (!config.token) return { ok: false, error: "GITHUB_TOKEN is not configured on the hub." };
  try {
    const existing = await getContent({ ...config, token: config.token }, path, branch);
    if (!existing) return { ok: false, error: `Not found: ${path}` };
    const content = existing.content
      ? Buffer.from(existing.content, "base64").toString("utf8")
      : "";
    return { ok: true, content };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/* ------------------------------------------------------------------ discovery */

export type GithubRepo = {
  /** "owner/name" — exactly what a tenant's github_repo column stores. */
  fullName: string;
  name: string;
  owner: string;
  private: boolean;
  archived: boolean;
  description: string | null;
  /** ISO date of the last push, or null when GitHub did not report one. */
  pushedAt: string | null;
  defaultBranch: string;
  htmlUrl: string;
  /** True when this repo is already connected to a tenant in the hub. */
  connected: boolean;
};

export type RepoListResult = {
  ok: boolean;
  repos: GithubRepo[];
  error?: string;
  /** Which credential produced this list, for the UI to explain itself. */
  source: "env" | "stored" | "none";
};

type RawRepo = {
  full_name?: unknown;
  name?: unknown;
  owner?: { login?: unknown } | null;
  private?: unknown;
  archived?: unknown;
  description?: unknown;
  pushed_at?: unknown;
  default_branch?: unknown;
  html_url?: unknown;
};

/**
 * Lists every repository the hub's token can see, so an admin can connect a project
 * by picking it instead of typing "owner/repo".
 *
 * `connectedRepos` is passed in (lowercased) so the caller decides what "already
 * connected" means without this module touching the database.
 */
export async function listRepos(connectedRepos: ReadonlySet<string> = new Set()): Promise<RepoListResult> {
  const token = githubToken();
  const source: RepoListResult["source"] = process.env.GITHUB_TOKEN?.trim() ? "env" : token ? "stored" : "none";
  if (!token) {
    return {
      ok: false,
      repos: [],
      source,
      error: "No GitHub token is available. Paste one on /tenants (or set GITHUB_TOKEN) to list your projects.",
    };
  }

  const repos: GithubRepo[] = [];
  try {
    // 100 per page, capped at 10 pages: a hub needing more than 1000 repos is out of scope.
    for (let page = 1; page <= 10; page += 1) {
      const response = await fetch(
        `${apiBase()}/user/repos?per_page=100&page=${page}&sort=pushed&affiliation=owner,collaborator,organization_member`,
        {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "future-enhancements-hub",
        },
        cache: "no-store",
      });
      if (!response.ok) {
        const detail = await safeMessage(response);
        return {
          ok: false,
          repos,
          source,
          error:
            response.status === 401
              ? "GitHub rejected the token (401). Check that it has not expired and has repo read access."
              : `GitHub repository listing failed (${response.status}): ${detail}`,
        };
      }
      const pageJson = (await response.json()) as unknown;
      if (!Array.isArray(pageJson) || pageJson.length === 0) break;
      for (const raw of pageJson as RawRepo[]) {
        const fullName = typeof raw.full_name === "string" ? raw.full_name : "";
        const owner = typeof raw.owner?.login === "string" ? raw.owner.login : fullName.split("/")[0] ?? "";
        const name = typeof raw.name === "string" ? raw.name : fullName.split("/")[1] ?? "";
        if (!owner || !name) continue;
        repos.push({
          fullName,
          name,
          owner,
          private: Boolean(raw.private),
          archived: Boolean(raw.archived),
          description: typeof raw.description === "string" ? raw.description : null,
          pushedAt: typeof raw.pushed_at === "string" ? raw.pushed_at : null,
          defaultBranch: typeof raw.default_branch === "string" ? raw.default_branch : "main",
          htmlUrl: typeof raw.html_url === "string" ? raw.html_url : `https://github.com/${fullName}`,
          connected: connectedRepos.has(fullName.toLowerCase()),
        });
      }
      if (pageJson.length < 100) break;
    }
  } catch (error) {
    return {
      ok: false,
      repos,
      source,
      error: `Could not reach GitHub: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  return { ok: true, repos, source };
}

/** Cheap credential check for the admin UI: does the token authenticate at all? */
export async function verifyToken(): Promise<{ ok: boolean; login?: string; error?: string }> {
  const token = githubToken();
  if (!token) return { ok: false, error: "No token configured." };
  try {
    const response = await fetch(`${apiBase()}/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "future-enhancements-hub",
      },
      cache: "no-store",
    });
    if (!response.ok) return { ok: false, error: `GitHub returned ${response.status}.` };
    const json = (await response.json()) as { login?: unknown };
    return { ok: true, login: typeof json.login === "string" ? json.login : undefined };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Parses a pasted list of repositories ("owner/name", one per line or comma/space
 * separated). Blank lines, comments and duplicates are dropped; anything malformed is
 * reported rather than silently ignored, because a typo here creates a tenant that can
 * never publish.
 */
export function parseRepoLines(
  input: string,
): { valid: string[]; invalid: string[] } {
  const valid: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  // Strip whole-line comments BEFORE splitting: otherwise "# note" contributes a word.
  const cleaned = input
    .split(/\r?\n/)
    .map((line) => line.replace(/(^|\s)#.*$/, ""))
    .join("\n");
  for (const chunk of cleaned.split(/[\s,;]+/)) {
    const candidate = chunk.trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/i, "");
    if (!candidate) continue;
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(candidate)) {
      if (!invalid.includes(candidate)) invalid.push(candidate);
      continue;
    }
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    valid.push(candidate);
  }
  return { valid, invalid };
}
