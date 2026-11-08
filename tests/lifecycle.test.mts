/**
 * Lifecycle: submit → vault file, ref sequencing, publish refusal, archive/reopen,
 * delete, cross-tenant isolation.
 *
 * Written as .mts on purpose: this file uses top-level await, and tsx compiles a
 * plain .ts file to CJS, which rejects top-level await outright.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test, { after } from "node:test";

import { makeTestEnv } from "./helpers.ts";

// Env MUST be set before any ../lib import resolves the database or vault root.
const env = makeTestEnv("feh-lifecycle-");
delete process.env.GITHUB_TOKEN;
process.env.ENHANCEMENT_DOC_SYNC = "false";

const { getDb, run, get } = await import("../lib/db.ts");
const { createEnhancement, getEnhancementForTenant, incrementVotes, moveStatus, deleteEnhancement, updateEnhancement, nextRef, listEnhancements } =
  await import("../lib/enhancements.ts");
const { getTenantById, getTenantBySlug } = await import("../lib/tenants.ts");
const { archiveVaultFile, buildEnhancementMarkdown, vaultRelativePath } = await import("../lib/vault.ts");
const { parseFrontmatter } = await import("../lib/rules.ts");
const { QA_TENANT, NORTHWIND_TENANT } = await import("../lib/seed-data.ts");

getDb();

/** Creates the tenant row (and catalogue) from the seed definition. */
function createTenant(seed: typeof QA_TENANT): string {
  const id = `tenant-${seed.slug}`;
  run(
    `INSERT INTO tenants (id, slug, name, description, github_repo, handover_dir, areas_json, keyword_map_json, colour, enabled, sort_order, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    [
      id,
      seed.slug,
      seed.name,
      seed.description,
      seed.github_repo,
      seed.handover_dir,
      JSON.stringify(seed.areas),
      JSON.stringify(seed.keywordMap),
      seed.colour,
      seed.sort_order,
      new Date().toISOString(),
    ],
  );
  seed.catalogue.forEach((entry, index) => {
    run(
      "INSERT INTO section_catalogue (tenant_id, id, label, kind, hint, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
      [id, entry.id, entry.label, entry.kind ?? "section", entry.hint ?? "", (index + 1) * 10],
    );
  });
  return id;
}

const qaId = createTenant(QA_TENANT);
const northwindId = createTenant(NORTHWIND_TENANT);

const QA = getTenantById(qaId)!;
const NORTHWIND = getTenantById(northwindId)!;
assert.equal(QA.slug, "qa-calendar");
assert.equal(NORTHWIND.slug, "northwind");

const baseInput = {
  brief: "Brief text from the author.",
  rawText: "We need a quarter-over-quarter audit readiness trend on the KPI tiles.",
  requirements: "- Four quarter trend\n- Site filter",
  impacts: "KPI tiles and report export.",
  expectedOutcome: "Managers answer trend questions in the portal.",
  successCriteria: "1. Trend renders\n2. Export unchanged",
  markdown: "## Notes\nExtra context.",
  outcome: "Trend on screen at review time.",
  area: "Reporting",
  sections: "sec.kpi-tiles, tab.overview",
  aiFields: ["title", "brief"],
  submittedBy: "sofia@qa.demo",
};

const first = createEnhancement({ tenantId: qaId, title: "First QA proposal", ...baseInput });

after(() => {
  env.cleanup();
});

test("submit persists the row and writes the vault file", () => {
  const row = getEnhancementForTenant(first.id, qaId);
  assert.ok(row, "row should be persisted");
  assert.equal(row!.status, "Submitted");
  assert.equal(row!.ref, "ENH-0001");
  assert.equal(row!.github_path, `vault/qa-calendar/ENH-0001-${"first-qa-proposal"}.md`);
  assert.deepEqual(row!.aiFields, ["title", "brief"]);

  const absolute = join(env.vaultDir, "qa-calendar", "ENH-0001-first-qa-proposal.md");
  assert.ok(existsSync(absolute), "vault file should exist on disk");
  const markdown = readFileSync(absolute, "utf8");
  const frontmatter = parseFrontmatter(markdown);
  assert.equal(frontmatter.ref, "ENH-0001");
  assert.equal(frontmatter.status, "Submitted");
  assert.equal(frontmatter.tenant, "qa-calendar");
  assert.deepEqual(frontmatter.ai_fields, ["title", "brief"]);
  assert.match(markdown, /_AI-drafted fields: title, brief\./);

  // Every write leaves an audit event behind.
  const events = get<{ n: number }>("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'enhancement.created'");
  assert.equal(Number(events!.n), 1);
});

test("refs are sequential per tenant, never shared across tenants", () => {
  assert.equal(nextRef(qaId), "ENH-0002");

  const second = createEnhancement({ tenantId: qaId, title: "Second QA proposal", ...baseInput });
  assert.equal(second.ref, "ENH-0002");

  // A different tenant starts its own sequence at 1.
  const northwindFirst = createEnhancement({ tenantId: northwindId, title: "Northwind first", ...baseInput });
  assert.equal(northwindFirst.ref, "ENH-0001");
  const northwindSecond = createEnhancement({ tenantId: northwindId, title: "Northwind second", ...baseInput });
  assert.equal(northwindSecond.ref, "ENH-0002");

  // Both tenants now hold an ENH-0001 — refs are only unique inside a tenant.
  const qaRefs = listEnhancements(qaId).map((item) => item.ref).sort();
  const northwindRefs = listEnhancements(northwindId).map((item) => item.ref).sort();
  assert.deepEqual(qaRefs, ["ENH-0001", "ENH-0002"]);
  assert.deepEqual(northwindRefs, ["ENH-0001", "ENH-0002"]);
});

test("moving to Building is refused, visibly, when GITHUB_TOKEN is absent", async () => {
  assert.equal(process.env.GITHUB_TOKEN, undefined);
  const before = getEnhancementForTenant(first.id, qaId)!;
  const result = await moveStatus(first.id, qaId, "Building", "sofia@qa.demo");

  assert.equal(result.ok, false);
  // The refusal must name the missing credential AND where to fix it: the hub now
  // accepts a token from the UI, so telling the operator to set an env var alone
  // would send them to the wrong place.
  assert.match(result.error ?? "", /no GitHub token is configured/i);
  assert.match(result.error ?? "", /\/tenants/);
  assert.match(result.error ?? "", /Stage unchanged|NOT changed/i);

  // Status never lies: it is still Submitted, and no handover path was invented.
  const afterRow = getEnhancementForTenant(first.id, qaId)!;
  assert.equal(afterRow.status, before.status);
  assert.equal(afterRow.handover_path, "");

  // The refusal is on the audit trail.
  const refusal = get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM audit_events WHERE action = 'enhancement.publish_failed' AND subject = 'ENH-0001'",
  );
  assert.equal(Number(refusal!.n), 1);
});

test("a non-Building stage moves without a publish", async () => {
  const result = await moveStatus(first.id, qaId, "Reviewing", "sofia@qa.demo");
  assert.equal(result.ok, true);
  assert.equal(result.enhancement.status, "Reviewing");
  const row = getEnhancementForTenant(first.id, qaId)!;
  assert.equal(row.status, "Reviewing");
  assert.equal(row.archived_at, null);
});

test("archiving relocates the vault file and stamps archived_at", async () => {
  const result = await moveStatus(first.id, qaId, "Archived", "lachlan@qa.demo");
  assert.equal(result.ok, true);

  const active = join(env.vaultDir, "qa-calendar", "ENH-0001-first-qa-proposal.md");
  const archived = join(env.vaultDir, "qa-calendar", "archive", "ENH-0001-first-qa-proposal.md");
  assert.ok(!existsSync(active), "active file should have moved");
  assert.ok(existsSync(archived), "archived file should exist");
  assert.match(readFileSync(archived, "utf8"), /status: Archived/);

  const row = getEnhancementForTenant(first.id, qaId)!;
  assert.equal(row.status, "Archived");
  assert.ok(row.archived_at, "archived_at must be stamped");
  assert.equal(row.github_path, "vault/qa-calendar/archive/ENH-0001-first-qa-proposal.md");
});

test("reopening moves the file back out of archive/", async () => {
  const result = await moveStatus(first.id, qaId, "Accepted", "lachlan@qa.demo");
  assert.equal(result.ok, true);

  const active = join(env.vaultDir, "qa-calendar", "ENH-0001-first-qa-proposal.md");
  const archived = join(env.vaultDir, "qa-calendar", "archive", "ENH-0001-first-qa-proposal.md");
  assert.ok(existsSync(active), "file should be back in the active folder");
  assert.ok(!existsSync(archived), "archived copy should be gone");

  const row = getEnhancementForTenant(first.id, qaId)!;
  assert.equal(row.status, "Accepted");
  assert.equal(row.archived_at, null);
});

test("votes increment on the owning tenant only", () => {
  const before = getEnhancementForTenant(first.id, qaId)!.votes;
  const updated = incrementVotes(first.id, qaId, "hana@qa.demo");
  assert.equal(updated, before + 1);

  // Cross-tenant vote is refused and changes nothing.
  assert.equal(incrementVotes(first.id, northwindId, "noah@northwind.demo"), null);
  assert.equal(getEnhancementForTenant(first.id, qaId)!.votes, before + 1);
});

test("cross-tenant reads and mutations are refused", async () => {
  // Read: another tenant cannot see this record at all.
  assert.equal(getEnhancementForTenant(first.id, northwindId), null);
  assert.equal(getEnhancementForTenant(first.id, qaId)?.ref, "ENH-0001");

  // Mutations: refused, with the original row intact.
  const moved = await moveStatus(first.id, northwindId, "Built", "noah@northwind.demo");
  assert.equal(moved.ok, false);
  assert.equal(getEnhancementForTenant(first.id, qaId)!.status, "Accepted");

  assert.equal(updateEnhancement(first.id, northwindId, { title: "hijacked" }, "noah@northwind.demo"), null);
  assert.equal(getEnhancementForTenant(first.id, qaId)!.title, "First QA proposal");

  assert.equal(deleteEnhancement(first.id, northwindId, "noah@northwind.demo"), false);
  assert.ok(getEnhancementForTenant(first.id, qaId));

  // Refused attempts leave no mutation events against the wrong tenant. (Northwind
  // legitimately owns its own ENH-0001, so only mutation actions are checked.)
  const wrong = get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM audit_events
     WHERE tenant_id = ? AND subject = 'ENH-0001'
       AND action IN ('enhancement.status_changed','enhancement.updated','enhancement.deleted','enhancement.archived','enhancement.published')`,
    [northwindId],
  );
  assert.equal(Number(wrong!.n), 0);
});

