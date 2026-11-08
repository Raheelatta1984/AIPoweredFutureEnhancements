/**
 * Request-scoped helpers shared by server components and server actions.
 * Reads cookies and resolves the signed token into a scoped SessionUser.
 */
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { resolveSession, resolveSessionDetailed } from "./auth.ts";
import { describeSessionFailure, type SessionFailure } from "./rules.ts";
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

/**
 * Why "you are not an admin" is the wrong answer to a session problem — and what to do.
 *
 * A serverless hub keeps its database in `/tmp`, per instance. A cookie issued by the
 * instance that rendered the page can arrive at an instance that booted separately, so the
 * person (or the session row) is simply not there; signing out and in again on a shared
 * instance fixes it. That is a completely different failure from a viewer pressing an admin
 * button, and the operator needs to be told which one happened.
 */
export type AdminDenial = { error: string; kind: "signed-out" | "not-admin" };

/**
 * Guard for signed-in (editor) server actions.
 *
 * Same reasoning as `requireAdminAction`: "Sign in first" is wrong when the truth is
 * "your cookie is from another instance's database". Returns the user or an explanation.
 */
export async function requireUserAction(): Promise<{ user: SessionUser; error?: undefined } | { user?: undefined; error: string }> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  const tenantCookie = jar.get(TENANT_COOKIE)?.value ?? null;
  await ensureBootReady();
  const { user, failure } = resolveSessionDetailed(token, tenantCookie);
  if (!user) return { error: describeSessionFailure(failure) };
  return { user };
}

/**
 * Guard for admin server actions.
 *
 * Returns the user when they may administer, otherwise an error that says *why*, so a
 * stale cookie reads as "sign in again" and a viewer reads as "not an admin" — never the
 * other way round. Actions must use this instead of `if (!user?.canAdmin)`.
 */
export async function requireAdminAction(): Promise<{ user: SessionUser; error?: undefined } | { user?: undefined; error: string }> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  const tenantCookie = jar.get(TENANT_COOKIE)?.value ?? null;
  // Read the database under the same bootstrap guarantee the page render had.
  await ensureBootReady();
  const { user, failure } = resolveSessionDetailed(token, tenantCookie);
  if (!user) return { error: describeSessionFailure(failure) };
  if (!user.canAdmin) {
    return {
      error: `You are signed in as ${user.person.email} (${user.person.role}), which cannot administer the hub. Sign in as a hub admin — on the demo hub that is amara.okafor@hub.demo.`,
    };
  }
  return { user };
}
