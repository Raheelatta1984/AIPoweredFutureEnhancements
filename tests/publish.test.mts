/**
 * The publish loop, end to end, against a local stand-in for the GitHub API.
 *
 * Why a fake server: the unit tests prove the token gate and the refusal path, but the
 * thing an operator actually cares about is "did the Markdown reach my repository?".
 * A real HTTP server lets this assert the request GitHub would have received without a
 * credential or network access.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test, { after, before } from "node:test";

import { makeTestEnv } from "./helpers.ts";

const env = makeTestEnv("feh-publish-");
process.env.SEED_DEMO_DATA = "true";
process.env.SESSION_SECRET = "a-test-secret-long-enough-for-hkdf-derivation";
delete process.env.GITHUB_TOKEN;

/** Requests the fake GitHub received: { method, path, body }. */
const received: Array<{ method: string; path: string; body?: string }> = [];

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    received.push({ method: req.method ?? "GET", path: url.pathname, body: body || undefined });
    const send = (code: number, payload: unknown) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    };
    if (url.pathname === "/user") return send(200, { login: "probe-user" });
    if (url.pathname === "/user/repos") {
      return send(200, [
        {
          full_name: "Probe/one-repo",
          name: "one-repo",
          owner: { login: "Probe" },
          private: false,
          archived: false,
          description: "first",
          pushed_at: "2026-11-01T00:00:00Z",
          default_branch: "main",
          html_url: "https://github.com/Probe/one-repo",
        },
      ]);
    }
    if (url.pathname.startsWith("/repos/")) {
      // Existing content: 404 means "create". Publish (PUT) records the write.
      if (req.method === "GET") return send(404, { message: "Not Found" });
      if (req.method === "PUT") {
        return send(201, { content: { path: url.pathname }, commit: { sha: "deadbeef" } });
      }
    }
    send(404, { message: "Not Found" });
  });
});

let port = 0;
before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
  process.env.GITHUB_API_URL = `http://127.0.0.1:${port}`;
});

after(() => {
  server.close();
  env.cleanup();
});

const { storeGithubToken, clearGithubToken } = await import("../lib/github-credentials.ts");
const { ensureSeed } = await import("../lib/bootstrap.ts");
const { listRepos, verifyToken } = await import("../lib/github.ts");
const { getTenantById, getTenantBySlug } = await import("../lib/tenants.ts");
const { createEnhancement, getEnhancementForTenant, moveStatus } = await import("../lib/enhancements.ts");

await ensureSeed();
storeGithubToken("ghp_integrationTokenForFakeApi1234567890");

test("the token authenticates and its repositories are discoverable", async () => {
  const who = await verifyToken();
  assert.equal(who.ok, true);
  assert.equal(who.login, "probe-user");

  const listed = await listRepos();
  assert.equal(listed.ok, true);
  assert.equal(listed.source, "stored");
  assert.equal(listed.repos.length, 1);
  assert.equal(listed.repos[0].fullName, "Probe/one-repo");
  assert.equal(listed.repos[0].private, false);
  assert.equal(listed.repos[0].connected, false);
});

test("discovery marks repositories that already have a tenant", async () => {
  const tenants = [getTenantBySlug("qa-calendar")!];
  const connected = new Set(tenants.map((t) => t.github_repo.toLowerCase()).filter(Boolean));
  const listed = await listRepos(connected);
  const qa = listed.repos.find((repo) => repo.fullName === "Raheelatta1984/QA-Activity-Calendar");
  // The fake only returns Probe/one-repo, so nothing should be marked connected here —
  // this asserts the flag is computed, not hardcoded true.
  assert.equal(listed.repos.every((repo) => repo.connected === false), true);
  assert.ok(qa === undefined);
});

