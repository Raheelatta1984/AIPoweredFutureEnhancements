/**
 * GitHub Contents API client used to publish a handover document into the
 * consuming repository. Failure is always surfaced — a stage move is refused
 * rather than pretending the document exists (docs/DECISIONS.md).
 */

const API = "https://api.github.com";

export type GithubConfig = { token: string | null; repo: string; branch?: string };

export type PublishResult = {
  ok: boolean;
  path: string;
  htmlUrl?: string;
  commitSha?: string;
  error?: string;
};

export function githubToken(): string | null {
  const token = process.env.GITHUB_TOKEN?.trim();
  return token ? token : null;
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
  const url = `${API}/repos/${owner}/${name}/contents/${encodeURI(path)}?ref=${encodeURIComponent(branch)}`;
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
    const url = `${API}/repos/${repo.owner}/${repo.name}/contents/${encodeURI(path)}`;
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
    const url = `${API}/repos/${repo.owner}/${repo.name}/contents/${encodeURI(normaliseDir(dir))}?ref=${encodeURIComponent(branch)}`;
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
