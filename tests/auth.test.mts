/**
 * Auth integration: scrypt hashing, session issue/revoke against the database,
 * role flags and the tenant-access guard.
 *
 * The token format itself is covered by tests/rules.test.ts; this file exercises the
 * stateful half — the sessions table, the people rows and the tenant scoping that
 * actually decides whether a request may touch a record.
 */
import assert from "node:assert/strict";
import test, { after } from "node:test";

import { makeTestEnv } from "./helpers.ts";

// Env first: lib modules resolve the database path when they run.
const env = makeTestEnv("feh-auth-");

const {
  hashPassword,
  verifyPassword,
  issueSession,
  resolveSession,
  revokeSession,
  revokeAllForPerson,
  hasSessionRecord,
  isSessionActive,
  resolveSessionDetailed,
  stripPerson,
  assertTenantAccess,
  findPersonByEmail,
} = await import("../lib/auth.ts");
const { get, run } = await import("../lib/db.ts");
const verifySessionModule = await import("../lib/rules.ts");
const { signSession } = verifySessionModule;

/** Creates a tenant row plus an optional person, returning their ids. */
function seedTenant(slug: string, name: string): string {
  const id = `tenant-${slug}`;
  run(
    `INSERT INTO tenants (id, slug, name, description, github_repo, handover_dir, areas_json, keyword_map_json, colour, enabled, sort_order, created_at)
     VALUES (?, ?, ?, '', '', 'docs/enhancements', '[]', '{}', '#fff', 1, 10, ?)`,
    [id, slug, name, new Date().toISOString()],
  );
  return id;
}

