import Link from "next/link";

import { logoutAction, switchTenantAction } from "../app/actions/auth.ts";
import { ROLE_LABELS } from "../lib/roles.ts";
import { runtimeWarnings } from "../lib/runtime-warnings.ts";
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

/**
 * Where a tenant switch made on this tab should send the operator back to.
 *
 * Switching tenant used to always redirect to `/`, so pressing "switch to …" in the
 * studio or the vault threw away the page you were reading. Derived from the stable ID
 * the page already passes to `PageHead`, so no page has to remember to pass it.
 */
export function pathForSid(sid: string): string {
  return NAV.find((item) => item.sid === sid)?.href ?? "/";
}

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
  // Present whether or not the caller passed `ephemeral`, so a deploy can never hide them.
  const warnings = runtimeWarnings();
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
              <input type="hidden" name="next" value={NAV.find((item) => item.key === active)?.href ?? "/"} />
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
          {warnings.map((warning) => (
            <span key={warning.label} className="tag amber" title={warning.detail}>
              {warning.label}
            </span>
          ))}
          {ephemeral && !warnings.some((w) => w.label === "ephemeral /tmp") ? (
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

/**
 * "Which tenant am I looking at?" — answered the same way on every tab.
 *
 * For hub-level accounts it also lists the other tenants as links, because a switcher you
 * have to find first reads as a missing tenant list.
 */
export function TenantContext({ user, next }: { user: SessionUser; next?: string }) {
  const active = user.tenants.find((t) => t.id === user.tenantId) ?? null;
  const others = user.tenants.filter((t) => t.id !== user.tenantId);
  const back = next ?? "/";
  if (!active) {
    return (
      <div className="tenant-context" data-tenant-context="none">
        <span className="sid">sec.tenant-context</span>
        <span className="tag rose">no tenant selected</span>
        <span className="tiny dim">
          {user.canAdmin ? "Pick one with the switcher in the top bar." : "Ask a hub admin to link your account to a tenant."}
        </span>
      </div>
    );
  }
  return (
    <div className="tenant-context" data-tenant-context={active.slug}>
      <span className="sid">sec.tenant-context</span>
      <span className="tag" style={{ borderColor: `${active.colour}66`, color: active.colour }} title={active.github_repo || "no repository linked"}>
        <span className="badge-dot" style={{ background: active.colour }} />
        {active.name}
      </span>
      {user.tenants.length > 1 ? (
        <span className="row tight" style={{ gap: 6 }}>
          <span className="tiny dim">switch to</span>
          {others.map((tenant) => (
            <form key={tenant.id} action={switchTenantAction}>
              <input type="hidden" name="tenant_id" value={tenant.id} />
              <input type="hidden" name="next" value={back} />
              <button type="submit" className="tenant-chip" title={`Open ${tenant.name} and stay on this tab`}>
                {tenant.name}
              </button>
            </form>
          ))}
        </span>
      ) : (
        <span className="tiny dim">{user.canSwitchTenant ? "only tenant" : "your tenant"}</span>
      )}
    </div>
  );
}

/**
 * "The tenant you picked could not be restored" — said out loud, where the tenant is named.
 *
 * A remembered selection points at a tenant id in a per-instance database. When that
 * database is rebuilt the id is gone, and the hub used to fall back to the first tenant in
 * silence, which reads as the project vanishing on every tab. This states what happened,
 * keeps the reason recoverable (re-seed / re-connect), and offers the one-click way out.
 */
export function TenantNotice({ user, next }: { user: SessionUser; next?: string }) {
  if (!user.tenantNotice) return null;
  const back = next ?? "/tenants";
  return (
    <div className="tenant-context" data-tenant-notice="rebuilt">
      <span className="sid">sec.tenant-context-notice</span>
      <span className="tag amber">remembered tenant unavailable</span>
      <span className="tiny dim">
        {user.tenantNoticeSlug ? (
          <>
            This instance no longer has <span className="mono">{user.tenantNoticeSlug}</span> — a cold start rebuilt the
            database, and tenants created in the browser live on that instance only.{" "}
          </>
        ) : (
          <>This instance no longer has the tenant you were working in — a cold start rebuilt its database. </>
        )}
        Re-add or re-connect it on{" "}
        <Link href="/tenants" prefetch={false}>
          Tenants
        </Link>
        ; the tenant you are seeing now is the first one this account can open.
      </span>
      {user.tenants.length > 1
        ? user.tenants
            .filter((tenant) => tenant.id !== user.tenantId)
            .map((tenant) => (
              <form key={tenant.id} action={switchTenantAction}>
                <input type="hidden" name="tenant_id" value={tenant.id} />
                <input type="hidden" name="next" value={back} />
                <button type="submit" className="tenant-chip">
                  Open {tenant.name}
                </button>
              </form>
            ))
        : null}
    </div>
  );
}

export function PageHead({
  title,
  sid,
  subtitle,
  user,
  children,
}: {
  title: string;
  sid: string;
  subtitle?: string;
  /**
   * When given, the page names the tenant it is scoped to, right under the title.
   *
   * The context used to live only in the top bar, so on a phone (where the bar wraps or
   * scrolls away) a tab looked like it had lost the tenant — the overview shows one because
   * its *title* is the tenant name. Naming it on every tab removes the guesswork, and the
   * switcher stays available where the eye already is.
   */
  user?: SessionUser;
  children?: React.ReactNode;
}) {
  return (
    <div className="page-head">
      <div className="titles">
        <div className="row tight">
          <h1>{title}</h1>
          <StableId id={sid} />
        </div>
        {user ? <TenantContext user={user} next={pathForSid(sid)} /> : null}
        {user ? <TenantNotice user={user} next={pathForSid(sid)} /> : null}
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
