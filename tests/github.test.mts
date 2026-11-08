/**
 * The two things that made the deployed hub unusable.
 *
 *  1. Sign-in failed because the auth action trusted a database another instance had
 *     populated. Any change here must keep `loginAction` bootstrapping the database.
 *  2. Moving a proposal to Building was refused because there was no way to give the
 *     hub a GitHub token from the UI.
 *
 * These tests import lib modules only (no "use server" files): server action modules
 * cannot be imported outside a request, so the contract is asserted against the
 * functions those actions call.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { after } from "node:test";

import { makeTestEnv } from "./helpers.ts";

const env = makeTestEnv("feh-github-");
// makeTestEnv disables seeding; these tests are about the first-run bootstrap, so re-enable it.
process.env.SEED_DEMO_DATA = "true";
process.env.SESSION_SECRET = "a-test-secret-long-enough-for-hkdf-derivation";

const { count, run, setting } = await import("../lib/db.ts");
const { ensureSeed, resetBootstrap } = await import("../lib/bootstrap.ts");
const { seed } = await import("../scripts/seed.ts");
const { findPersonByEmail, verifyPassword } = await import("../lib/auth.ts");
const { clearGithubToken, resolveGithubToken, storeGithubToken, tokenState } = await import(
  "../lib/github-credentials.ts"
);
const { githubConfigured, normaliseDir, splitRepo } = await import("../lib/github.ts");
const { runtimeWarnings } = await import("../lib/runtime-warnings.ts");

after(() => {
  // Leave no stored credential behind for the next suite in the same process.
  clearGithubToken();
  delete process.env.GITHUB_TOKEN;
  env.cleanup();
});

/* ---------------------------------------------------------------- auth bootstrap */

