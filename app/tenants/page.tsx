import { cookies } from "next/headers";

import { AppShell, PageHead } from "../../components/Shell.tsx";
import { Card, Notice } from "../../components/ui.tsx";
import { isEphemeralDatabase } from "../../lib/db.ts";
import { requireAdmin } from "../../lib/session.ts";
import { catalogueFor, listTenants } from "../../lib/tenants.ts";
import type { RepoListResult } from "../../lib/github.ts";
import { githubConfigured, listRepos } from "../../lib/github.ts";
import { tokenSource } from "../../lib/github-credentials.ts";
import { REPOS_COOKIE } from "../../lib/rules.ts";
import { GithubConnectPanel } from "./GithubConnectPanel.tsx";
import { TenantForm } from "./TenantForm.tsx";

export const dynamic = "force-dynamic";

export default async function TenantsPage() {
  const user = await requireAdmin();
  const tenants = listTenants();
  const live = githubConfigured();

  // Discovery is best-effort: without a token (or with a bad one) the panel still
  // renders and explains itself rather than 500-ing the admin page.
  const source = tokenSource();
  const connectedRepos = new Set(tenants.map((t) => t.github_repo.toLowerCase()).filter(Boolean));

  // Discovery runs on request, not on every page view: it is two GitHub round-trips and a
  // slow API used to block the whole admin screen. The cookie records the intent; the list
  // is still fetched fresh here, never cached.
  const loaded = (await cookies()).get(REPOS_COOKIE)?.value === "1";
  const listed: RepoListResult =
    live && loaded
      ? await listRepos(connectedRepos)
      : {
          ok: false,
          repos: [],
          source: source.ok ? (source.kind === "env" ? "env" : "stored") : "none",
        };

  return (
    <AppShell user={user} active="tenants" ephemeral={isEphemeralDatabase()}>
      <PageHead
        sid="tab.tenants"
        title="Tenants"
        subtitle="A tenant is a connected application, stored as data only. Adding one here is the whole integration on the hub side — the consuming repository needs no code, no CI and no deploy."
      >
        {live ? (
          <span className="tag mint">publishing enabled</span>
        ) : (
          <span className="tag amber">no token — publishing disabled</span>
        )}
      </PageHead>

      <div className="stack">
        <GithubConnectPanel
          tokenState={source.ok ? (source.kind === "env" ? "env" : "stored") : "none"}
          tokenHint={source.ok && "hint" in source ? source.hint : null}
          listed={listed}
          repos={listed.repos}
          listError={listed.error}
          source={listed.source}
          ephemeral={isEphemeralDatabase()}
          sourceDetail={source.ok ? undefined : source.detail}
          loaded={loaded && live}
        />

        <div className="row tight" style={{ marginTop: 4 }}>
          <h2 style={{ fontSize: 16 }}>Connected tenants</h2>
          <span className="sid">sec.tenants-list</span>
          <span className="tag">{tenants.length}</span>
          <span className="tiny dim">apps this hub already serves — each one came from a repository above</span>
        </div>

        <div className="grid cols-2">
          {tenants.map((tenant) => {
            const catalogue = catalogueFor(tenant.id);
            return (
              <Card key={tenant.id} title={tenant.name} sid={`tenant.${tenant.slug}`}>
                <div className="stack" style={{ gap: 8 }}>
                  <div className="row tight">
                    <span className="badge-dot" style={{ background: tenant.colour }} />
                    <span className="mono tiny dim">{tenant.slug}</span>
                    {tenant.enabled ? <span className="tag mint">enabled</span> : <span className="tag rose">disabled</span>}
                  </div>
                  <p className="small muted">{tenant.description || "—"}</p>
                  <div className="row tight">
                    <span className="tiny dim">repo</span>
                    <span className="mono small">{tenant.github_repo || "not linked"}</span>
                  </div>
                  <div className="row tight">
                    <span className="tiny dim">handover dir</span>
                    <span className="mono small">{tenant.handover_dir}</span>
                  </div>
                  <div className="row tight">
                    {tenant.areas.map((area) => (
                      <span key={area} className="tag">
                        {area}
                      </span>
                    ))}
                  </div>
                  <div className="tiny dim">
                    {catalogue.length} catalogue IDs · {Object.keys(tenant.keywordMap).length} keyword mappings
                  </div>
                  <details>
                    <summary className="tiny dim" style={{ cursor: "pointer" }}>
                      Edit tenant data
                    </summary>
                    <div style={{ marginTop: 10 }}>
                      <TenantForm tenant={tenant} catalogue={catalogue} />
                    </div>
                  </details>
                </div>
              </Card>
            );
          })}
        </div>

        <Card title="Add a tenant manually" sid="sec.tenants-new">
          <p className="tiny dim" style={{ marginBottom: 12 }}>
            Paste the app&apos;s stable-ID catalogue (one <span className="mono">id | label | hint</span> per line, IDs
            like <span className="mono">tab.audits</span> or <span className="mono">sec.audit-log</span>) and a keyword
            map of <span className="mono">{`{ "word": "Area" }`}</span>. The drafting engine is grounded in exactly this
            data.
          </p>
          <TenantForm />
        </Card>

        <Notice tone="info">
          Same convention everywhere: handover documents land in{" "}
          <span className="mono">&lt;repo&gt;/&lt;handover_dir&gt;/ENH-####-slug.md</span>, archive under{" "}
          <span className="mono">archived/</span>. The full ten-minute walkthrough is in{" "}
          <span className="mono">docs/CONNECTING-AN-APP.md</span>.
        </Notice>
      </div>
    </AppShell>
  );
}
