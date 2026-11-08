/**
 * Enhancement domain logic. Imported by server actions, CLI scripts and tests —
 * no "use server" here so pure helpers stay importable from anywhere.
 */
import { randomUUID } from "node:crypto";

import { recordAudit } from "./audit.ts";
import { all, get, run, transaction } from "./db.ts";
import { githubConfigured, githubToken, normaliseDir, publishDocument } from "./github.ts";
import {
  formatRef,
  handoverFileName,
  isStatus,
  normaliseText,
  parseRefSequence,
  slugify,
  type Status,
} from "./rules.ts";
import { getTenantById } from "./tenants.ts";
import type { Enhancement, EnhancementView, TenantView } from "./types.ts";
import { archiveVaultFile, buildEnhancementMarkdown, deleteVaultFiles, reopenVaultFile, writeVaultFile } from "./vault.ts";

export function viewOf(row: Enhancement): EnhancementView {
  const aiFields = parseAiFields(row.ai_fields);
  return { ...row, ai_fields: aiFields, aiFields };
}

export function parseAiFields(value: string | string[] | null | undefined): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export function listEnhancements(tenantId: string): EnhancementView[] {
  return all<Enhancement>(
    "SELECT * FROM enhancements WHERE tenant_id = ? ORDER BY created_at DESC",
    [tenantId],
  ).map(viewOf);
}

export function getEnhancement(id: string): EnhancementView | null {
  const row = get<Enhancement>("SELECT * FROM enhancements WHERE id = ?", [id]);
  return row ? viewOf(row) : null;
}

/** Tenant-scoped read: returns null when the record belongs to another tenant. */
export function getEnhancementForTenant(id: string, tenantId: string): EnhancementView | null {
  const row = get<Enhancement>("SELECT * FROM enhancements WHERE id = ? AND tenant_id = ?", [id, tenantId]);
  return row ? viewOf(row) : null;
}

export function nextRef(tenantId: string): string {
  const rows = all<{ ref: string }>("SELECT ref FROM enhancements WHERE tenant_id = ?", [tenantId]);
  let max = 0;
  for (const row of rows) {
    const n = parseRefSequence(row.ref);
    if (n !== null && n > max) max = n;
  }
  return formatRef(max + 1);
}

export type NewEnhancementInput = {
  tenantId: string;
  title: string;
  brief?: string;
  rawText?: string;
  requirements?: string;
  impacts?: string;
  expectedOutcome?: string;
  successCriteria?: string;
  markdown?: string;
  outcome?: string;
  area?: string;
  sections?: string;
  aiFields?: string[];
  submittedBy: string;
  status?: Status;
};

/** Allocates the next ENH-#### for the tenant and writes the vault mirror. */
export function createEnhancement(input: NewEnhancementInput): EnhancementView {
  const tenant = getTenantById(input.tenantId);
  if (!tenant) throw new Error("Unknown tenant.");

  const record = transaction(() => {
    const ref = nextRef(input.tenantId);
    const now = new Date().toISOString();
    const id = randomUUID();
    const status: Status = input.status && isStatus(input.status) ? input.status : "Submitted";
    run(
      `INSERT INTO enhancements (
        id, tenant_id, ref, title, brief, raw_text, requirements, impacts, expected_outcome,
        success_criteria, markdown, outcome, status, area, sections, ai_fields, votes,
        submitted_by, github_path, handover_path, archived_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, '', '', NULL, ?, ?)`,
      [
        id,
        input.tenantId,
        ref,
        normaliseText(input.title),
        normaliseText(input.brief),
        normaliseText(input.rawText),
        normaliseText(input.requirements),
        normaliseText(input.impacts),
        normaliseText(input.expectedOutcome),
        normaliseText(input.successCriteria),
        normaliseText(input.markdown),
        normaliseText(input.outcome),
        status,
        normaliseText(input.area),
        normaliseText(input.sections),
        JSON.stringify(input.aiFields ?? []),
        input.submittedBy,
        now,
        now,
      ],
    );
    return get<Enhancement>("SELECT * FROM enhancements WHERE id = ?", [id])!;
  });

  // Vault mirror outside the DB transaction: a filesystem failure is reported but
  // must not silently drop the row.
  const written = writeVaultFile(record, tenant);
  run("UPDATE enhancements SET github_path = ? WHERE id = ?", [written.path, record.id]);
  recordAudit({
    tenantId: input.tenantId,
    actor: input.submittedBy,
    action: "enhancement.created",
    subject: record.ref,
    after: { ref: record.ref, title: record.title, status: record.status },
    meta: { vault: written.path, aiFields: input.aiFields ?? [] },
  });
  return viewOf({ ...record, github_path: written.path });
}

export type PublishOutcome = { ok: true; path: string; url?: string } | { ok: false; error: string };

/**
 * Publishes the handover document into the consuming repo. The caller MUST refuse
 * the stage move when this returns ok:false — statuses never lie about the document.
 */
