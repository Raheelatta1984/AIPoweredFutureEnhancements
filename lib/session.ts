/**
 * Request-scoped helpers shared by server components and server actions.
 * Reads cookies and resolves the signed token into a scoped SessionUser.
 */
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { resolveSession } from "./auth.ts";
import { ensureBootReady } from "./boot.ts";
import { SESSION_COOKIE, TENANT_COOKIE } from "./rules.ts";
import type { SessionUser } from "./types.ts";

export async function currentUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  const tenantCookie = jar.get(TENANT_COOKIE)?.value ?? null;
  if (!token) return null;
  return resolveSession(token, tenantCookie);
}

/** Guard for pages: redirects to /login when there is no valid session. */
export async function requireUser(): Promise<SessionUser> {
  // First request on a fresh database (serverless /tmp) must not race the seed.
  await ensureBootReady();
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

/** Guard for admin-only pages: hard 404 for everyone else. */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (!user.canAdmin) notFound();
  return user;
}

/** Guard for manager+ pages (audit trail). */
export async function requireManager(): Promise<SessionUser> {
  const user = await requireUser();
  if (!user.canManage) notFound();
  return user;
}
