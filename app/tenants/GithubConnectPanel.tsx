import {
  cancelGithubReposAction,
  connectAllVisibleReposAction,
  connectReposAction,
  connectSelectedReposAction,
  loadGithubReposAction,
  saveGithubTokenAction,
  testGithubConnectionAction,
} from "../actions/admin.ts";
import type { GithubRepo, RepoListResult } from "../../lib/github.ts";
import { diagnoseRepoListing, type DiscoveryReport } from "../../lib/repo-discovery.ts";
import { Notice } from "../../components/ui.tsx";
import { ActionForm, SubmitButton } from "./ActionForm.tsx";

/**
 * Two panels that turn "paste an env var and redeploy" into something an operator can
 * do in the browser:
 *   1. the GitHub token (encrypted at rest, verified against the API on save)
 *   2. a picker over every repository the token can see, connecting one as a tenant
 *
 * The project list doubles as the answer to "why can I only see one of my repositories?".
 * `/user/repos` cannot show what a scoped token is blind to, so the panel compares the
 * listed count with the public count on the account (`diagnoseRepoListing`) instead of
 * presenting a short list as if it were complete.
 */
export function GithubConnectPanel({
  tokenState,
  tokenHint,
  listed,
  repos,
  listError,
  source,
  ephemeral,
  sourceDetail,
  loaded,
}: {
  tokenState: "env" | "stored" | "none";
  tokenHint: string | null;
  /** The full listing result, so the panel can explain a short list. */
  listed: RepoListResult;
  repos: GithubRepo[];
  listError?: string;
  source: "env" | "stored" | "none";
  ephemeral: boolean;
  /** Specific reason when no usable token exists (empty env var, rotated secret, …). */
  sourceDetail?: string;
  /** False until the admin asks for the list — loading it is two GitHub calls and a wait. */
  loaded: boolean;
}) {
  const connected = repos.filter((repo) => repo.connected);
  const available = repos.filter((repo) => !repo.connected);
  const report: DiscoveryReport = diagnoseRepoListing(
    { ...listed, repos, error: listError ?? listed.error, source },
    sourceDetail,
  );

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

        <ActionForm action={testGithubConnectionAction} className="row tight" style={{ marginBottom: 10 }}>
          <SubmitButton className="btn-sm" pendingLabel="Checking GitHub…">
            Test connection
          </SubmitButton>
          <span className="tiny dim">
            Asks GitHub who this token belongs to, how many repositories it lists, and how many the account actually
            has.
          </span>
        </ActionForm>

        {tokenState === "none" && sourceDetail ? (
          <div className="notice warn" role="alert">
            <span className="icon">!</span>
            <div>{sourceDetail}</div>
          </div>
        ) : null}

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
            {ephemeral ? (
              <div className="notice warn" role="alert">
                <span className="icon">!</span>
                <div>
                  This hub runs on a serverless filesystem, so a token saved here lives in <span className="mono">/tmp</span>{" "}
                  and is lost on the next cold start — you will have to paste it again. For a connection that survives,
                  set <span className="mono">GITHUB_TOKEN</span> in your hosting settings instead (and make sure it is
                  not an empty value, which overrides this form).
                </div>
              </div>
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
          {loaded ? (
            <span className="tag violet">
              {repos.length} visible · {connected.length} connected
            </span>
          ) : (
            <span className="tag dim">not loaded yet</span>
          )}
        </div>
        <p className="small muted" style={{ marginTop: 0 }}>
          Every repository the hub&apos;s token can see, with what GitHub disclosed about it. Connecting one creates a
          tenant row — the consuming repo needs no code, no workflow and no deploy, and publishing simply commits a
          Markdown handover into its <span className="mono">docs/enhancements/</span> folder.
        </p>
        <Notice tone="info">
          The <strong>tenant switcher</strong> in the top bar lists connected tenants only — it is not a repository
          picker. A repository appears there after you connect it here, and disappears from it only when you remove
          the tenant.
        </Notice>

        {!loaded ? (
          <div className="stack" style={{ gap: 10 }}>
            <div className="row tight">
              <ActionForm action={loadGithubReposAction} className="row tight">
                <SubmitButton className="btn-primary" pendingLabel="Asking GitHub…">
                  Load my projects
                </SubmitButton>
              </ActionForm>
              <span className="tiny dim">Two GitHub calls. Nothing is changed by loading.</span>
            </div>
          </div>
        ) : (
          <div className="stack" style={{ gap: 12 }}>
            <div className={`notice ${report.tone === "ok" ? "ok" : report.tone}`} role={report.tone === "ok" ? "status" : "alert"}>
              <span className="icon">{report.tone === "ok" ? "✓" : "!"}</span>
              <div>
                <strong>{report.headline}</strong>{" "}
                <span className="small">{report.detail}</span>
                {report.facts.length > 0 ? (
                  <div className="row tight" style={{ marginTop: 8 }}>
                    {report.facts.map((fact) => (
                      <span key={fact.label} className="tag" title={fact.label}>
                        {fact.label}: <span className="mono">{fact.value}</span>
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            {listError ? <Notice tone="error">{listError}</Notice> : null}

            {repos.length === 0 ? (
              <div className="row tight">
                <ActionForm action={loadGithubReposAction} className="row tight">
                  <SubmitButton className="btn-sm" pendingLabel="Asking GitHub…">
                    Try again
                  </SubmitButton>
                </ActionForm>
                <ActionForm action={cancelGithubReposAction} className="row tight">
                  <SubmitButton className="btn-sm btn-ghost" pendingLabel="Hiding…">
                    Hide the project list
                  </SubmitButton>
                </ActionForm>
              </div>
            ) : (
              <>
                <ActionForm action={connectSelectedReposAction} className="stack" style={{ gap: 10 }}>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label>Repositories to connect</label>
                    <div className="grid cols-2" style={{ gap: 6 }}>
                      {repos.map((repo) => (
                        <label key={repo.fullName} className="row tight small" style={{ cursor: "pointer", gap: 8 }}>
                          <input
                            type="checkbox"
                            name="repo"
                            value={repo.fullName}
                            defaultChecked={false}
                            disabled={repo.connected}
                            style={{ width: "auto", minWidth: 0 }}
                          />
                          <span className={repo.connected ? "mono tiny dim" : "mono tiny"}>{repo.fullName}</span>
                          {repo.connected ? <span className="tag mint">connected</span> : null}
                        </label>
                      ))}
                    </div>
                    <p className="tiny dim" style={{ margin: "6px 0 0" }}>
                      Tick as many as you like. Each name is checked against your token before anything is created — a
                      repository the token cannot see is refused, never half-connected.
                    </p>
                  </div>
                  <div className="row tight">
                    <div className="field" style={{ marginBottom: 0, maxWidth: 260 }}>
                      <label htmlFor="gh-dir">Handover folder</label>
                      <input id="gh-dir" name="handover_dir" defaultValue="docs/enhancements" placeholder="docs/enhancements" />
                    </div>
                    <SubmitButton className="btn-primary" pendingLabel="Connecting…" disabled={available.length === 0}>
                      Connect selected
                    </SubmitButton>
                    <span className="tiny dim">Creates tenant rows only; nothing is written to the repositories yet.</span>
                  </div>
                </ActionForm>

                <ActionForm action={connectAllVisibleReposAction} className="stack" style={{ gap: 8 }}>
                  <div className="row tight">
                    <SubmitButton className="btn-sm" pendingLabel="Connecting everything…" disabled={available.length === 0}>
                      Connect all {available.length} visible project{available.length === 1 ? "" : "s"}
                    </SubmitButton>
                    <label className="row tight tiny" style={{ cursor: "pointer", gap: 6 }}>
                      <input type="checkbox" name="confirm" value="1" style={{ width: "auto", minWidth: 0 }} />
                      I understand this creates one tenant per repository
                    </label>
                  </div>
                  <span className="tiny dim">
                    Best way to see your whole GitHub account in the switcher at once. Already-connected repositories are
                    skipped; nothing is written to any repository until you publish a handover.
                  </span>
                </ActionForm>

                {repos.length > 1 ? (
                  <details className="bulk-connect">
                    <summary className="small" style={{ cursor: "pointer" }}>
                      Connect several projects at once ({available.length} not connected)
                    </summary>
                    <ActionForm action={connectReposAction} className="stack" style={{ gap: 10, marginTop: 10 }}>
                      <div className="field" style={{ marginBottom: 0 }}>
                        <label htmlFor="gh-bulk">
                          Repositories — one per line (<span className="mono">owner/name</span>)
                        </label>
                        <textarea
                          id="gh-bulk"
                          name="repos"
                          rows={5}
                          placeholder={repos
                            .slice(0, 3)
                            .map((repo) => repo.fullName)
                            .join("\n")}
                        />
                        <p className="tiny dim" style={{ margin: "4px 0 0" }}>
                          Full GitHub URLs are accepted too. Each name is checked against your token before anything is
                          created.
                        </p>
                      </div>
                      <div className="row tight">
                        <div className="field" style={{ marginBottom: 0, maxWidth: 260 }}>
                          <label htmlFor="gh-bulk-dir">Handover folder</label>
                          <input id="gh-bulk-dir" name="handover_dir" defaultValue="docs/enhancements" />
                        </div>
                        <SubmitButton className="btn-primary" pendingLabel="Connecting…">
                          Connect listed projects
                        </SubmitButton>
                      </div>
                    </ActionForm>
                  </details>
                ) : null}

                <div className="grid cols-3" style={{ gap: 10 }}>
                  {repos.map((repo) => (
                    <div key={repo.fullName} className="card flat" style={{ padding: 12 }}>
                      <div className="row tight" style={{ marginBottom: 4 }}>
                        <a href={repo.htmlUrl} target="_blank" rel="noreferrer" className="strong small">
                          {repo.name}
                        </a>
                        {repo.private ? <span className="tag amber">private</span> : <span className="tag mint">public</span>}
                        {repo.archived ? <span className="tag dim">archived</span> : null}
                      </div>
                      <div className="tiny dim mono" style={{ wordBreak: "break-all" }}>
                        {repo.fullName}
                      </div>
                      {repo.description ? (
                        <div className="tiny muted" style={{ marginTop: 4 }}>
                          {repo.description}
                        </div>
                      ) : null}
                      <div className="row tight" style={{ marginTop: 8 }}>
                        <span className="tiny dim">
                          pushed {repo.pushedAt ? new Date(repo.pushedAt).toISOString().slice(0, 10) : "—"}
                        </span>
                        {repo.connected ? (
                          <span className="tag mint">connected</span>
                        ) : (
                          <span className="tag dim">not connected</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="row tight">
                  <span className="tag" title="GitHub's own count for this credential, if it reported one">
                    GitHub reports {listed.totalVisible ?? repos.length} for this token
                  </span>
                  <ActionForm action={loadGithubReposAction} className="row tight">
                    <SubmitButton className="btn-sm btn-ghost" pendingLabel="Refreshing…">
                      Refresh
                    </SubmitButton>
                  </ActionForm>
                  <ActionForm action={cancelGithubReposAction} className="row tight">
                    <SubmitButton className="btn-sm btn-ghost" pendingLabel="Hiding…">
                      Hide
                    </SubmitButton>
                  </ActionForm>
                </div>
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