export async function publishHandover(
  enhancement: EnhancementView,
  tenant: TenantView,
  actor: string,
  statusOverride?: Status,
): Promise<PublishOutcome> {
  if (!githubConfigured()) {
    const error =
      "Handover not published: GITHUB_TOKEN is not configured on the hub, so the document cannot reach " +
      `${tenant.github_repo || "the consuming repo"}. The stage was NOT changed.`;
    recordAudit({
      tenantId: tenant.id,
      actor,
      action: "enhancement.publish_failed",
      subject: enhancement.ref,
      meta: { reason: error, repo: tenant.github_repo },
    });
    return { ok: false, error };
  }
  if (!tenant.github_repo) {
    const error = `Tenant "${tenant.name}" has no github_repo configured, so there is nowhere to publish. Stage unchanged.`;
    recordAudit({
      tenantId: tenant.id,
      actor,
      action: "enhancement.publish_failed",
      subject: enhancement.ref,
      meta: { reason: error },
    });
    return { ok: false, error };
  }

  const dir = normaliseDir(tenant.handover_dir);
  const filename = handoverFileName(enhancement.ref, enhancement.title, enhancement.id);
  const path = `${dir}/${filename}`;
  const doc = buildEnhancementMarkdown(
    { ...enhancement, status: statusOverride ?? enhancement.status },
    tenant,
    { kind: "handover", statusOverride: statusOverride ?? enhancement.status },
  );
  const result = await publishDocument(
    { token: githubToken(), repo: tenant.github_repo },
    path,
    doc,
    `${enhancement.ref}: ${enhancement.title}`,
  );

  if (!result.ok) {
    const error = `Handover not published to ${tenant.github_repo}/${path}: ${result.error} Stage unchanged.`;
    recordAudit({
      tenantId: tenant.id,
      actor,
      action: "enhancement.publish_failed",
      subject: enhancement.ref,
      meta: { reason: result.error, path, repo: tenant.github_repo },
    });
    return { ok: false, error };
  }

  run("UPDATE enhancements SET handover_path = ?, updated_at = ? WHERE id = ?", [
    result.path,
    new Date().toISOString(),
    enhancement.id,
  ]);
  recordAudit({
    tenantId: tenant.id,
    actor,
    action: "enhancement.published",
    subject: enhancement.ref,
    after: { handover_path: result.path },
    meta: { repo: tenant.github_repo, commit: result.commitSha ?? null },
  });
  return { ok: true, path: result.path, url: result.htmlUrl };
}

export type StatusMoveResult = { ok: boolean; error?: string; enhancement: EnhancementView; published?: boolean };

/** Moves a record to a new status, publishing on Building and archiving on Archived. */
export async function moveStatus(
  enhancementId: string,
  tenantId: string,
  nextStatus: Status,
  actor: string,
): Promise<StatusMoveResult> {
  const before = getEnhancementForTenant(enhancementId, tenantId);
  if (!before) {
    return { ok: false, error: "Enhancement not found in this tenant.", enhancement: null as never };
  }
  const tenant = getTenantById(tenantId);
  if (!tenant) return { ok: false, error: "Unknown tenant.", enhancement: before };

  let published = false;
  if (nextStatus === "Building") {
    const outcome = await publishHandover(before, tenant, actor, "Building");
    if (!outcome.ok) {
      // Refuse the move: the document must exist before the status claims it does.
      return { ok: false, error: outcome.error, enhancement: before };
    }
    published = true;
  }

  const now = new Date().toISOString();
  const archivedAt = nextStatus === "Archived" ? now : null;
  run("UPDATE enhancements SET status = ?, archived_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ?", [
    nextStatus,
    archivedAt,
    now,
    enhancementId,
    tenantId,
  ]);
  let updated = getEnhancementForTenant(enhancementId, tenantId)!;

  if (nextStatus === "Archived") {
    const written = archiveVaultFile(updated, tenant);
    run("UPDATE enhancements SET github_path = ? WHERE id = ?", [written.path, enhancementId]);
    updated = getEnhancementForTenant(enhancementId, tenantId)!;
  } else if (before.status === "Archived") {
    const written = reopenVaultFile(updated, tenant);
    run("UPDATE enhancements SET github_path = ? WHERE id = ?", [written.path, enhancementId]);
    updated = getEnhancementForTenant(enhancementId, tenantId)!;
  } else {
    const written = writeVaultFile(updated, tenant);
    if (written.path !== updated.github_path) {
      run("UPDATE enhancements SET github_path = ? WHERE id = ?", [written.path, enhancementId]);
      updated = getEnhancementForTenant(enhancementId, tenantId)!;
    }
  }

  recordAudit({
    tenantId,
    actor,
    action: nextStatus === "Archived" ? "enhancement.archived" : "enhancement.status_changed",
    subject: updated.ref,
    before: { status: before.status },
    after: { status: updated.status },
    meta: { published },
  });
  return { ok: true, enhancement: updated, published };
}

