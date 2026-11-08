import { connectRepoAction, saveGithubTokenAction } from "../actions/admin.ts";
import type { GithubRepo } from "../../lib/github.ts";
import { Notice } from "../../components/ui.tsx";
import { ActionForm, SubmitButton } from "./ActionForm.tsx";

/**
 * Two panels that turn "paste an env var and redeploy" into something an operator can
 * do in the browser:
 *   1. the GitHub token (encrypted at rest, verified against the API on save)
 *   2. a picker over every repository the token can see, connecting one as a tenant
 */
export function GithubConnectPanel({
  tokenState,
  tokenHint,
  repos,
  listError,
  source,
}: {
  tokenState: "env" | "stored" | "none";
  tokenHint: string | null;
  repos: GithubRepo[];
  listError?: string;
  source: "env" | "stored" | "none";
}) {
  const connected = repos.filter((repo) => repo.connected);
  const available = repos.filter((repo) => !repo.connected);

  return (
    <div className="stack" style={{ gap: 14 }}>
      <section className="card" aria-labelledby="github-token-heading">
        <div className="row tight" style={{ marginBottom: 4 }}>
          <h2 id="github-token-heading" style={{ fontSize: 16 }}>
            GitHub connection
          </h2>
          <span className="sid">sec.github.token</span>
          {tokenState === "env" ? (
            <span className="tag mint">from GITHUB_TOKEN env</span>
          ) : tokenState === "stored" ? (
            <span className="tag mint">stored {tokenHint}</span>
          ) : (
            <span className="tag amber">not configured</span>
          )}
        </div>
        <p className="small muted" style={{ marginTop: 0 }}>
          Publishing a handover writes Markdown into the connected repository, so the hub needs a token with{" "}
          <span className="mono">Contents: read and write</span> on the repositories you connect. Create one under
          GitHub → Settings → Developer settings → Personal access tokens. It is encrypted with a key derived from{" "}
          <span className="mono">SESSION_SECRET</span> before being stored.
        </p>

        {tokenState === "env" ? (
          <Notice tone="info">
            The token comes from the <span className="mono">GITHUB_TOKEN</span> environment variable, which takes
            precedence over anything stored here. Change it in your hosting settings.
          </Notice>
        ) : (
          <ActionForm action={saveGithubTokenAction} className="stack" style={{ gap: 10 }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="gh-token">Personal access token</label>
              <input
                id="gh-token"
                name="token"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="ghp_… or github_pat_…"
                required
              />
            </div>
            <div className="row tight">
              <SubmitButton className="btn-primary" pendingLabel="Verifying…">
                Save and verify
              </SubmitButton>
              {tokenState === "stored" ? (
                <button type="submit" name="remove" value="1" className="btn-sm btn-ghost">
                  Remove stored token
                </button>
              ) : null}
            </div>
            {tokenHint ? (
              <p className="tiny dim" style={{ margin: 0 }}>
                {tokenHint}
              </p>
            ) : null}
          </ActionForm>
        )}
      </section>

      <section className="card" aria-labelledby="github-repos-heading">
        <div className="row tight" style={{ marginBottom: 4 }}>
          <h2 id="github-repos-heading" style={{ fontSize: 16 }}>
            Your GitHub projects
          </h2>
          <span className="sid">sec.github.repos</span>
          {repos.length > 0 ? (
            <span className="tag violet">
              {repos.length} visible · {connected.length} connected
            </span>
          ) : null}
        </div>
        <p className="small muted" style={{ marginTop: 0 }}>
          Connect any repository as a tenant — the consuming repo needs no code, no workflow and no deploy. Publishing
          simply commits a Markdown handover into its <span className="mono">docs/enhancements/</span> folder.
        </p>

        {listError ? <Notice tone="error">{listError}</Notice> : null}

        {repos.length === 0 ? (
          listError ? null : (
            <p className="small dim">
              {source === "none"
                ? "Connect a token above to list your repositories."
                : "No repositories were returned for this token."}
            </p>
          )
        ) : (
          <ActionForm action={connectRepoAction} className="stack" style={{ gap: 10 }}>
            <div className="field-row">
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="gh-repo">Repository</label>
                <select id="gh-repo" name="repo" defaultValue={available[0]?.fullName ?? ""} required>
                  {available.length === 0 ? <option value="">All visible repositories are connected</option> : null}
                  {available.map((repo) => (
                    <option key={repo.fullName} value={repo.fullName}>
                      {repo.fullName}
                      {repo.private ? " (private)" : ""}
                      {repo.archived ? " (archived)" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="gh-dir">Handover folder</label>
                <input id="gh-dir" name="handover_dir" defaultValue="docs/enhancements" placeholder="docs/enhancements" />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="gh-name">App name (optional)</label>
                <input id="gh-name" name="name" placeholder="defaults to the repo name" />
              </div>
            </div>
            <div className="row tight">
              <SubmitButton className="btn-primary" pendingLabel="Connecting…" disabled={available.length === 0}>
                Connect as tenant
              </SubmitButton>
              <span className="tiny dim">Creates the tenant only; nothing is written to the repository yet.</span>
            </div>
          </ActionForm>
        )}

        {repos.length > 0 ? (
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table>
              <thead>
                <tr>
                  <th>Repository</th>
                  <th>Visibility</th>
                  <th>Last push</th>
                  <th>Tenant</th>
                </tr>
              </thead>
              <tbody>
                {repos.map((repo) => (
                  <tr key={repo.fullName}>
                    <td>
                      <a href={repo.htmlUrl} target="_blank" rel="noreferrer" className="mono small">
                        {repo.fullName}
                      </a>
                    </td>
                    <td>
                      <span className={repo.private ? "tag amber" : "tag mint"}>{repo.private ? "private" : "public"}</span>
                      {repo.archived ? <span className="tag dim">archived</span> : null}
                    </td>
                    <td className="tiny dim">{repo.pushedAt ? new Date(repo.pushedAt).toISOString().slice(0, 10) : "—"}</td>
                    <td>
                      {repo.connected ? (
                        <span className="tag mint">connected</span>
                      ) : (
                        <span className="tag dim">not connected</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}