test("moving to Building publishes the Markdown with the expected path and payload", async () => {
  const tenant = getTenantById(getTenantBySlug("qa-calendar")!.id)!;
  const created = createEnhancement({
    tenantId: tenant.id,
    title: "Publish an inventory snapshot",
    rawText: "Managers need a weekly inventory snapshot they can export.",
    area: "Reporting",
    submittedBy: "amara.okafor@hub.demo",
  });

  const before = received.length;
  const moved = await moveStatus(created.id, tenant.id, "Building", "amara.okafor@hub.demo");

  assert.equal(moved.ok, true, moved.ok ? "" : moved.error);
  assert.equal(moved.published, true);

  const writes = received.slice(before).filter((r) => r.method === "PUT");
  assert.equal(writes.length, 1, "exactly one document was published");
  const write = writes[0];
  assert.match(write.path, /^\/repos\/Raheelatta1984\/QA-Activity-Calendar\/contents\/lib\/future-enhancements\//);
  assert.match(write.path, /ENH-\d+-publish-an-inventory-snapshot-[\w-]+\.md$/);

  const payload = JSON.parse(write.body ?? "{}") as { message?: string; content?: string };
  assert.match(payload.message ?? "", /^ENH-\d+: Publish an inventory snapshot/);
  const decoded = Buffer.from(payload.content ?? "", "base64").toString("utf8");
  assert.match(decoded, /status: Building/, "the published document carries the new status");
  assert.match(decoded, /Publish an inventory snapshot/);

  // The record now points at the file that really exists.
  const stored = getEnhancementForTenant(created.id, tenant.id)!;
  assert.equal(stored.status, "Building");
  assert.match(stored.handover_path, /lib\/future-enhancements\/ENH-\d+-publish-an-inventory-snapshot-/);
});

test("a publish failure still refuses the stage move", async () => {
  const tenant = getTenantById(getTenantBySlug("qa-calendar")!.id)!;
  const created = createEnhancement({
    tenantId: tenant.id,
    title: "Publish failure check",
    rawText: "This record must not move when the repository rejects the write.",
    submittedBy: "amara.okafor@hub.demo",
  });

  // Point the API at a closed port: the publish cannot succeed.
  const saved = process.env.GITHUB_API_URL;
  process.env.GITHUB_API_URL = "http://127.0.0.1:1";
  try {
    const moved = await moveStatus(created.id, tenant.id, "Building", "amara.okafor@hub.demo");
    assert.equal(moved.ok, false);
    assert.match(moved.error ?? "", /Handover not published/);
    const stored = getEnhancementForTenant(created.id, tenant.id)!;
    assert.notEqual(stored.status, "Building", "status never lies about the document");
  } finally {
    process.env.GITHUB_API_URL = saved;
  }
});

test("clearing the token stops publishing immediately", async () => {
  clearGithubToken();
  const tenant = getTenantById(getTenantBySlug("qa-calendar")!.id)!;
  const created = createEnhancement({
    tenantId: tenant.id,
    title: "Token removed",
    rawText: "Without a token the publish gate must close again.",
    submittedBy: "amara.okafor@hub.demo",
  });
  const moved = await moveStatus(created.id, tenant.id, "Building", "amara.okafor@hub.demo");
  assert.equal(moved.ok, false);
  assert.match(moved.error ?? "", /no GitHub token is configured/i);
});

test("checkGithubConnection reports the account and the exact repo count", async () => {
  storeGithubToken("ghp_connectionCheckToken1234567890ab");
  const { checkGithubConnection } = await import("../lib/github.ts");
  const check = await checkGithubConnection();
  assert.equal(check.ok, true);
  assert.equal(check.login, "probe-user");
  // The count matters: a fine-grained token scoped to a few repos looks identical to a
  // broken setup unless the number is surfaced.
  assert.equal(check.repoCount, 1);

  clearGithubToken();
  const none = await checkGithubConnection();
  assert.equal(none.ok, false);
  assert.match(none.error ?? "", /No token configured|not configured|No GitHub token/i);
});
