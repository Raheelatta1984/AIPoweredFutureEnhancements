/**
 * sync.ts — reconciles repo-side handover documents with in-app records.
 *
 * The repo is the durable record. This runs at server start (skipped with
 * ENHANCEMENT_DOC_SYNC=false) and via `npm run enhancement:sync`, producing
 * .tmp/enhancement-docs-sync.md.
 *
 * Two reconciliation paths:
 *  • network — list the tenant's handover_dir over the GitHub API (needs a token)
 *  • local   — scan a checked-out clone (HANDOVER_SCAN_ROOT), so the hub works
 *              offline and in CI without secrets.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { recordAudit } from "./audit.ts";
import { all, get, run } from "./db.ts";
import { defaultBranch, githubConfigured, githubToken, listDocuments, normaliseDir, readDocument } from "./github.ts";
import { canApplyDocStatus, isArchivedDocPath, parseFrontmatter, refFromPath, type Status } from "./rules.ts";
import { getTenantById, listTenants } from "./tenants.ts";
import type { Enhancement, TenantView } from "./types.ts";

export type DocRecord = {
  path: string;
  ref: string | null;
  status: string;
  archived: boolean;
  title: string;
};

export type SyncMatch = {
  tenantSlug: string;
  ref: string;
  docPath: string;
  action: "archived" | "promoted" | "repointed" | "unchanged" | "unmatched" | "blocked";
  enhancementId?: string;
  fromStatus?: string;
  toStatus?: string;
  note?: string;
};

export type TenantSyncReport = {
  slug: string;
  repo: string;
  fetched: number;
  docsPath: string;
  error?: string;
};

export type SyncReport = {
  ranAt: string;
  mode: "network" | "local" | "none";
  tenants: TenantSyncReport[];
  matches: SyncMatch[];
  counts: { archived: number; promoted: number; repointed: number; unchanged: number; unmatched: number; blocked: number };
  errors: string[];
};

export function docsSyncEnabled(): boolean {
  const raw = process.env.ENHANCEMENT_DOC_SYNC;
  if (raw === undefined || raw.trim() === "") return true;
  return !["false", "0", "off", "no"].includes(raw.trim().toLowerCase());
}

function docStatus(frontmatter: Record<string, string | string[]>, archived: boolean): string {
  const raw = frontmatter.status;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value === "string" && value.trim()) return value.trim();
  return archived ? "Archived" : "Building";
}

function docTitle(frontmatter: Record<string, string | string[]>, path: string): string {
  const raw = frontmatter.title;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value === "string" && value.trim()) return value.trim();
  return (path.split("/").pop() ?? "").replace(/\.md$/, "");
}

export function parseDoc(path: string, markdown: string): DocRecord {
  const frontmatter = parseFrontmatter(markdown);
  const archived = isArchivedDocPath(path);
  const refRaw = frontmatter.ref;
  const refValue = Array.isArray(refRaw) ? refRaw[0] : refRaw;
  const ref = (typeof refValue === "string" && refValue.trim()) || refFromPath(path);
  return {
    path,
    ref: ref ? ref.trim() : null,
    status: docStatus(frontmatter, archived),
    archived,
    title: docTitle(frontmatter, path),
  };
}

function walkMarkdown(root: string, maxDepth = 6): string[] {
  const out: string[] = [];
  const visit = (dir: string, depth: number) => {
    if (depth > maxDepth) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.startsWith(".") || entry === "node_modules") continue;
      const full = join(dir, entry);
      let stats;
      try {
        stats = statSync(full);
      } catch {
        continue;
      }
      if (stats.isDirectory()) visit(full, depth + 1);
      else if (entry.endsWith(".md")) out.push(full);
    }
  };
  visit(root, 0);
  return out;
}

/** Local checkout scan: <root>/<repo-name>/<handover_dir>/**.md */
export function scanLocalDocs(tenant: TenantView, root = process.env.HANDOVER_SCAN_ROOT): DocRecord[] {
  if (!root) return [];
  const basename = tenant.github_repo.split("/").pop() ?? tenant.slug;
  const candidates = [join(root, basename), join(root, tenant.slug)];
  const docs: DocRecord[] = [];
  for (const base of candidates) {
    const dir = join(base, normaliseDir(tenant.handover_dir));
    if (!existsSync(dir)) continue;
    for (const file of walkMarkdown(dir)) {
      const rel = relative(base, file).split("\\").join("/");
      try {
        docs.push(parseDoc(rel, readFileSync(file, "utf8")));
      } catch {
        /* unreadable */
      }
    }
    if (docs.length > 0) break;
  }
  return docs;
}

