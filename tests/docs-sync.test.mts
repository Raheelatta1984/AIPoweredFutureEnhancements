/**
 * Repo-doc reconciliation. Uses a local checkout (HANDOVER_SCAN_ROOT) so the rules
 * are exercised without a GitHub token or network.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

import { makeTestEnv } from "./helpers.ts";

const env = makeTestEnv("feh-docs-sync-");
delete process.env.GITHUB_TOKEN;
process.env.ENHANCEMENT_DOC_SYNC = "true";

// A fake checkout: <scanRoot>/<repo-name>/<handover_dir>/
const scanRoot = mkdtempSync(join(tmpdir(), "feh-scan-"));
process.env.HANDOVER_SCAN_ROOT = scanRoot;

const { getDb, run, get } = await import("../lib/db.ts");
const { createEnhancement, getEnhancementForTenant, moveStatus } = await import("../lib/enhancements.ts");
const { getTenantById } = await import("../lib/tenants.ts");
const { parseDoc, reconcile, scanLocalDocs, syncEnhancementDocs } = await import("../lib/docs-sync.ts");
const { buildFrontmatter } = await import("../lib/rules.ts");
const { QA_TENANT, NORTHWIND_TENANT } = await import("../lib/seed-data.ts");

getDb();

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

const baseInput = {
  brief: "Brief.",
  rawText: "Raw text for the sync tests.",
  requirements: "- one",
  impacts: "",
  expectedOutcome: "",
  successCriteria: "",
  markdown: "",
  outcome: "",
  area: "Reporting",
  sections: "sec.kpi-tiles",
  aiFields: [] as string[],
  submittedBy: "tester@qa.demo",
};

/** Writes a handover doc into the fake checkout. */
function writeDoc(repo: string, handoverDir: string, sub: string, filename: string, ref: string, status: string, title: string): string {
  const dir = join(scanRoot, repo.split("/").pop()!, handoverDir, sub);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, filename);
  const body = [
    buildFrontmatter({ ref, title, status, tenant: repo, app: title }),
    "",
    `# ${ref} — ${title}`,
    "",
    "Body text.",
    "",
  ].join("\n");
  writeFileSync(path, body, "utf8");
  return path;
}

after(() => {
  rmSync(scanRoot, { recursive: true, force: true });
  env.cleanup();
});

test("scanner reads active and archived docs for a tenant", () => {
  writeDoc(QA_TENANT.github_repo, QA_TENANT.handover_dir, ".", "ENH-0100-scan-active.md", "ENH-0100", "Building", "Scan active");
  writeDoc(QA_TENANT.github_repo, QA_TENANT.handover_dir, "archived", "ENH-0101-scan-archived.md", "ENH-0101", "Archived", "Scan archived");
  // Legacy `archive/` spelling is read too.
  writeDoc(QA_TENANT.github_repo, QA_TENANT.handover_dir, "archive", "ENH-0102-scan-legacy.md", "ENH-0102", "Archived", "Scan legacy");
  // Non-handover markdown is ignored by ref extraction but still listed by the scanner.
  writeDoc(QA_TENANT.github_repo, QA_TENANT.handover_dir, ".", "README.md", "", "", "Readme");

  const docs = scanLocalDocs(QA);
  const refs = docs.map((doc) => doc.ref).filter(Boolean).sort();
  assert.deepEqual(refs, ["ENH-0100", "ENH-0101", "ENH-0102"]);

  const archived = docs.filter((doc) => doc.archived).map((doc) => doc.ref).sort();
  assert.deepEqual(archived, ["ENH-0101", "ENH-0102"]);

  // A missing directory yields an empty list rather than throwing.
  assert.deepEqual(scanLocalDocs(NORTHWIND), []);
});

test("an archived doc moves a record to Archived", () => {
  const record = createEnhancement({ tenantId: qaId, title: "Archived by doc", ...baseInput });
  assert.equal(record.status, "Submitted");

  const doc = parseDoc(
    `${QA_TENANT.handover_dir}/archived/ENH-0001-archived-by-doc-x.md`,
    [buildFrontmatter({ ref: record.ref, title: record.title, status: "Archived" }), "", "# body"].join("\n"),
  );

  const matches = reconcile(QA, [doc], { apply: true });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].action, "archived");
  assert.equal(matches[0].toStatus, "Archived");

  const updated = getEnhancementForTenant(record.id, qaId)!;
  assert.equal(updated.status, "Archived");
  assert.ok(updated.archived_at, "archived_at should be stamped");
  assert.equal(updated.handover_path, doc.path);
});