async function seedPerson(options: {
  id?: string;
  email: string;
  role: string;
  tenantId: string | null;
  active?: number;
  password?: string;
}): Promise<string> {
  const id = options.id ?? `person-${options.email.replace(/\W+/g, "-")}`;
  run(
    `INSERT INTO people (id, tenant_id, email, name, role, password_hash, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      options.tenantId,
      options.email,
      options.email.split("@")[0],
      options.role,
      await hashPassword(options.password ?? "demo1234"),
      options.active ?? 1,
      new Date().toISOString(),
    ],
  );
  return id;
}

const qaTenant = seedTenant("qa-calendar", "HFM QA Activity Calendar");
const northwindTenant = seedTenant("northwind", "Northwind Customer Portal");

const hubAdmin = await seedPerson({ email: "admin@hub.demo", role: "admin", tenantId: null });
const hubExec = await seedPerson({ email: "exec@hub.demo", role: "exec", tenantId: null });
const qaEditor = await seedPerson({ email: "editor@qa.demo", role: "editor", tenantId: qaTenant });
const qaViewer = await seedPerson({ email: "viewer@qa.demo", role: "viewer", tenantId: qaTenant });
const inactive = await seedPerson({ email: "gone@qa.demo", role: "editor", tenantId: qaTenant, active: 0 });

after(() => {
  env.cleanup();
});

test("scrypt hashing round-trips and rejects everything else", async () => {
  const stored = await hashPassword("correct horse battery staple");
  assert.match(stored, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);

  assert.equal(await verifyPassword("correct horse battery staple", stored), true);
  assert.equal(await verifyPassword("correct horse battery stapl", stored), false);
  assert.equal(await verifyPassword("", stored), false);

  // Salting means the same password never produces the same hash twice.
  const again = await hashPassword("correct horse battery staple");
  assert.notEqual(stored, again);
  assert.equal(await verifyPassword("correct horse battery staple", again), true);

  // Malformed / foreign hashes fail closed instead of throwing.
  assert.equal(await verifyPassword("x", "not-a-hash"), false);
  assert.equal(await verifyPassword("x", "scrypt$deadbeef$nothex"), false);
  assert.equal(await verifyPassword("x", "bcrypt$aa$bb"), false);
});

test("a fresh session resolves into a fully scoped user", () => {
  const { token, payload } = issueSession(qaEditor);
  assert.equal(isSessionActive(payload.sid), true);

  const user = resolveSession(token, null);
  assert.ok(user, "session should resolve");
  assert.equal(user!.person.id, qaEditor);
  assert.equal(user!.tenantId, qaTenant, "tenant-bound person is pinned to their home tenant");
  assert.equal(user!.canEdit, true);
  assert.equal(user!.canManage, false);
  assert.equal(user!.canAdmin, false);
  assert.equal(user!.canSwitchTenant, false);
  assert.equal(user!.tenants.length, 1);
  assert.equal("password_hash" in user!.person, false, "the hash must never leave the auth layer");
});

test("role flags follow the ladder", () => {
  const admin = resolveSession(issueSession(hubAdmin).token, null)!;
  assert.deepEqual(
    [admin.canEdit, admin.canManage, admin.canAdmin, admin.canSwitchTenant],
    [true, true, true, true],
  );

  const exec = resolveSession(issueSession(hubExec).token, null)!;
  assert.deepEqual(
    [exec.canEdit, exec.canManage, exec.canAdmin, exec.canSwitchTenant],
    [true, true, false, true],
    "exec manages but cannot administer",
  );

  const viewer = resolveSession(issueSession(qaViewer).token, null)!;
  assert.deepEqual([viewer.canEdit, viewer.canManage, viewer.canAdmin], [false, false, false]);
});

test("revocation kills a self-contained token without touching its signature", () => {
  const { token, payload } = issueSession(qaEditor);
  assert.ok(resolveSession(token, null), "valid before revocation");

  revokeSession(payload.sid);
  assert.equal(isSessionActive(payload.sid), false);
  // The signature is still valid — only the sessions row changed. That is the point.
  assert.equal(resolveSession(token, null), null);

  // Revoking twice is harmless.
  revokeSession(payload.sid);
});

test("revoking all sessions for a person invalidates every token at once", () => {
  const first = issueSession(qaViewer);
  const second = issueSession(qaViewer);
  assert.ok(resolveSession(first.token, null));
  assert.ok(resolveSession(second.token, null));

  revokeAllForPerson(qaViewer);
  assert.equal(resolveSession(first.token, null), null);
  assert.equal(resolveSession(second.token, null), null);

  // A newly issued session still works afterwards.
  assert.ok(resolveSession(issueSession(qaViewer).token, null));
});

test("inactive people and forged tokens never resolve", () => {
  // A real session for a person who is then deactivated.
  const { token, payload } = issueSession(inactive);
  assert.equal(resolveSession(token, null), null, "inactive account cannot use a live session");

  // A token signed with the right secret but for a non-existent person.
  const ghost = signSession({ sub: "person-does-not-exist", sid: payload.sid, iat: 1, exp: 4_000_000_000 });
  assert.equal(resolveSession(ghost, null), null);

  // A token whose sid this instance never recorded resolves: a serverless cold start
  // wipes the sessions table, and signing everyone out on every cold start is worse than
  // trusting the signature. A row that exists AND is revoked is still refused (above).
  const unissued = signSession({ sub: qaEditor, sid: "sid-never-issued", iat: 1, exp: 4_000_000_000 });
  assert.equal(hasSessionRecord("sid-never-issued"), false, "this instance has no row for it");
  assert.ok(resolveSession(unissued, null), "an unrecorded session is trusted, not treated as revoked");

  // Garbage in, nothing out.
  assert.equal(resolveSession("", null), null);
  assert.equal(resolveSession(undefined, null), null);
  assert.equal(resolveSession("a.b.c", null), null);
});

test("an expired session does not resolve", () => {
  // Forge a token that is correctly signed but already expired, and record its
  // session row so the only thing standing in the way is the expiry check.
  const sid = "sid-expired-fixture";
  const iat = Math.floor(Date.now() / 1000) - 7200;
  run("INSERT INTO sessions (id, person_id, issued_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, NULL)", [
    sid,
    qaEditor,
    new Date(iat * 1000).toISOString(),
    new Date((iat + 60) * 1000).toISOString(),
  ]);
  const expired = signSession({ sub: qaEditor, sid, iat, exp: iat + 60 });

  assert.equal(isSessionActive(sid), true, "the row exists and is not revoked");
  assert.equal(resolveSession(expired, null), null, "expiry alone must reject the token");

  // The same token is accepted when the clock is inside the window.
  const { verifySession } = verifySessionModule;
  assert.equal(verifySession(expired, iat + 30)?.sub, qaEditor);
});

test("tenant switching is hub-level only and falls back safely", () => {
  const admin = resolveSession(issueSession(hubAdmin).token, null)!;
  assert.equal(admin.canSwitchTenant, true);
  assert.equal(admin.tenants.length, 2, "hub staff see every tenant");
  assert.equal(admin.tenantId, admin.tenants[0].id, "defaults to the first tenant by sort order");

  const switched = resolveSession(issueSession(hubAdmin).token, northwindTenant)!;
  assert.equal(switched.tenantId, northwindTenant);

  // A bogus or foreign cookie value must not grant anything new.
  const bogus = resolveSession(issueSession(hubAdmin).token, "tenant-does-not-exist")!;
  assert.equal(bogus.tenantId, admin.tenants[0].id);

  // A tenant-bound person cannot be steered by the cookie at all.
  const editor = resolveSession(issueSession(qaEditor).token, northwindTenant)!;
  assert.equal(editor.tenantId, qaTenant);
  assert.equal(editor.tenants.length, 1);
});

test("assertTenantAccess refuses cross-tenant work", () => {
  const editor = resolveSession(issueSession(qaEditor).token, null);

  // Own tenant passes.
  assert.doesNotThrow(() => assertTenantAccess(editor, qaTenant));

  // Any other tenant is refused, with a message that does not leak details.
  assert.throws(() => assertTenantAccess(editor, northwindTenant), /do not have access/);
  assert.throws(() => assertTenantAccess(editor, "tenant-invented"), /do not have access/);

  // No session and no tenant are distinct failures.
  assert.throws(() => assertTenantAccess(null, qaTenant), /Not signed in/);
  assert.throws(() => assertTenantAccess(editor, null), /No tenant selected/);

  // Hub staff may reach either tenant.
  const admin = resolveSession(issueSession(hubAdmin).token, northwindTenant);
  assert.doesNotThrow(() => assertTenantAccess(admin, northwindTenant));
});

test("stripPerson and findPersonByEmail behave", () => {
  const person = findPersonByEmail("editor@qa.demo")!;
  assert.ok(person.password_hash.length > 20, "the row carries the hash");
  assert.equal("password_hash" in stripPerson(person), false, "the public shape does not");

  // Case-insensitive lookup, and no match returns null.
  assert.equal(findPersonByEmail("EDITOR@QA.DEMO")?.id, qaEditor);
  assert.equal(findPersonByEmail("nobody@nowhere.test"), null);

  // Every login attempt recorded a session row for the person.
  const count = get<{ n: number }>("SELECT COUNT(*) AS n FROM sessions WHERE person_id = ?", [qaEditor]);
  assert.ok(Number(count!.n) >= 1);
});

/* ------------------------------------------- surviving a cold start (the real bug) */

/**
 * The reported symptom: "only hub admins can add" while signed in as the hub admin.
 *
 * A serverless hub gets a fresh `/tmp` database on a cold start. Two things used to make a
 * 12-hour session die with that database, and both failed *silently* — the admin actions
 * then blamed the operator's role. These assert the mechanisms, because the wording is
 * useless if the mechanics regress.
 */
test("seeded identities survive a rebuilt database, so an old cookie still matches", async () => {
  const { stableId } = await import("../lib/db.ts");
  // Same derivation twice — a rebuilt /tmp database must produce the same person id.
  assert.equal(stableId("seed-person", "amara.okafor@hub.demo"), stableId("seed-person", "amara.okafor@hub.demo"));
  assert.notEqual(stableId("seed-person", "amara.okafor@hub.demo"), stableId("seed-person", "priya.raman@hub.demo"));
  // UUID-shaped, so nothing downstream needs to special-case it.
  assert.match(stableId("seed-person", "amara.okafor@hub.demo"), /^[a-z0-9-]+-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
});

test("a session this instance never recorded is trusted; a revoked one is not", () => {
  // Cold start: the row is simply absent (the previous instance wrote it).
  const { token, payload } = issueSession(hubAdmin);
  run("DELETE FROM sessions WHERE id = ?", [payload.sid]);
  assert.equal(hasSessionRecord(payload.sid), false);
  assert.equal(resolveSession(token, null)?.person.id, hubAdmin, "signature + expiry still hold");

  // Real revocation still wins, and is distinguishable from absence.
  const revoked = issueSession(hubAdmin);
  revokeSession(revoked.payload.sid);
  assert.equal(hasSessionRecord(revoked.payload.sid), true, "this instance knows the row");
  assert.equal(resolveSession(revoked.token, null), null, "revoked means revoked");
});

test("every way a cookie can fail is named, and none of them is 'not an admin'", () => {
  const { describeSessionFailure } = verifySessionModule;
  const cases = ["no-cookie", "invalid-token", "unknown-person", "inactive-person", "unknown-session"] as const;
  const messages = cases.map((failure) => describeSessionFailure(failure));
  for (const [index, message] of messages.entries()) {
    assert.ok(message.length > 20, `${cases[index]} must explain itself`);
    assert.doesNotMatch(message, /only hub admins/i, `${cases[index]} must not blame the role`);
  }
  assert.match(describeSessionFailure("unknown-session"), /Sign in again/);
  assert.match(describeSessionFailure("unknown-person"), /Sign in again/);
  assert.match(describeSessionFailure("invalid-token"), /SESSION_SECRET|expired/);
  // Only a real role problem says "not an admin".
  assert.match(describeSessionFailure(undefined), /not a hub admin/);
});

test("resolveSessionDetailed separates a missing row from a revoked one", () => {
  const { token, payload } = issueSession(hubAdmin);
  assert.equal(resolveSessionDetailed(token, null).failure, undefined);

  run("DELETE FROM sessions WHERE id = ?", [payload.sid]);
  const cold = resolveSessionDetailed(token, null);
  assert.equal(cold.user?.person.id, hubAdmin, "absence is not a refusal");
  assert.equal(cold.failure, undefined);

  const revoked = issueSession(hubAdmin);
  revokeSession(revoked.payload.sid);
  assert.equal(resolveSessionDetailed(revoked.token, null).failure, "unknown-session");

  assert.equal(resolveSessionDetailed("", null).failure, "no-cookie");
  assert.equal(resolveSessionDetailed("not.a.token", null).failure, "invalid-token");
});
