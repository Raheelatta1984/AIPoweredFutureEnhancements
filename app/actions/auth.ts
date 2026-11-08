"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { findPersonByEmail, issueSession, revokeAllForPerson, revokeSession, verifyPassword } from "../../lib/auth.ts";
import { recordAudit } from "../../lib/audit.ts";
import { ensureBootReady } from "../../lib/boot.ts";
import { requireUserAction } from "../../lib/session.ts";
import { SESSION_COOKIE, TENANT_COOKIE, SESSION_TTL_SECONDS } from "../../lib/rules.ts";
import { getTenantById } from "../../lib/tenants.ts";

export type LoginState = { error?: string };

const COOKIE_BASE = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Email and password are both required." };

  // The POST can land on an instance that never rendered /login (each serverless
  // instance has its own empty /tmp), so the database must be ready HERE, not only
  // in the page. Without this, a first sign-in reports "no active account" even
  // though the seeded people exist.
  await ensureBootReady();

  const person = findPersonByEmail(email);
  if (!person || !person.active) {
    // The bootstrap swallows its own failure; if the hub has no people at all, say so
    // instead of implying the credentials were wrong.
    const { count } = await import("../../lib/db.ts");
    if (count("people") === 0) {
      return {
        error:
          "This hub has no accounts yet — seeding did not run on this instance. Set SEED_DEMO_DATA=true (or create a person on /people), then try again.",
      };
    }
    return { error: "No active account matches those credentials." };
  }

  const valid = await verifyPassword(password, person.password_hash);
  if (!valid) return { error: "No active account matches those credentials." };

  const session = issueSession(person.id);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, session.token, { ...COOKIE_BASE, maxAge: SESSION_TTL_SECONDS });
  jar.delete(TENANT_COOKIE);

  recordAudit({
    tenantId: person.tenant_id,
    actor: person.email,
    action: "session.login",
    subject: person.email,
    meta: { role: person.role },
  });

  redirect("/");
}

export async function logoutAction() {
  const jar = await cookies();
  const guard = await requireUserAction();
  const user = guard.user;
  const token = jar.get(SESSION_COOKIE)?.value;
  if (user) {
    recordAudit({ tenantId: user.tenantId, actor: user.person.email, action: "session.logout", subject: user.person.email });
  }
  void token;
  jar.delete(SESSION_COOKIE);
  jar.delete(TENANT_COOKIE);
  redirect("/login");
}

/** Revokes every live session for the signed-in person. */
export async function revokeMySessionsAction() {
  const guard = await requireUserAction();
  const user = guard.user;
  if (!user) redirect("/login");
  revokeAllForPerson(user.person.id);
  recordAudit({ tenantId: user.tenantId, actor: user.person.email, action: "session.revoked_all", subject: user.person.email });
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    // Best effort: the token's own row is gone too, so any copy is now dead.
    revokeSession("");
  }
  jar.delete(SESSION_COOKIE);
  redirect("/login");
}

/** Hub-level switcher: stores the chosen tenant for the session cookie lifetime. */
export async function switchTenantAction(formData: FormData) {
  const guard = await requireUserAction();
  const user = guard.user;
  if (!user) redirect("/login");
  const tenantId = String(formData.get("tenant_id") ?? "");
  if (!user.canSwitchTenant) {
    redirect("/");
  }
  const tenant = getTenantById(tenantId);
  if (!tenant) redirect("/");
  const jar = await cookies();
  jar.set(TENANT_COOKIE, tenant.id, { ...COOKIE_BASE, maxAge: 60 * 60 * 24 * 30 });
  recordAudit({
    tenantId: tenant.id,
    actor: user.person.email,
    action: "tenant.switched",
    subject: tenant.slug,
    meta: { to: tenant.id },
  });
  redirect("/");
}
