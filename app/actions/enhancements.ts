"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { recordAudit } from "../../lib/audit.ts";
import { deleteEnhancement, getEnhancementForTenant, incrementVotes, moveStatus, regenerateVaultFile } from "../../lib/enhancements.ts";
import { isStatus, type Status } from "../../lib/rules.ts";
import { requireUserAction } from "../../lib/session.ts";

export type ActionResult = { ok: boolean; message?: string };

const PATHS = ["/", "/vault", "/handovers"];

function revalidateAll() {
  for (const path of PATHS) revalidatePath(path);
}

/** Demand signal. Editor-gated on the server; the UI hides it from viewers. */
export async function voteAction(formData: FormData): Promise<ActionResult> {
  const guard = await requireUserAction();
  if (!guard.user) return { ok: false, message: guard.error };
  const user = guard.user;
  if (!user.tenantId) return { ok: false, message: "No tenant selected." };
  if (!user.canEdit) return { ok: false, message: "Viewers can see the demand count but cannot vote." };

  const id = String(formData.get("id") ?? "");
  const votes = incrementVotes(id, user.tenantId, user.person.email);
  if (votes === null) return { ok: false, message: "That proposal is not in the selected tenant." };
  revalidateAll();
  return { ok: true, message: `Demand signal raised to ${votes}.` };
}

/** Moves a record through the lifecycle; Building publishes the handover first. */
export async function setStatusAction(formData: FormData): Promise<ActionResult> {
  const guard = await requireUserAction();
  if (!guard.user) return { ok: false, message: guard.error };
  const user = guard.user;
  if (!user.tenantId) return { ok: false, message: "No tenant selected." };
  if (!user.canEdit) return { ok: false, message: "Your role cannot change status." };

  const id = String(formData.get("id") ?? "");
  const raw = String(formData.get("status") ?? "");
  if (!isStatus(raw)) return { ok: false, message: "Unknown status." };

  const result = await moveStatus(id, user.tenantId, raw as Status, user.person.email);
  revalidateAll();
  if (!result.ok) return { ok: false, message: result.error ?? "Status was not changed." };
  return {
    ok: true,
    message: result.published
      ? `Moved to ${raw} — handover published to the tenant repository.`
      : `Moved to ${raw}.`,
  };
}

export async function regenerateAction(formData: FormData): Promise<ActionResult> {
  const guard = await requireUserAction();
  if (!guard.user) return { ok: false, message: guard.error };
  const user = guard.user;
  if (!user.tenantId) return { ok: false, message: "Select a tenant first." };
  if (!user.canEdit) return { ok: false, message: "Your role cannot regenerate files." };
  const id = String(formData.get("id") ?? "");
  const path = regenerateVaultFile(id, user.tenantId, user.person.email);
  revalidateAll();
  return path
    ? { ok: true, message: `Rewrote ${path}.` }
    : { ok: false, message: "That proposal is not in the selected tenant." };
}

export async function deleteEnhancementAction(formData: FormData): Promise<ActionResult> {
  const guard = await requireUserAction();
  if (!guard.user) return { ok: false, message: guard.error };
  const user = guard.user;
  if (!user.tenantId) return { ok: false, message: "Select a tenant first." };
  if (!user.canEdit) return { ok: false, message: "Your role cannot delete proposals." };
  const id = String(formData.get("id") ?? "");
  const existing = getEnhancementForTenant(id, user.tenantId);
  if (!existing) return { ok: false, message: "That proposal is not in the selected tenant." };
  const removed = deleteEnhancement(id, user.tenantId, user.person.email);
  revalidateAll();
  return removed
    ? { ok: true, message: `Deleted ${existing.ref} and its vault file.` }
    : { ok: false, message: "Nothing was deleted." };
}

/** Downloads a vault file as an attachment (kept server-side so paths stay private). */
export async function downloadVaultAction(formData: FormData) {
  const guard = await requireUserAction();
  if (!guard.user) redirect("/login");
  const user = guard.user;
  if (!user.tenantId) redirect("/login");
  const id = String(formData.get("id") ?? "");
  const existing = getEnhancementForTenant(id, user.tenantId);
  if (!existing) redirect("/vault");

  const { buildEnhancementMarkdown } = await import("../../lib/vault.ts");
  const { getTenantById } = await import("../../lib/tenants.ts");
  const tenant = getTenantById(user.tenantId);
  if (!tenant) redirect("/vault");
  const markdown = buildEnhancementMarkdown(existing, tenant);
  recordAudit({
    tenantId: user.tenantId,
    actor: user.person.email,
    action: "enhancement.downloaded",
    subject: existing.ref,
  });
  const { vaultFileName } = await import("../../lib/rules.ts");
  return {
    filename: vaultFileName(existing.ref, existing.title),
    markdown,
  };
}
