/**
 * npm run db:seed — idempotent demo content for two tenants.
 * SEED_DEMO_DATA=false skips the demo rows (a production hub starts empty).
 */
import { randomUUID } from "node:crypto";

import { hashPassword } from "../lib/auth.ts";
import { count, get, migrate, run, setSetting, stableId } from "../lib/db.ts";
import { seedDemoDataEnabled, DEMO_PASSWORD } from "../lib/flags.ts";
import { writeHandoverMirrorIfAbsent } from "../lib/handovers.ts";
import {
  SEED_PEOPLE,
  SEED_PROPOSALS,
  SEED_TENANTS,
  type SeedProposal,
  type SeedTenant,
} from "../lib/seed-data.ts";
import { formatRef } from "../lib/rules.ts";
import { getTenantBySlug } from "../lib/tenants.ts";
import type { Enhancement, TenantView } from "../lib/types.ts";
import { writeVaultFileIfAbsent } from "../lib/vault.ts";

function iso(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86400000).toISOString();
}

async function upsertTenant(seed: SeedTenant): Promise<TenantView> {
  const existing = getTenantBySlug(seed.slug);
  if (existing) return existing;
  // Deterministic: a rebuilt /tmp database must give the same tenant the same id, or a
  // surviving session cookie points at a tenant that no longer exists.
  const id = stableId("seed-tenant", seed.slug);
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
  seed.departments.forEach((name, index) => {
    run("INSERT INTO departments (id, tenant_id, name, sort_order) VALUES (?, ?, ?, ?)", [
      randomUUID(),
      id,
      name,
      (index + 1) * 10,
    ]);
  });
  seed.catalogue.forEach((entry, index) => {
    run(
      "INSERT INTO section_catalogue (tenant_id, id, label, kind, hint, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
      [id, entry.id, entry.label, entry.kind ?? "section", entry.hint ?? "", (index + 1) * 10],
    );
  });
  return getTenantBySlug(seed.slug)!;
}

