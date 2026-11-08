import { AppShell, PageHead } from "../../components/Shell.tsx";
import { Card, Notice, StatusTag } from "../../components/ui.tsx";
import { isEphemeralDatabase } from "../../lib/db.ts";
import { listEnhancements } from "../../lib/enhancements.ts";
import { githubConfigured } from "../../lib/github.ts";
import { listHandoverMirror } from "../../lib/handovers.ts";
import { requireUser } from "../../lib/session.ts";
import { getTenantById } from "../../lib/tenants.ts";
import { isArchivedDocPath, parseFrontmatter, refFromPath } from "../../lib/rules.ts";
import { SyncButton } from "./SyncButton.tsx";

export const dynamic = "force-dynamic";

export default async function HandoversPage() {
  const user = await requireUser();
  const tenant = user.tenantId ? getTenantById(user.tenantId) : null;
  const enhancements = tenant ? listEnhancements(tenant.id) : [];
  const byRef = new Map(enhancements.map((item) => [item.ref, item]));
  const docs = tenant ? listHandoverMirror(tenant.slug) : [];
  const live = githubConfigured();

  const rows = docs.map((doc) => {
    const frontmatter = parseFrontmatter(doc.markdown);
    const refValue = frontmatter.ref;
    const ref = (Array.isArray(refValue) ? refValue[0] : refValue) || refFromPath(doc.path) || "";
    const statusValue = frontmatter.status;
    const docStatus = (Array.isArray(statusValue) ? statusValue[0] : statusValue) || (isArchivedDocPath(doc.path) ? "Archived" : "Building");
    const record = byRef.get(ref);
    let badge: { label: string; tone: string } = { label: "unmatched", tone: "rose" };
    if (record) {
      if (record.handover_path === doc.path) badge = { label: "linked", tone: "mint" };
      else if (record.status === docStatus) badge = { label: "in sync", tone: "accent" };
      else badge = { label: "drifted", tone: "amber" };
    }
    return { doc, ref, docStatus, record, badge };
  });

  const linked = enhancements.filter((item) => item.handover_path).length;
  const claimed = enhancements.filter((item) => item.status === "Building" || item.status === "Built").length;

  return (
    <AppShell user={user} active="handovers" ephemeral={isEphemeralDatabase()}>
      <PageHead
        sid="tab.handovers"
        user={user}
        title="Handovers"
        subtitle="Durable repo-side documents. Moving a proposal to Building publishes ENH-#### into the consuming repository's handover folder; a merged PR with a Handover: line moves it to archived/ and the next sync stamps it Archived here."
      >
        <SyncButton canEdit={user.canEdit} />
      </PageHead>

      {!tenant ? <Notice tone="warn">No tenant is available for this account.</Notice> : null}

      {tenant ? (
        <div className="stack">
          <div className="grid cols-3">
            <Card title="Target" sid="sec.handover-target" flat>
              <div className="stack" style={{ gap: 6 }}>
                <span className="mono small">{tenant.github_repo || "not linked"}</span>
                <span className="tiny dim mono">{tenant.handover_dir}/</span>
                <div>
                  {live ? (
                    <span className="tag mint">GITHUB_TOKEN configured</span>
                  ) : (
                    <span className="tag amber">no token — Building is refused</span>
                  )}
                </div>
              </div>
            </Card>
            <Card title="Linked records" sid="sec.handover-linked" flat>
              <div className="row" style={{ gap: 18 }}>
                <div>
                  <div className="n" style={{ fontSize: 24, fontWeight: 680 }}>
                    {linked}
                  </div>
                  <div className="tiny dim">handover_path set</div>
                </div>
                <div>
                  <div className="n" style={{ fontSize: 24, fontWeight: 680 }}>
                    {claimed}
                  </div>
                  <div className="tiny dim">Building / Built</div>
                </div>
                <div>
                  <div className="n" style={{ fontSize: 24, fontWeight: 680 }}>
                    {docs.length}
                  </div>
                  <div className="tiny dim">documents mirrored</div>
                </div>
              </div>
            </Card>
            <Card title="Reconciliation" sid="sec.handover-rules" flat>
              <ul className="tiny dim" style={{ margin: 0, paddingLeft: 16, display: "grid", gap: 3 }}>
                <li>archived doc → Archived (never overwrites Rejected)</li>
                <li>Built doc → promotes anything below Built</li>
                <li>moved file → handover_path re-pointed</li>
                <li>same ref in two tenants never cross-matches</li>
              </ul>
            </Card>
          </div>

          <Card
            title="Repository documents"
            sid="sec.handover-docs"
            actions={<span className="tiny dim mono">handovers/{tenant.slug}/</span>}
          >
            {rows.length === 0 ? (
              <div className="empty">
                No documents mirrored yet. Move a proposal to <span className="mono">Building</span> (with a token) or
                publish one, then run a sync.
              </div>
            ) : (
              <div className="scroll-x">
                <table>
                  <thead>
                    <tr>
                      <th>Ref</th>
                      <th>Document</th>
                      <th>Doc status</th>
                      <th>In-app status</th>
                      <th>Match</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.doc.path}>
                        <td className="mono nowrap">{row.ref || "—"}</td>
                        <td>
                          <div className="mono tiny" style={{ wordBreak: "break-all" }}>
                            {row.doc.path}
                          </div>
                          {row.doc.archived ? <span className="tag tiny">archived/</span> : null}
                        </td>
                        <td>
                          <StatusTag status={row.docStatus} />
                        </td>
                        <td>{row.record ? <StatusTag status={row.record.status} /> : <span className="tiny dim">no record</span>}</td>
                        <td>
                          <span className={`tag ${row.badge.tone}`}>{row.badge.label}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Notice tone="info">
            Workflow contract for the consuming repo (no code, no CI needed): a merged PR whose body contains{" "}
            <span className="mono">Handover: {tenant.handover_dir}/ENH-0001-….md</span> archives that document. A push of
            a new <span className="mono">ENH-*.md</span> opens one labelled issue (<span className="mono">arena-handover</span>)
            with a ready-to-paste Agent Mode prompt. See <span className="mono">docs/CONNECTING-AN-APP.md</span>.
          </Notice>
        </div>
      ) : null}
    </AppShell>
  );
}