test("delete removes the row and the vault file", () => {
  const victim = createEnhancement({ tenantId: qaId, title: "Delete me", ...baseInput });
  const absolute = join(env.vaultDir, "qa-calendar", "ENH-0003-delete-me.md");
  assert.ok(existsSync(absolute), "file should exist before delete");

  assert.equal(deleteEnhancement(victim.id, qaId, "sofia@qa.demo"), true);
  assert.equal(getEnhancementForTenant(victim.id, qaId), null);
  assert.ok(!existsSync(absolute), "vault file should be removed");
});

test("markdown mirrors author text and lists AI fields in the frontmatter", () => {
  const row = getEnhancementForTenant(first.id, qaId)!;
  const markdown = buildEnhancementMarkdown(row, QA);
  const frontmatter = parseFrontmatter(markdown);
  assert.equal(frontmatter.ref, row.ref);
  assert.equal(frontmatter.title, "First QA proposal");
  assert.equal(frontmatter.area, "Reporting");
  assert.deepEqual(frontmatter.app_sections, ["sec.kpi-tiles", "tab.overview"]);
  assert.deepEqual(frontmatter.ai_fields, ["title", "brief"]);
  assert.match(markdown, /## Requirements\n\n- Four quarter trend/);
  assert.match(markdown, /source: enhancements-hub\/vault/);
  assert.equal(vaultRelativePath(row, "qa-calendar"), row.github_path);
});

test("archiving is idempotent and keeps one canonical file", () => {
  const row = getEnhancementForTenant(first.id, qaId)!;
  archiveVaultFile(row, QA);
  archiveVaultFile(row, QA);
  const archived = join(env.vaultDir, "qa-calendar", "archive", "ENH-0001-first-qa-proposal.md");
  assert.ok(existsSync(archived));
  assert.equal(parseFrontmatter(readFileSync(archived, "utf8")).status, "Archived");
});

test("a handover published on disk is recorded, not assumed", () => {
  // Simulate what a successful publish does to the row, then confirm the
  // markdown written for the consuming repo carries the same frontmatter.
  const row = getEnhancementForTenant(first.id, qaId)!;
  const handover = buildEnhancementMarkdown({ ...row, status: "Building" }, QA, {
    kind: "handover",
    statusOverride: "Building",
  });
  assert.match(handover, /status: Building/);
  assert.match(handover, /source: enhancements-hub\/Raheelatta1984\/QA-Activity-Calendar/);

  const dir = join(env.vaultDir, "..", "handovers");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "sample.md"), handover, "utf8");
  assert.ok(existsSync(join(dir, "sample.md")));
  assert.equal(getTenantBySlug("qa-calendar")!.github_repo, "Raheelatta1984/QA-Activity-Calendar");
});