async function fetchRemoteDocs(tenant: TenantView): Promise<{ docs: DocRecord[]; error?: string }> {
  const token = githubToken();
  if (!token || !tenant.github_repo) return { docs: [], error: "GITHUB_TOKEN not configured (network sync skipped)." };
  const dir = normaliseDir(tenant.handover_dir);
  const listing = await listDocuments({ token, repo: tenant.github_repo, branch: defaultBranch() }, dir);
  if (!listing.ok) return { docs: [], error: listing.error };
  const docs: DocRecord[] = [];
  for (const remote of listing.docs) {
    const read = await readDocument({ token, repo: tenant.github_repo, branch: defaultBranch() }, remote.path);
    if (!read.ok || read.content === undefined) continue;
    docs.push(parseDoc(remote.path, read.content));
  }
  // Legacy archive folders in the tenant repo.
  for (const legacy of ["archived", "archive"]) {
    const legacyListing = await listDocuments(
      { token, repo: tenant.github_repo, branch: defaultBranch() },
      `${dir}/${legacy}`,
    );
    for (const remote of legacyListing.docs ?? []) {
      const read = await readDocument({ token, repo: tenant.github_repo, branch: defaultBranch() }, remote.path);
      if (!read.ok || read.content === undefined) continue;
      docs.push(parseDoc(remote.path, read.content));
    }
  }
  return { docs };
}

function tenantRecords(tenantId: string): Enhancement[] {
  return all<Enhancement>("SELECT * FROM enhancements WHERE tenant_id = ?", [tenantId]);
}

/**
 * Applies the rules:
 *  • archived doc  → status Archived (never overwrites Rejected)
 *  • Built/Building doc → promotes a record that is below Built
 *  • file moved    → re-point handover_path
 */
export function reconcile(
  tenant: TenantView,
  docs: DocRecord[],
  options: { apply?: boolean } = {},
): SyncMatch[] {
  const apply = options.apply ?? true;
  const records = tenantRecords(tenant.id);
  const byRef = new Map(records.map((r) => [r.ref, r]));
  const matches: SyncMatch[] = [];

  for (const doc of docs) {
    if (!doc.ref) continue;
    const record = byRef.get(doc.ref);
    if (!record) {
      matches.push({
        tenantSlug: tenant.slug,
        ref: doc.ref,
        docPath: doc.path,
        action: "unmatched",
        note: "No record with this ref in this tenant — ignored (refs are tenant-scoped).",
      });
      continue;
    }

    let toStatus = record.status;
    let action: SyncMatch["action"] = "unchanged";

    if (doc.archived && doc.status === "Archived") {
      if (canApplyDocStatus(record.status, "Archived")) {
        toStatus = "Archived";
        action = "archived";
      } else {
        action = "blocked";
      }
    } else if (doc.status === "Built") {
      if (canApplyDocStatus(record.status, "Built")) {
        toStatus = "Built";
        action = "promoted";
      } else if (record.status === "Built") {
        action = "unchanged";
      } else {
        action = "blocked";
      }
    }

    const pathChanged = record.handover_path !== doc.path;
    if (pathChanged && action === "unchanged") action = "repointed";

    if (apply) {
      const now = new Date().toISOString();
      if (toStatus !== record.status) {
        const archivedAt = toStatus === "Archived" ? record.archived_at ?? now : null;
        run("UPDATE enhancements SET status = ?, archived_at = ?, handover_path = ?, updated_at = ? WHERE id = ?", [
          toStatus,
          archivedAt,
          doc.path,
          now,
          record.id,
        ]);
      } else if (pathChanged) {
        run("UPDATE enhancements SET handover_path = ?, updated_at = ? WHERE id = ?", [doc.path, now, record.id]);
      }
      if (action === "archived" || action === "promoted" || action === "repointed") {
        recordAudit({
          tenantId: tenant.id,
          actor: "docs-sync",
          action: `enhancement.sync_${action}`,
          subject: record.ref,
          before: { status: record.status, handover_path: record.handover_path },
          after: { status: toStatus, handover_path: doc.path },
          meta: { source: doc.path },
        });
      }
    }

    matches.push({
      tenantSlug: tenant.slug,
      ref: doc.ref,
      docPath: doc.path,
      action,
      enhancementId: record.id,
      fromStatus: record.status,
      toStatus: action === "blocked" ? record.status : toStatus,
      note: action === "blocked" ? `Status ${record.status} is protected from ${doc.status} docs.` : undefined,
    });
  }

  // Records whose linked file no longer appears are left alone on purpose: a deleted
  // repo file must never silently rewrite history.
  return matches;
}