test("an archived doc never overwrites Rejected", async () => {
  const record = createEnhancement({ tenantId: qaId, title: "Rejected stays rejected", ...baseInput });
  const rejected = await moveStatus(record.id, qaId, "Rejected", "manager@qa.demo");
  assert.equal(rejected.ok, true);

  const doc = parseDoc(
    `${QA_TENANT.handover_dir}/archived/ENH-0002-rejected-x.md`,
    [buildFrontmatter({ ref: record.ref, title: record.title, status: "Archived" })].join("\n"),
  );
  const matches = reconcile(QA, [doc], { apply: true });
  assert.equal(matches[0].action, "blocked");
  assert.equal(getEnhancementForTenant(record.id, qaId)!.status, "Rejected");
  assert.equal(getEnhancementForTenant(record.id, qaId)!.archived_at, null);
});

test("a Built doc promotes Building and never skips Submitted", () => {
  const building = createEnhancement({ tenantId: qaId, title: "Building promoted", ...baseInput });
  const submitted = createEnhancement({ tenantId: qaId, title: "Submitted untouched", ...baseInput });

  // Seed the Building row directly: moves to Building would need a publish.
  run("UPDATE enhancements SET status = 'Building' WHERE id = ?", [building.id]);

  const buildingDoc = parseDoc(
    `${QA_TENANT.handover_dir}/ENH-0003-building-x.md`,
    [buildFrontmatter({ ref: building.ref, title: building.title, status: "Built" })].join("\n"),
  );
  const appliedBuilding = reconcile(QA, [buildingDoc], { apply: true });
  assert.equal(appliedBuilding[0].action, "promoted");
  assert.equal(getEnhancementForTenant(building.id, qaId)!.status, "Built");

  const submittedDoc = parseDoc(
    `${QA_TENANT.handover_dir}/ENH-0004-submitted-x.md`,
    [buildFrontmatter({ ref: submitted.ref, title: submitted.title, status: "Built" })].join("\n"),
  );
  const appliedSubmitted = reconcile(QA, [submittedDoc], { apply: true });
  // A document can never skip the pipeline: Submitted stays Submitted until a human
  // (or a Building transition) moves it, so the doc is reported as blocked.
  assert.equal(appliedSubmitted[0].action, "blocked");
  assert.equal(getEnhancementForTenant(submitted.id, qaId)!.status, "Submitted");

  // Once the record is Building, the same doc promotes it exactly once.
  run("UPDATE enhancements SET status = 'Building' WHERE id = ?", [submitted.id]);
  const promoted = reconcile(QA, [submittedDoc], { apply: true });
  assert.equal(promoted[0].action, "promoted");
  assert.equal(getEnhancementForTenant(submitted.id, qaId)!.status, "Built");

  // Now that it is Built, another Built doc is a no-op.
  const again = reconcile(QA, [submittedDoc], { apply: true });
  assert.equal(again[0].action, "unchanged");
});

