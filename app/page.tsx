import Link from "next/link";

import { AppShell, PageHead } from "../components/Shell.tsx";
import { Card, Kpi, Notice, StatusTag } from "../components/ui.tsx";
import { isEphemeralDatabase } from "../lib/db.ts";
import { listEnhancements, stageCounts } from "../lib/enhancements.ts";
import { githubConfigured } from "../lib/github.ts";
import { requireUser } from "../lib/session.ts";
import { getTenantById } from "../lib/tenants.ts";
import { relativeTime } from "../lib/rules.ts";
import { Pipeline } from "./overview/Pipeline.tsx";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const user = await requireUser();
  const tenant = user.tenantId ? getTenantById(user.tenantId) : null;
  const enhancements = tenant ? listEnhancements(tenant.id) : [];
  const counts = stageCounts(enhancements);
  const votes = enhancements.reduce((sum, e) => sum + e.votes, 0);
  const newest = enhancements.slice(0, 5);
  const live = githubConfigured();

  return (
    <AppShell user={user} active="overview" ephemeral={isEphemeralDatabase()}>
      <PageHead
        sid="tab.overview"
        user={user}
        title="Overview"
        subtitle={
          tenant
            ? tenant.description
            : "Your account is not linked to a tenant yet. Ask a hub admin to assign one."
        }
      >
        <Link href="/studio" className="btn btn-primary" prefetch={false}>
          ✦ Draft a proposal
        </Link>
      </PageHead>

      {!tenant ? (
        <Notice tone="warn">No tenant is available for this account.</Notice>
      ) : (
        <div className="stack">
          <div className="grid cols-4">
            <Kpi n={counts.Submitted + counts.Reviewing + counts.Accepted} label="In review" tone="#b9cdff" />
            <Kpi n={counts.Building} label="Building" tone="#93ecd0" />
            <Kpi n={counts.Built} label="Built" tone="#4fd1a5" />
            <Kpi n={votes} label="Demand votes" />
          </div>

          <Card
            title="Pipeline"
            sid="sec.pipeline"
            actions={
              <Link href="/vault" className="btn-sm btn-ghost" prefetch={false}>
                Open the vault →
              </Link>
            }
          >
            <Pipeline counts={counts} total={enhancements.length} />
          </Card>

          <div className="grid cols-2">
            <Card
              title="Newest proposals"
              sid="sec.newest"
              actions={
                <Link href="/vault" className="btn-sm btn-ghost" prefetch={false}>
                  All {enhancements.length}
                </Link>
              }
            >
              {newest.length === 0 ? (
                <div className="empty">Nothing captured yet — the studio is the fastest way to start.</div>
              ) : (
                <div className="stack" style={{ gap: 10 }}>
                  {newest.map((item) => (
                    <div key={item.id} className="proposal" style={{ padding: 12 }}>
                      <div className="head">
                        <div style={{ flex: 1 }}>
                          <div className="row tight">
                            <span className="mono tiny dim">{item.ref}</span>
                            <StatusTag status={item.status} />
                          </div>
                          <div className="title" style={{ fontSize: 14, marginTop: 4 }}>
                            {item.title}
                          </div>
                        </div>
                        <span className="tiny dim nowrap">{relativeTime(item.created_at)}</span>
                      </div>
                      <div className="tiny dim">
                        {item.area || "unassigned area"} · {item.votes} vote{item.votes === 1 ? "" : "s"} ·{" "}
                        {item.submitted_by}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <div className="stack">
              <Card title="Publishing target" sid="sec.publishing">
                <div className="stack" style={{ gap: 10 }}>
                  <div className="row tight">
                    <span className="tiny dim">Repository</span>
                    <span className="mono small">{tenant.github_repo || "not linked"}</span>
                  </div>
                  <div className="row tight">
                    <span className="tiny dim">Handover folder</span>
                    <span className="mono small">{tenant.handover_dir}</span>
                  </div>
                  <div className="row tight">
                    <span className="tiny dim">GitHub token</span>
                    {live ? (
                      <span className="tag mint">configured — publishing is live</span>
                    ) : (
                      <span className="tag amber">not configured — moves to Building are refused</span>
                    )}
                  </div>
                  <div className="row tight">
                    <span className="tiny dim">Keywords</span>
                    <span className="small">{Object.keys(tenant.keywordMap).length} mapped</span>
                  </div>
                  <div className="row tight">
                    <span className="tiny dim">Areas</span>
                    <span className="small">{tenant.areas.join(" · ") || "—"}</span>
                  </div>
                  {!live ? (
                    <div className="notice warn">
                      <span className="icon">!</span>
                      <div className="tiny">
                        Set <span className="mono">GITHUB_TOKEN</span> to publish handovers into{" "}
                        <span className="mono">{tenant.github_repo}</span>. Without it the hub refuses the Building
                        transition instead of pretending the document exists.
                      </div>
                    </div>
                  ) : null}
                </div>
              </Card>

              <Card title="How it flows" sid="sec.flow" flat>
                <ol className="small muted" style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 4 }}>
                  <li>Describe the change in the Studio — nine fields get 2–3 drafts each.</li>
                  <li>Accept or re-roll per field; typed text is author-owned.</li>
                  <li>Submit → <span className="mono">ENH-####</span> is allocated and the vault file is written.</li>
                  <li>Review → Accepted → Building publishes the handover into the repo.</li>
                  <li>Merging a PR with a <span className="mono">Handover:</span> line archives the doc.</li>
                </ol>
              </Card>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
