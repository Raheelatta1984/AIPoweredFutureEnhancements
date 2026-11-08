/**
 * npm run enhancement:sync [-- --dry-run]
 * Reconciles repo-side handover docs with in-app statuses and writes
 * .tmp/enhancement-docs-sync.md. ENHANCEMENT_DOC_SYNC=false skips the run.
 */
import { docsSyncEnabled, syncEnhancementDocs } from "../lib/docs-sync.ts";

const dryRun = process.argv.includes("--dry-run");

if (!docsSyncEnabled()) {
  console.log("[enhancement:sync] ENHANCEMENT_DOC_SYNC=false — skipped.");
  process.exit(0);
}

const report = await syncEnhancementDocs({ apply: !dryRun });
console.log(`[enhancement:sync] mode=${report.mode}${dryRun ? " (dry run)" : ""}`);
for (const tenant of report.tenants) {
  console.log(`  - ${tenant.slug}: ${tenant.fetched} doc(s) from ${tenant.repo || "—"}${tenant.error ? ` — ${tenant.error}` : ""}`);
}
const { archived, promoted, repointed, unmatched, blocked } = report.counts;
console.log(`  archived=${archived} promoted=${promoted} repointed=${repointed} unmatched=${unmatched} blocked=${blocked}`);
console.log("  report: .tmp/enhancement-docs-sync.md");
process.exit(0);
