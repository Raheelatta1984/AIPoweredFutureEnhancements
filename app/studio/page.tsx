import { AppShell, PageHead } from "../../components/Shell.tsx";
import { Notice } from "../../components/ui.tsx";
import { isEphemeralDatabase } from "../../lib/db.ts";
import { requireUser } from "../../lib/session.ts";
import { catalogueFor, getTenantById, toDraftTenantInput } from "../../lib/studio-tenant.ts";
import { Studio } from "./Studio.tsx";

export const dynamic = "force-dynamic";

export default async function StudioPage() {
  const user = await requireUser();
  const tenant = user.tenantId ? getTenantById(user.tenantId) : null;
  const catalogue = tenant ? catalogueFor(tenant.id) : [];
  const draftTenant = tenant ? toDraftTenantInput(tenant, catalogue) : null;

  return (
    <AppShell user={user} active="studio" ephemeral={isEphemeralDatabase()}>
      <PageHead
        sid="tab.studio"
        user={user}
        title="Studio"
        subtitle="Describe the change in your own words. The local drafting engine proposes 2–3 options for each field — grounded only in this tenant's areas, keyword map and stable-ID catalogue. Nothing leaves this server."
      />
      {!tenant || !draftTenant ? (
        <Notice tone="warn">No tenant is available for this account, so drafting is disabled.</Notice>
      ) : !user.canEdit ? (
        <Notice tone="warn">
          Your role is read-only. You can explore the drafting engine, but submitting is disabled.
        </Notice>
      ) : null}
      {tenant && draftTenant ? (
        <Studio
          tenantName={tenant.name}
          tenantSlug={tenant.slug}
          draftTenant={draftTenant}
          catalogue={catalogue.map((entry) => ({ id: entry.id, label: entry.label, kind: entry.kind, hint: entry.hint }))}
          canSubmit={user.canEdit}
        />
      ) : null}
    </AppShell>
  );
}
