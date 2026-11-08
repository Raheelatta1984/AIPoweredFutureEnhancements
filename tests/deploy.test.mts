/**
 * Deployment-mode behaviour: the bits that only matter once this runs somewhere
 * other than a laptop.
 *
 *  - seeding twice must not rewrite committed fixtures (idempotent tree)
 *  - on a serverless host every writable path must leave the read-only bundle
 *  - missing production settings must surface as visible warnings, not silent risk
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

import { makeTestEnv } from "./helpers.ts";

const env = makeTestEnv("feh-deploy-");
process.env.SEED_DEMO_DATA = "true";

const { count, run } = await import("../lib/db.ts");
const { seed } = await import("../scripts/seed.ts");
const { vaultRoot } = await import("../lib/vault.ts");
const { handoverMirrorRoot, listHandoverMirror, listMirrorTenantFolders } = await import("../lib/handovers.ts");
const { ephemeralStorage, isServerless, runtimeWarnings, usingFallbackSecret } = await import(
  "../lib/runtime-warnings.ts"
);

after(() => env.cleanup());

test("seed is idempotent: a second run inserts nothing and rewrites no file", async () => {
  const first = await seed();
  assert.equal(first.tenants, 2);
  assert.equal(first.people, 6);
  assert.equal(first.enhancements, 4);

  const docPath = join(env.vaultDir, "qa-calendar", "ENH-0001-add-quarter-over-quarter-audit-readiness-trend.md");
  assert.ok(existsSync(docPath), "seed wrote the QA vault doc");
  const before = readFileSync(docPath, "utf8");

  const second = await seed();
  assert.equal(second.skipped, true, "second run is a no-op");
  assert.equal(count("tenants"), 2);
  assert.equal(count("enhancements"), 4);
  assert.equal(readFileSync(docPath, "utf8"), before, "committed-style fixture untouched by re-seed");
});

test("serverless mode redirects every writable path out of the read-only bundle", () => {
  const saved = { ...process.env };
  try {
    process.env.VERCEL = "1";
    delete process.env.ENHANCEMENT_VAULT_DIR;
    delete process.env.DATABASE_FILE;
    delete process.env.ENHANCEMENT_HANDOVER_DIR;

    assert.equal(isServerless(), true);
    assert.match(vaultRoot(), /^\/tmp\//);
    assert.match(handoverMirrorRoot(), /^\/tmp\//);
    assert.equal(ephemeralStorage(), true, "no DATABASE_FILE means the default /tmp database");
  } finally {
    for (const key of ["VERCEL", "ENHANCEMENT_VAULT_DIR", "DATABASE_FILE", "ENHANCEMENT_HANDOVER_DIR"]) {
      delete process.env[key];
      if (saved[key] !== undefined) process.env[key] = saved[key];
    }
  }
});

test("runtime warnings flag a dev secret, ephemeral storage and disabled publishing", () => {
  const saved = { ...process.env };
  try {
    delete process.env.SESSION_SECRET;
    delete process.env.GITHUB_TOKEN;
    process.env.VERCEL = "1";
    delete process.env.DATABASE_FILE;

    assert.equal(usingFallbackSecret(), true);
    const labels = runtimeWarnings().map((w) => w.label);
    assert.deepEqual(labels.sort(), ["dev session secret", "ephemeral /tmp", "publishing off"]);
    // Every warning must carry an actionable explanation, not just a label.
    for (const warning of runtimeWarnings()) assert.ok(warning.detail.length > 40);

    process.env.SESSION_SECRET = "a-sufficiently-long-production-secret";
    process.env.GITHUB_TOKEN = "ghp_example";
    process.env.DATABASE_FILE = join(env.root, "durable.db");
    assert.deepEqual(runtimeWarnings(), [], "a properly configured deploy is quiet");
  } finally {
    for (const key of ["VERCEL", "SESSION_SECRET", "GITHUB_TOKEN", "DATABASE_FILE"]) {
      delete process.env[key];
      if (saved[key] !== undefined) process.env[key] = saved[key];
    }
  }
});

test("explicit directory overrides win over the serverless defaults", () => {
  const override = mkdtempSync(join(tmpdir(), "feh-handovers-"));
  const saved = { ...process.env };
  try {
    process.env.VERCEL = "1";
    process.env.ENHANCEMENT_HANDOVER_DIR = override;
    assert.equal(handoverMirrorRoot(), override);
  } finally {
    delete process.env.VERCEL;
    delete process.env.ENHANCEMENT_HANDOVER_DIR;
    if (saved.VERCEL !== undefined) process.env.VERCEL = saved.VERCEL;
    if (saved.ENHANCEMENT_HANDOVER_DIR !== undefined) {
      process.env.ENHANCEMENT_HANDOVER_DIR = saved.ENHANCEMENT_HANDOVER_DIR;
    }
    rmSync(override, { recursive: true, force: true });
  }
});

test("seeding does not depend on the mirror root being writable in advance", async () => {
  // A mirror directory that does not exist yet must be created on demand.
  const root = mkdtempSync(join(tmpdir(), "feh-fresh-"));
  const saved = process.env.ENHANCEMENT_HANDOVER_DIR;
  try {
    process.env.ENHANCEMENT_HANDOVER_DIR = join(root, "nested", "handovers");
    run("DELETE FROM enhancements");
    const result = await seed();
    assert.equal(result.enhancements, 4);
    assert.ok(existsSync(join(root, "nested", "handovers", "qa-calendar")), "handover mirror created on demand");
  } finally {
    if (saved === undefined) delete process.env.ENHANCEMENT_HANDOVER_DIR;
    else process.env.ENHANCEMENT_HANDOVER_DIR = saved;
    rmSync(root, { recursive: true, force: true });
  }
});

test("an empty writable mirror still surfaces the committed documents", () => {
  // The cold-deploy case: /tmp is empty on first request, but handovers/ ships in the repo.
  const emptyMirror = mkdtempSync(join(tmpdir(), "feh-empty-mirror-"));
  const saved = process.env.ENHANCEMENT_HANDOVER_DIR;
  try {
    process.env.ENHANCEMENT_HANDOVER_DIR = emptyMirror;
    assert.equal(handoverMirrorRoot(), emptyMirror);
    // Nothing is written to the empty root, yet the shipped documents are still listed.
    const docs = listHandoverMirror("qa-calendar");
    assert.ok(docs.length >= 2, "committed handovers are still visible on a cold deploy");
    assert.ok(docs.some((doc) => doc.path.includes("ENH-0001")), "active document included");
    assert.ok(docs.some((doc) => doc.archived), "archived document included");
    // The fallback is read-only: nothing was written into the supplied root.
    const written = readdirSync(emptyMirror);
    assert.deepEqual(written, [], "fallback never writes into the supplied root");
    const folders = listMirrorTenantFolders();
    assert.ok(folders.includes("qa-calendar"), "committed folder is read as a fallback");
    assert.ok(existsSync(join(emptyMirror)), "fallback never writes into the supplied root");
  } finally {
    if (saved === undefined) delete process.env.ENHANCEMENT_HANDOVER_DIR;
    else process.env.ENHANCEMENT_HANDOVER_DIR = saved;
    rmSync(emptyMirror, { recursive: true, force: true });
  }
});

test("mirror reads are deduped when the writable root is the committed root", () => {
  // Repo mode: both roots are the same directory, so nothing may appear twice.
  const saved = process.env.ENHANCEMENT_HANDOVER_DIR;
  try {
    delete process.env.ENHANCEMENT_HANDOVER_DIR;
    const docs = listHandoverMirror("qa-calendar");
    const paths = docs.map((doc) => doc.path);
    assert.equal(new Set(paths).size, paths.length, "no duplicate document paths");
    assert.ok(paths.length >= 2, "seed/committed QA handovers are listed");
  } finally {
    if (saved !== undefined) process.env.ENHANCEMENT_HANDOVER_DIR = saved;
  }
});
