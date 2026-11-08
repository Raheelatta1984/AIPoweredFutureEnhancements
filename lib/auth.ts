/**
 * Password hashing (scrypt, no dependencies) and session lifecycle.
 * The session cookie is a self-contained HMAC token so it survives a cold start;
 * the sessions row exists purely so an admin can revoke a token early.
 */
import { randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

import { all, get, run } from "./db.ts";
import { canAdminRole, canEditRole, canManageRole, canSwitchTenantRole, isRole, type Role } from "./roles.ts";
import {
  SESSION_TTL_SECONDS,
  signSession,
  verifySession,
  type SessionPayload,
} from "./rules.ts";
import { getTenantById, visibleTenants } from "./tenants.ts";
import type { Person, PublicPerson, SessionUser } from "./types.ts";

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEYLEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, KEYLEN);
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = (stored ?? "").split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, salt, expectedHex] = parts;
  try {
    const derived = await scrypt(password, salt, KEYLEN);
    const expected = Buffer.from(expectedHex, "hex");
    if (expected.length !== derived.length) return false;
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export function stripPerson(person: Person): PublicPerson {
  const { password_hash: _ignored, ...rest } = person;
  return rest;
}

export function findPersonByEmail(email: string): Person | null {
  return get<Person>("SELECT * FROM people WHERE LOWER(email) = LOWER(?)", [email.trim()]);
}

export function findPersonById(id: string): Person | null {
  return get<Person>("SELECT * FROM people WHERE id = ?", [id]);
}

export function listPeople(): Person[] {
  return all<Person>("SELECT * FROM people ORDER BY name ASC");
}

export function listPeopleForTenant(tenantId: string): Person[] {
  return all<Person>("SELECT * FROM people WHERE tenant_id = ? ORDER BY name ASC", [tenantId]);
}

/* -------------------------------------------------------------------- sessions */

export type IssuedSession = { token: string; payload: SessionPayload };

export function issueSession(personId: string, now = Date.now()): IssuedSession {
  const iat = Math.floor(now / 1000);
  const payload: SessionPayload = {
    sub: personId,
    sid: randomUUID(),
    iat,
    exp: iat + SESSION_TTL_SECONDS,
  };
  run(
    "INSERT INTO sessions (id, person_id, issued_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, NULL)",
    [payload.sid, personId, new Date(iat * 1000).toISOString(), new Date(payload.exp * 1000).toISOString()],
  );
  return { token: signSession(payload), payload };
}

export function revokeSession(sessionId: string): void {
  run("UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL", [
    new Date().toISOString(),
    sessionId,
  ]);
}

export function revokeAllForPerson(personId: string): void {
  run("UPDATE sessions SET revoked_at = ? WHERE person_id = ? AND revoked_at IS NULL", [
    new Date().toISOString(),
    personId,
  ]);
}

export function isSessionActive(sessionId: string): boolean {
  const row = get<{ id: string }>("SELECT id FROM sessions WHERE id = ? AND revoked_at IS NULL", [sessionId]);
  return row !== null;
}

/** Resolves a cookie token into a fully-scoped user (or null). */
export function resolveSession(token: string | undefined | null, cookieTenantId: string | null = null): SessionUser | null {
  const payload = verifySession(token);
  if (!payload) return null;
  const person = findPersonById(payload.sub);
  if (!person || !person.active) return null;
  if (!isSessionActive(payload.sid)) return null;
  const tenants = visibleTenants(person);
  const switchers = canSwitchTenantRole(person.role, person.tenant_id);
  let tenantId: string | null = person.tenant_id;
  if (switchers) {
    const requested = cookieTenantId ? getTenantById(cookieTenantId) : null;
    tenantId = requested?.id ?? tenants[0]?.id ?? null;
  }
  const role: Role = isRole(person.role) ? person.role : "viewer";
  return {
    person: stripPerson(person),
    tenantId,
    tenants,
    canSwitchTenant: switchers,
    canAdmin: canAdminRole(role),
    canManage: canManageRole(role),
    canEdit: canEditRole(role),
    cookieTenantId: cookieTenantId,
  };
}

/** Throws if the user may not touch the given tenant. Absolute isolation. */
export function assertTenantAccess(user: SessionUser | null, tenantId: string | null): asserts user is SessionUser & { tenantId: string } {
  if (!user) throw new Error("Not signed in.");
  if (!tenantId) throw new Error("No tenant selected.");
  if (!user.tenants.some((t) => t.id === tenantId)) {
    throw new Error("You do not have access to this tenant.");
  }
}