export function incrementVotes(enhancementId: string, tenantId: string, actor: string): number | null {
  const existing = getEnhancementForTenant(enhancementId, tenantId);
  if (!existing) return null;
  run("UPDATE enhancements SET votes = votes + 1, updated_at = ? WHERE id = ? AND tenant_id = ?", [
    new Date().toISOString(),
    enhancementId,
    tenantId,
  ]);
  const updated = getEnhancementForTenant(enhancementId, tenantId);
  recordAudit({
    tenantId,
    actor,
    action: "enhancement.voted",
    subject: existing.ref,
    before: { votes: existing.votes },
    after: { votes: updated?.votes ?? existing.votes },
  });
  return updated?.votes ?? null;
}

export function deleteEnhancement(enhancementId: string, tenantId: string, actor: string): boolean {
  const existing = getEnhancementForTenant(enhancementId, tenantId);
  if (!existing) return false;
  const tenant = getTenantById(tenantId);
  run("DELETE FROM enhancements WHERE id = ? AND tenant_id = ?", [enhancementId, tenantId]);
  const removed = tenant ? deleteVaultFiles(existing, tenant) : [];
  recordAudit({
    tenantId,
    actor,
    action: "enhancement.deleted",
    subject: existing.ref,
    before: { ref: existing.ref, title: existing.title, status: existing.status },
    meta: { removedVaultFiles: removed },
  });
  return true;
}

/** Rewrites the vault file from the database row (the "regenerate" action). */
export function regenerateVaultFile(enhancementId: string, tenantId: string, actor: string): string | null {
  const existing = getEnhancementForTenant(enhancementId, tenantId);
  const tenant = getTenantById(tenantId);
  if (!existing || !tenant) return null;
  const written =
    existing.status === "Archived" ? archiveVaultFile(existing, tenant) : writeVaultFile(existing, tenant);
  run("UPDATE enhancements SET github_path = ? WHERE id = ?", [written.path, enhancementId]);
  recordAudit({
    tenantId,
    actor,
    action: "enhancement.vault_regenerated",
    subject: existing.ref,
    after: { github_path: written.path },
  });
  return written.path;
}

export type EnhancementPatch = Partial<
  Pick<
    Enhancement,
    | "title"
    | "brief"
    | "raw_text"
    | "requirements"
    | "impacts"
    | "expected_outcome"
    | "success_criteria"
    | "markdown"
    | "outcome"
    | "area"
    | "sections"
    | "ai_fields"
  >
>;

export function updateEnhancement(
  enhancementId: string,
  tenantId: string,
  patch: EnhancementPatch,
  actor: string,
): EnhancementView | null {
  const before = getEnhancementForTenant(enhancementId, tenantId);
  if (!before) return null;
  const tenant = getTenantById(tenantId);
  if (!tenant) return null;
  const fields = Object.keys(patch).filter((key) => patch[key as keyof EnhancementPatch] !== undefined);
  if (fields.length === 0) return before;
  const assignments = fields.map((f) => `${f} = ?`).join(", ");
  const values = fields.map((f) => patch[f as keyof EnhancementPatch] as string | null);
  run(`UPDATE enhancements SET ${assignments}, updated_at = ? WHERE id = ? AND tenant_id = ?`, [
    ...values,
    new Date().toISOString(),
    enhancementId,
    tenantId,
  ]);
  let updated = getEnhancementForTenant(enhancementId, tenantId)!;
  const written = updated.status === "Archived" ? archiveVaultFile(updated, tenant) : writeVaultFile(updated, tenant);
  run("UPDATE enhancements SET github_path = ? WHERE id = ?", [written.path, enhancementId]);
  updated = getEnhancementForTenant(enhancementId, tenantId)!;
  recordAudit({
    tenantId,
    actor,
    action: "enhancement.updated",
    subject: updated.ref,
    before: Object.fromEntries(fields.map((f) => [f, before[f as keyof Enhancement] as string])),
    after: Object.fromEntries(fields.map((f) => [f, updated[f as keyof Enhancement] as string])),
  });
  return updated;
}

export function stageCounts(rows: EnhancementView[]): Record<string, number> {
  const counts: Record<string, number> = {
    Submitted: 0,
    Reviewing: 0,
    Accepted: 0,
    Building: 0,
    Built: 0,
    Archived: 0,
    Rejected: 0,
  };
  for (const row of rows) {
    counts[row.status] = (counts[row.status] ?? 0) + 1;
  }
  return counts;
}

/** Suggested unique slug for a newly added tenant. */
export function tenantSlugFrom(name: string, existing: string[]): string {
  const base = slugify(name);
  if (!existing.includes(base)) return base;
  let n = 2;
  while (existing.includes(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}