test("the auth action bootstraps the database before looking for a person", () => {
  // A source-level assertion on purpose: loginAction cannot be invoked outside a
  // request, but the ordering inside it is exactly what broke sign-in in production.
  const source = readFileSync(new URL("../app/actions/auth.ts", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("export async function loginAction"));
  const boot = body.indexOf("await ensureBootReady()");
  const lookup = body.indexOf("findPersonByEmail(");
  assert.ok(boot > -1, "loginAction awaits ensureBootReady()");
  assert.ok(lookup > -1, "loginAction looks the person up");
  assert.ok(boot < lookup, "the database is readied BEFORE the person lookup");
});

test("a fresh instance can authenticate a seeded person without any page render", async () => {
  // Emulates a cold serverless instance: empty database, first request is the POST.
  resetBootstrap();
  run("DELETE FROM people");
  run("DELETE FROM tenants");
  assert.equal(count("people"), 0);

  await ensureSeed();

  assert.equal(count("people"), 6, "bootstrap populated the people table");
  const amara = findPersonByEmail("amara.okafor@hub.demo");
  assert.ok(amara, "the demo admin exists after bootstrap");
  assert.equal(amara?.active, 1);
  assert.equal(await verifyPassword("demo1234", amara!.password_hash), true, "demo password verifies");
});

test("a half-written seed (tenants but no people) is repaired, not trusted", async () => {
  run("DELETE FROM people");
  assert.equal(count("tenants"), 2);
  resetBootstrap();
  await ensureSeed();
  assert.equal(count("people"), 6);
});

test("email lookup is case-insensitive and tolerant of whitespace", async () => {
  assert.ok(findPersonByEmail("  Amara.Okafor@Hub.Demo ") !== null);
});

/* --------------------------------------------------------- github token handling */

test("a stored token round-trips and is never persisted in plaintext", () => {
  clearGithubToken();
  delete process.env.GITHUB_TOKEN;
  assert.equal(resolveGithubToken(), null, "nothing resolves before anything is stored");
  assert.equal(githubConfigured(), false);

  const raw = "ghp_thisIsARealLookingTokenValue123456";
  assert.equal(storeGithubToken(raw).ok, true);
  assert.equal(resolveGithubToken(), raw, "the same token comes back");
  assert.equal(githubConfigured(), true);

  const persisted = setting("github_token_enc") ?? "";
  assert.notEqual(persisted, raw, "the raw token is not what lands in the database");
  assert.ok(!persisted.includes(raw), "no substring of the secret is written");
  assert.match(persisted, /^v1\./, "versioned ciphertext envelope");

  const state = tokenState();
  assert.equal(state.state, "stored");
  assert.match(state.hint ?? "", /^…/, "the UI hint is a masked tail, not the token");
  assert.ok(!(state.hint ?? "").includes(raw));
});

test("an env token beats the stored token", () => {
  process.env.GITHUB_TOKEN = "ghp_envTokenWins1234567890abcd";
  try {
    assert.equal(resolveGithubToken(), process.env.GITHUB_TOKEN);
    assert.equal(tokenState().state, "env");
  } finally {
    delete process.env.GITHUB_TOKEN;
  }
  assert.equal(resolveGithubToken(), "ghp_thisIsARealLookingTokenValue123456", "stored token still usable");
});

test("a token encrypted under a different secret degrades to 'not configured'", () => {
  const before = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "a-completely-different-secret-value-32ch";
  try {
    assert.equal(resolveGithubToken(), null, "undecryptable ciphertext resolves to null, never throws");
    const state = tokenState();
    assert.equal(state.state, "none");
    assert.match(state.hint ?? "", /SESSION_SECRET changed/);
  } finally {
    process.env.SESSION_SECRET = before;
  }
  assert.equal(tokenState().state, "stored");
});

test("short or empty tokens are rejected instead of stored", () => {
  assert.equal(storeGithubToken("short").ok, false);
  assert.equal(storeGithubToken("   ").ok, false);
});

test("a stored token makes publishing possible, so Building is no longer refused", async () => {
  // Ends with the token cleared: a leaked credential here would silently disarm the
  // lifecycle suite's "refused when absent" test.
  clearGithubToken();
  const { getTenantBySlug } = await import("../lib/tenants.ts");
  const { createEnhancement, moveStatus } = await import("../lib/enhancements.ts");
  const tenant = getTenantBySlug("qa-calendar");
  assert.ok(tenant, "seeded tenant present");

  const created = createEnhancement({
    tenantId: tenant!.id,
    title: "Token gate check",
    rawText: "Verify that a stored token unblocks the Building stage move in the hub.",
    area: "Reporting",
    submittedBy: "amara.okafor@hub.demo",
  });
  assert.ok(created);

  // No token: refused.
  const refused = await moveStatus(created.id, tenant!.id, "Building", "amara.okafor@hub.demo");
  assert.equal(refused.ok, false);
  assert.match(refused.error ?? "", /no GitHub token is configured/i);

  // A stored token satisfies the "configured" check, so the code proceeds to the
  // network call. In this sandbox that call fails, but the failure is now a publish
  // error rather than a missing-credential refusal — which is the behaviour change.
  storeGithubToken("ghp_storedTokenMakesConfigured1234567890");
  const withToken = await moveStatus(created.id, tenant!.id, "Building", "amara.okafor@hub.demo");
  assert.equal(withToken.ok, false, "still refused: the publish itself cannot succeed offline");
  assert.doesNotMatch(withToken.error ?? "", /no GitHub token is configured/i, "no longer a credential problem");
  assert.match(withToken.error ?? "", /Handover not published/);
  assert.equal(getTenantBySlug("qa-calendar")?.id, tenant!.id, "tenant untouched");

  clearGithubToken();
});

test("clearing the token really clears it", () => {
  clearGithubToken();
  assert.equal(resolveGithubToken(), null);
  assert.equal(tokenState().state, "none");
});

test("the 'publishing off' warning disappears once a token is stored", () => {
  delete process.env.GITHUB_TOKEN;
  assert.ok(runtimeWarnings().some((w) => w.label === "publishing off"));
  storeGithubToken("ghp_thisIsARealLookingTokenValue123456");
  assert.ok(
    !runtimeWarnings().some((w) => w.label === "publishing off"),
    "a UI-entered token counts as configured",
  );
});

/* ----------------------------------------------------------------- repo handling */

test("repository names split the way the tenant column stores them", () => {
  assert.deepEqual(splitRepo("Raheelatta1984/QA-Activity-Calendar"), {
    owner: "Raheelatta1984",
    name: "QA-Activity-Calendar",
  });
  assert.equal(splitRepo("not-a-repo"), null);
  assert.equal(splitRepo(""), null);
});

test("handover folders are normalised and traversal is refused", () => {
  assert.equal(normaliseDir("docs/enhancements/"), "docs/enhancements");
  assert.equal(normaliseDir("/docs/enhancements/"), "docs/enhancements");
  assert.equal(normaliseDir(""), "docs/enhancements");
  assert.equal(normaliseDir("../../etc"), "docs/enhancements", "traversal falls back to the default");
});

test("seeding is still idempotent after the repair logic", async () => {
  const before = count("enhancements");
  const result = await seed();
  assert.equal(result.skipped, true);
  assert.equal(count("enhancements"), before);
});
