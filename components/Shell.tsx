import Link from "next/link";

import { logoutAction, switchTenantAction } from "../app/actions/auth.ts";
import { ROLE_LABELS } from "../lib/roles.ts";
import type { SessionUser, TenantView } from "../lib/types.ts";

export type NavKey = "overview" | "studio" | "vault" | "handovers" | "tenants" | "people" | "audit";

/** Every heading shows its stable ID so the consuming app's IDs map 1:1. */
export const NAV: Array<{ key: NavKey; href: string; label: string; sid: string; minRole?: "admin" | "manager" }> = [
  { key: "overview", href: "/", label: "Overview", sid: "tab.overview" },
  { key: "studio", href: "/studio", label: "Studio", sid: "tab.studio" },
  { key: "vault", href: "/vault", label: "Vault", sid: "tab.vault" },
  { key: "handovers", href: "/handovers", label: "Handovers", sid: "tab.handovers" },
  { key: "tenants", href: "/tenants", label: "Tenants", sid: "tab.tenants", minRole: "admin" },
  { key: "people", href: "/people", label: "People", sid: "tab.people", minRole: "admin" },
  { key: "audit", href: "/audit", label: "Audit", sid: "tab.audit", minRole: "manager" },
];

export function navFor(user: SessionUser) {
  return NAV.filter((item) => {
    if (item.minRole === "admin") return user.canAdmin;
    if (item.minRole === "manager") return user.canManage;
    return true;
  });
}

export function StableId({ id }: { id: string }) {
  return <span className="sid">{id}</span>;
}

function TenantBadge({ tenant }: { tenant: TenantView | null }) {
  if (!tenant) return <span className="tag rose">no tenant</span>;
  return (
    <span className="tag" style={{ borderColor: `${tenant.colour}66`, color: tenant.colour }}>
      <span className="badge-dot" style={{ background: tenant.colour }} />
      {tenant.name}
    </span>
  );
}

export function TopBar({ user, active, ephemeral }: { user: SessionUser; active: NavKey; ephemeral: boolean }) {
  const tenant = user.tenants.find((t) => t.id === user.tenantId) ?? null;
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link href="/" className="brand">
          <span className="brand-mark">FE</span>
          <span>
            Future Enhancements
            <small>multi-tenant intake hub</small>
          </span>
        </Link>
        <nav className="nav">
          {navFor(user).map((item) => (
            <Link key={item.key} href={item.href} className={active === item.key ? "active" : undefined} prefetch={false}>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="topbar-right">
          {user.canSwitchTenant && user.tenants.length > 1 ? (
            <form action={switchTenantAction} className="row tight">
              <select
                name="tenant_id"
                defaultValue={user.tenantId ?? ""}
                aria-label="Active tenant"
                style={{ width: "auto", minWidth: 190, padding: "6px 30px 6px 10px", fontSize: 12.5 }}
              >
                {user.tenants.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <button type="submit" className="btn-sm btn-ghost">
                Switch
              </button>
            </form>
          ) : (
            <TenantBadge tenant={tenant} />
          )}
          {ephemeral ? (
            <span className="tag amber" title="Serverless filesystem: the vault lives in /tmp and is not durable.">
              ephemeral /tmp
            </span>
          ) : null}
          <span className="tag violet" title={user.person.email}>
            {user.person.name} · {ROLE_LABELS[user.person.role]}
          </span>
          <form action={logoutAction}>
            <button type="submit" className="btn-sm btn-ghost">
              Log out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}

export function PageHead({
  title,
  sid,
  subtitle,
  children,
}: {
  title: string;
  sid: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="page-head">
      <div className="titles">
        <div className="row tight">
          <h1>{title}</h1>
          <StableId id={sid} />
        </div>
        {subtitle ? <p className="sub">{subtitle}</p> : null}
      </div>
      <div className="spacer" />
      {children}
    </div>
  );
}

export function AppShell({
  user,
  active,
  ephemeral,
  children,
}: {
  user: SessionUser;
  active: NavKey;
  ephemeral: boolean;
  children: React.ReactNode;
}) {
  return (
    <>
      <TopBar user={user} active={active} ephemeral={ephemeral} />
      <main className="shell">{children}</main>
    </>
  );
}