async function upsertPeople(tenantBySlug: Record<string, TenantView>) {
  const hash = await hashPassword(DEMO_PASSWORD);
  for (const person of SEED_PEOPLE) {
    const existing = get<{ id: string }>("SELECT id FROM people WHERE email = ?", [person.email]);
    if (existing) continue;
    const tenantId = person.tenant ? tenantBySlug[person.tenant]?.id ?? null : null;
    run(
      `INSERT INTO people (id, tenant_id, email, name, role, password_hash, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
      [stableId("seed-person", person.email), tenantId, person.email, person.name, person.role, hash, new Date().toISOString()],
    );
  }
}

function buildEnhancementRow(proposal: SeedProposal, tenant: TenantView): Enhancement {
  const created = iso(proposal.createdOffsetDays);
  return {
    id: proposal.key,
    tenant_id: tenant.id,
    ref: "",
    title: proposal.title,
    brief: proposal.brief,
    raw_text: proposal.rawText,
    requirements: proposal.requirements,
    impacts: proposal.impacts,
    expected_outcome: proposal.expectedOutcome,
    success_criteria: proposal.successCriteria,
    markdown: proposal.narrative,
    outcome: proposal.outcome,
    status: proposal.status,
    area: proposal.area,
    sections: proposal.sections.join(", "),
    ai_fields: JSON.stringify(proposal.aiFields),
    votes: proposal.votes,
    submitted_by: proposal.submittedBy,
    github_path: "",
    handover_path: proposal.handover?.path ?? "",
    archived_at: proposal.archived ? created : null,
    created_at: created,
    updated_at: created,
  };
}

function insertProposals(tenantBySlug: Record<string, TenantView>) {
  const counters: Record<string, number> = {};
  for (const proposal of SEED_PROPOSALS) {
    const tenant = tenantBySlug[proposal.tenant];
    if (!tenant) continue;
    const existing = get<{ ref: string }>("SELECT ref FROM enhancements WHERE tenant_id = ? AND title = ?", [
      tenant.id,
      proposal.title,
    ]);
    if (existing) continue;
    counters[tenant.slug] = (counters[tenant.slug] ?? 0) + 1;
    const ref = formatRef(counters[tenant.slug]);
    const row = { ...buildEnhancementRow(proposal, tenant), ref };
    run(
      `INSERT INTO enhancements (
        id, tenant_id, ref, title, brief, raw_text, requirements, impacts, expected_outcome,
        success_criteria, markdown, outcome, status, area, sections, ai_fields, votes,
        submitted_by, github_path, handover_path, archived_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?)`,
      [
        row.id,
        row.tenant_id,
        row.ref,
        row.title,
        row.brief,
        row.raw_text,
        row.requirements,
        row.impacts,
        row.expected_outcome,
        row.success_criteria,
        row.markdown,
        row.outcome,
        row.status,
        row.area,
        row.sections,
        row.ai_fields,
        row.votes,
        row.submitted_by,
        row.handover_path,
        row.archived_at,
        row.created_at,
        row.updated_at,
      ],
    );

    // Vault mirror: archived records live in vault/<slug>/archive/.
    const withPath = persistVault(row, tenant);
    // Handover mirror: only for records that entered Building or beyond.
    if (proposal.handover) {
      writeHandoverMirrorIfAbsent(withPath, tenant, Boolean(proposal.archived));
    }
    run("UPDATE enhancements SET github_path = ? WHERE id = ?", [withPath.github_path, row.id]);
  }
}

function persistVault(row: Enhancement, tenant: TenantView): Enhancement {
  const written = writeVaultFileIfAbsent(
    row.status === "Archived" ? row : { ...row, status: row.status },
    tenant,
  );
  return { ...row, github_path: written.path };
}

function seedStickyNotes(tenantBySlug: Record<string, TenantView>) {
  if (count("sticky_notes") > 0) return;
  const notes: Array<{ tenant: string; body: string; ai: boolean; author: string }> = [
    {
      tenant: "qa-calendar",
      body: "Quarterly review happens in week 2 — trend tiles land just in time.",
      ai: false,
      author: "lachlan.wu@qa.demo",
    },
    {
      tenant: "qa-calendar",
      body: "Evidence completeness is the most requested reporting slice this quarter.",
      ai: true,
      author: "studio",
    },
  ];
  for (const note of notes) {
    const tenant = tenantBySlug[note.tenant];
    if (!tenant) continue;
    run("INSERT INTO sticky_notes (id, tenant_id, body, ai_generated, author, created_at) VALUES (?, ?, ?, ?, ?, ?)", [
      randomUUID(),
      tenant.id,
      note.body,
      note.ai ? 1 : 0,
      note.author,
      new Date().toISOString(),
    ]);
  }
}

export async function seed(): Promise<{ tenants: number; people: number; enhancements: number; skipped: boolean }> {
  migrate();
  if (!seedDemoDataEnabled()) {
    console.log("[db:seed] SEED_DEMO_DATA=false — demo content skipped.");
    return { tenants: 0, people: 0, enhancements: 0, skipped: true };
  }
  // Fast path: a hub that is already populated AND has accounts is never re-seeded, so
  // a repeated run cannot rewrite a single Markdown file. The people check matters: a
  // half-written seed (tenants but no people) is a hub nobody can sign in to, so it
  // must be completed rather than trusted.
  const alreadySeeded = count("tenants") > 0 && count("people") > 0;
  const tenantBySlug: Record<string, TenantView> = {};
  for (const seedTenant of SEED_TENANTS) {
    tenantBySlug[seedTenant.slug] = await upsertTenant(seedTenant);
  }
  await upsertPeople(tenantBySlug);
  insertProposals(tenantBySlug);
  seedStickyNotes(tenantBySlug);
  setSetting("seeded_at", new Date().toISOString());
  const result = {
    tenants: count("tenants"),
    people: count("people"),
    enhancements: count("enhancements"),
    skipped: alreadySeeded,
  };
  console.log(
    `[db:seed] tenants=${result.tenants} people=${result.people} enhancements=${result.enhancements}`,
  );
  return result;
}

// Only self-execute when run directly as a script. The app imports `seed()` from the
// serverless bootstrap, and a stray top-level await there would be fatal in CJS output.
// (top-level await is fine when this file runs as ESM under tsx.)
const invokedDirectly = /\bseed(\.ts)?$/.test(process.argv[1] ?? "");
if (invokedDirectly) {
  await seed();
  process.exit(0);
}