const LOCAL_REPORT_DIR = ".tmp";

/** Lazy (not module-level) so tests and env overrides can flip it per call. */
function serverless(): boolean {
  return Boolean(process.env.VERCEL) || Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);
}

function writeReport(report: SyncReport) {
  try {
    // Serverless bundles are read-only; the repo report path would throw EROFS.
    const dir = serverless() ? "/tmp/enhancements/.tmp" : resolve(process.cwd(), LOCAL_REPORT_DIR);
    mkdirSync(dir, { recursive: true });
    const lines = [
      "# Enhancement docs sync",
      "",
      `- Ran at: ${report.ranAt}`,
      `- Mode: ${report.mode}`,
      `- Archived: ${report.counts.archived}`,
      `- Promoted: ${report.counts.promoted}`,
      `- Re-pointed: ${report.counts.repointed}`,
      `- Unchanged: ${report.counts.unchanged}`,
      `- Unmatched: ${report.counts.unmatched}`,
      `- Blocked: ${report.counts.blocked}`,
      "",
      "## Tenants",
      "",
      "| Tenant | Repo | Docs | Note |",
      "| --- | --- | --- | --- |",
      ...report.tenants.map((t) => `| ${t.slug} | ${t.repo || "—"} | ${t.fetched} | ${t.error ?? "ok"} |`),
      "",
      "## Matches",
      "",
      "| Tenant | Ref | Doc | Action | Status |",
      "| --- | --- | --- | --- | --- |",
      ...report.matches.map(
        (m) => `| ${m.tenantSlug} | ${m.ref} | ${m.docPath} | ${m.action} | ${m.fromStatus ?? "—"} → ${m.toStatus ?? "—"} |`,
      ),
      "",
      ...(report.errors.length ? ["## Errors", "", ...report.errors.map((e) => `- ${e}`), ""] : []),
    ];
    writeFileSync(join(dir, "enhancement-docs-sync.md"), lines.join("\n"), "utf8");
  } catch {
    /* reporting must never break a sync */
  }
}

export type SyncOptions = { apply?: boolean; report?: boolean };

/** Full sync across every tenant. Safe to call at server start and from the CLI. */
export async function syncEnhancementDocs(options: SyncOptions = {}): Promise<SyncReport> {
  const apply = options.apply ?? true;
  const roots = process.env.HANDOVER_SCAN_ROOT ? [process.env.HANDOVER_SCAN_ROOT] : [];
  const network = githubConfigured();
  const report: SyncReport = {
    ranAt: new Date().toISOString(),
    mode: network ? "network" : roots.length > 0 ? "local" : "none",
    tenants: [],
    matches: [],
    counts: { archived: 0, promoted: 0, repointed: 0, unchanged: 0, unmatched: 0, blocked: 0 },
    errors: [],
  };

  for (const tenant of listTenants()) {
    let docs: DocRecord[] = [];
    let error: string | undefined;
    if (network) {
      const remote = await fetchRemoteDocs(tenant);
      docs = remote.docs;
      error = remote.error;
      if (remote.error) report.errors.push(`${tenant.slug}: ${remote.error}`);
      if (docs.length === 0 && roots.length > 0) docs = scanLocalDocs(tenant);
    } else if (roots.length > 0) {
      const found: DocRecord[] = [];
      for (const root of roots) found.push(...scanLocalDocs(tenant, root));
      docs = found;
    }

    let matches: SyncMatch[] = [];
    if (docs.length > 0) {
      matches = reconcile(tenant, docs, { apply });
      for (const match of matches) {
        if (match.action in report.counts) {
          report.counts[match.action as keyof SyncReport["counts"]] += 1;
        }
      }
      report.matches.push(...matches);
    }
    report.tenants.push({
      slug: tenant.slug,
      repo: tenant.github_repo,
      fetched: docs.length,
      docsPath: normaliseDir(tenant.handover_dir),
      error,
    });
  }

  if (options.report !== false) writeReport(report);
  return report;
}

let started = false;

/** Called from instrumentation.ts so a deploy reconciles on boot. */
export async function startDocSyncOnce(): Promise<void> {
  if (started) return;
  started = true;
  if (!docsSyncEnabled()) return;
  try {
    await syncEnhancementDocs();
  } catch {
    /* boot must never fail because GitHub is unreachable */
  }
}

/** Count of records currently claiming a handover document. */
export function handoverLinkedCount(tenantId: string): number {
  const row = get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM enhancements WHERE tenant_id = ? AND handover_path <> ''",
    [tenantId],
  );
  return Number(row?.n ?? 0);
}

export type { Status };
