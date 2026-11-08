"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { recordAudit } from "../../lib/audit.ts";
import { docsSyncEnabled, syncEnhancementDocs, type SyncReport } from "../../lib/docs-sync.ts";
import { currentUser } from "../../lib/session.ts";

export type SyncActionResult = {
  ok: boolean;
  message: string;
  detail?: SyncReport;
};

/** Editor-gated reconciliation triggered from the Handovers tab. */
export async function syncDocsAction(): Promise<SyncActionResult> {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!user.canEdit) {
    return { ok: false, message: "Your role cannot run a sync (editor or above required)." };
  }
  if (!docsSyncEnabled()) {
    return { ok: false, message: "ENHANCEMENT_DOC_SYNC=false — sync is disabled for this deployment." };
  }
  const report = await syncEnhancementDocs({ apply: true });
  recordAudit({
    tenantId: user.tenantId,
    actor: user.person.email,
    action: "handovers.sync",
    subject: "docs-sync",
    meta: { mode: report.mode, counts: report.counts },
  });
  revalidatePath("/handovers");
  revalidatePath("/vault");
  revalidatePath("/");
  const total = report.counts.archived + report.counts.promoted + report.counts.repointed;
  return {
    ok: true,
    message:
      report.mode === "none"
        ? "Sync ran with no document source (set GITHUB_TOKEN or HANDOVER_SCAN_ROOT). Nothing changed."
        : `Sync complete (${report.mode}): ${total} change(s) — archived ${report.counts.archived}, promoted ${report.counts.promoted}, re-pointed ${report.counts.repointed}. Report: .tmp/enhancement-docs-sync.md`,
    detail: report,
  };
}
