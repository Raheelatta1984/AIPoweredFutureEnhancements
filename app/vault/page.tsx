import { AppShell, PageHead } from "../../components/Shell.tsx";
import { Card, Notice, StageChips } from "../../components/ui.tsx";
import { isEphemeralDatabase } from "../../lib/db.ts";
import { listEnhancements, stageCounts } from "../../lib/enhancements.ts";
import { requireUser } from "../../lib/session.ts";
import { getTenantById } from "../../lib/tenants.ts";
import { STATUSES } from "../../lib/rules.ts";
import { EnhancementCard } from "./EnhancementCard.tsx";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ stage?: string; highlight?: string; created?: string; q?: string }>;

export default async function VaultPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const params = await searchParams;
  const tenant = user.tenantId ? getTenantById(user.tenantId) : null;
  const all = tenant ? listEnhancements(tenant.id) : [];
  const counts = stageCounts(all);

  const stage = params.stage && STATUSES.includes(params.stage as never) ? params.stage : "all";
  const query = (params.q ?? "").trim().toLowerCase();
  const filtered = all.filter((item) => {
    if (stage !== "all" && item.status !== stage) return false;
    if (!query) return true;
    return `${item.ref} ${item.title} ${item.brief} ${item.area}`.toLowerCase().includes(query);
  });

  return (
    <AppShell user={user} active="vault" ephemeral={isEphemeralDatabase()}>
      <PageHead
        sid="tab.vault"
        user={user}
        title="Vault"
        subtitle="Every proposal is mirrored to Markdown on disk — vault/<tenant>/ENH-XXXX-title.md, with archived records moved into archive/. Git is the durable record; the database is the working cache."
      >
        <form className="row tight" action="/vault">
          <input
            type="search"
            name="q"
            defaultValue={params.q ?? ""}
            placeholder="Search ref, title, area…"
            style={{ width: 230 }}
          />
          {stage !== "all" ? <input type="hidden" name="stage" value={stage} /> : null}
          <button type="submit" className="btn-sm">
            Search
          </button>
        </form>
      </PageHead>

      {params.created ? (
        <div style={{ marginBottom: 14 }}>
          <Notice tone="ok">
            Submitted as <span className="mono">{params.created}</span> — the vault file is already on disk.
          </Notice>
        </div>
      ) : null}
      {!tenant ? <Notice tone="warn">No tenant is available for this account.</Notice> : null}

      {tenant ? (
        <div className="stack">
          <Card title="Pipeline board" sid="sec.vault-board" flat>
            <StageChips counts={counts} current={stage} basePath="/vault" />
            <div className="row" style={{ marginTop: 10 }}>
              <span className="tiny dim">
                {filtered.length} of {all.length} proposal(s)
                {query ? ` matching “${params.q}”` : ""}
              </span>
              <span className="spacer" />
              <span className="tiny dim mono">
                vault/{tenant.slug}/ · archive/
              </span>
            </div>
          </Card>

          {filtered.length === 0 ? (
            <div className="empty">No proposals in this view yet. The Studio is the fastest way to add one.</div>
          ) : (
            <div className="grid cols-2">
              {filtered.map((item) => (
                <EnhancementCard
                  key={item.id}
                  item={item}
                  canEdit={user.canEdit}
                  highlight={params.highlight === item.id}
                  tenantSlug={tenant.slug}
                />
              ))}
            </div>
          )}
        </div>
      ) : null}
    </AppShell>
  );
}