test("the same ref in two tenants never cross-matches", async () => {
  const qaRecord = createEnhancement({ tenantId: qaId, title: "QA owns 0030", ...baseInput });
  const northwindRecord = createEnhancement({ tenantId: northwindId, title: "Northwind owns 0030", ...baseInput });
  // Both tenants hold ENH-0030 — the UNIQUE constraint is (tenant_id, ref).
  run("UPDATE enhancements SET ref = 'ENH-0030' WHERE id IN (?, ?)", [qaRecord.id, northwindRecord.id]);
  run("UPDATE enhancements SET status = 'Building' WHERE id = ?", [qaRecord.id]);
  assert.equal(getEnhancementForTenant(qaRecord.id, qaId)!.ref, "ENH-0030");
  assert.equal(getEnhancementForTenant(northwindRecord.id, northwindId)!.ref, "ENH-0030");

  // Only Northwind's repository carries an archived ENH-0030 document.
  writeDoc(
    NORTHWIND_TENANT.github_repo,
    NORTHWIND_TENANT.handover_dir,
    "archived",
    "ENH-0030-northwind-x.md",
    "ENH-0030",
    "Archived",
    "Northwind owns 0030",
  );

  await syncEnhancementDocs({ apply: true });
  assert.equal(getEnhancementForTenant(northwindRecord.id, northwindId)!.status, "Archived");
  assert.equal(
    getEnhancementForTenant(qaRecord.id, qaId)!.status,
    "Building",
    "the QA record must not be archived by another tenant's document",
  );

  // Now QA's own repository publishes a Built doc: it promotes QA and leaves
  // Northwind's archived record completely alone.
  writeDoc(
    QA_TENANT.github_repo,
    QA_TENANT.handover_dir,
    ".",
    "ENH-0030-qa-x.md",
    "ENH-0030",
    "Built",
    "QA owns 0030",
  );
  await syncEnhancementDocs({ apply: true });
  assert.equal(getEnhancementForTenant(qaRecord.id, qaId)!.status, "Built");
  assert.equal(getEnhancementForTenant(northwindRecord.id, northwindId)!.status, "Archived");
});

test("a moved file re-points handover_path without changing status", () => {
  const record = createEnhancement({ tenantId: qaId, title: "Move me", ...baseInput });
  const originalPath = `${QA_TENANT.handover_dir}/ENH-0011-move-me-abc.md`;
  run("UPDATE enhancements SET status = 'Building', handover_path = ? WHERE id = ?", [originalPath, record.id]);

  // A doc that reports the current stage only re-points the link.
  const movedPath = `${QA_TENANT.handover_dir}/sub/ENH-0011-move-me-xyz.md`;
  const doc = parseDoc(
    movedPath,
    [buildFrontmatter({ ref: record.ref, title: record.title, status: "Building" })].join("\n"),
  );

  const matches = reconcile(QA, [doc], { apply: true });
  assert.equal(matches[0].action, "repointed");

  const updated = getEnhancementForTenant(record.id, qaId)!;
  assert.equal(updated.status, "Building", "status must not change on a re-point");
  assert.equal(updated.handover_path, movedPath);
});

test("a full sync reports, applies, and writes .tmp/enhancement-docs-sync.md", async () => {
  // A doc that the current database has not seen yet.
  writeDoc(QA_TENANT.github_repo, QA_TENANT.handover_dir, "archived", "ENH-0020-synced-x.md", "ENH-0020", "Archived", "Synced");
  const record = createEnhancement({
    tenantId: qaId,
    title: "Synced by the full run",
    ...baseInput,
  });
  // Align refs: force the record to ENH-0020.
  run("UPDATE enhancements SET ref = 'ENH-0020' WHERE id = ?", [record.id]);

  const report = await syncEnhancementDocs({ apply: true });
  assert.equal(report.mode, "local");
  assert.ok(report.tenants.some((tenant) => tenant.slug === "qa-calendar" && tenant.fetched > 0));

  const match = report.matches.find((entry) => entry.ref === "ENH-0020" && entry.tenantSlug === "qa-calendar");
  assert.ok(match, "the archived doc should be matched");
  assert.equal(match!.action, "archived");
  assert.equal(getEnhancementForTenant(record.id, qaId)!.status, "Archived");

  const reportPath = join(process.cwd(), ".tmp", "enhancement-docs-sync.md");
  assert.ok(report.tenants.length >= 2, "both tenants are reported");
  const { readFileSync, existsSync } = await import("node:fs");
  assert.ok(existsSync(reportPath), "report file should be written");
  const text = readFileSync(reportPath, "utf8");
  assert.match(text, /# Enhancement docs sync/);
  assert.match(text, /ENH-0020/);
});

test("docs-sync can be switched off entirely", async () => {
  process.env.ENHANCEMENT_DOC_SYNC = "false";
  const mod = await import("../lib/docs-sync.ts");
  assert.equal(mod.docsSyncEnabled(), false);
  process.env.ENHANCEMENT_DOC_SYNC = "true";
  assert.equal(mod.docsSyncEnabled(), true);

  // The audit trail records what the sync did.
  const events = get<{ n: number }>("SELECT COUNT(*) AS n FROM audit_events WHERE actor = 'docs-sync'");
  assert.ok(Number(events!.n) >= 1);
});
