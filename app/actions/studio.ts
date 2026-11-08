"use server";

import { redirect } from "next/navigation";

import { createEnhancement } from "../../lib/enhancements.ts";
import { currentUser } from "../../lib/session.ts";
import { DRAFT_FIELDS, type DraftField } from "../../lib/ai.ts";
import { isStatus } from "../../lib/rules.ts";

export type SubmitState = { error?: string };

const KNOWN_FIELDS = new Set<string>(DRAFT_FIELDS);

/**
 * Submits a proposal from the studio.
 * The studio form posts `raw_text` (hidden mirror of the textarea) and the area
 * select is named "area", so this action always sees populated keys.
 */
export async function submitProposalAction(_prev: SubmitState, formData: FormData): Promise<SubmitState> {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!user.tenantId) return { error: "Select a tenant before submitting a proposal." };
  if (!user.canEdit) return { error: "Your role is read-only, so it cannot submit proposals." };

  const rawText = String(formData.get("raw_text") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  if (!rawText && !title) return { error: "Describe what needs to change (or give the draft a title) before submitting." };

  const sections = formData.getAll("sections").map((s) => String(s).trim()).filter(Boolean);
  const aiFields = formData
    .getAll("ai_fields")
    .map((f) => String(f).trim())
    .filter((f) => KNOWN_FIELDS.has(f as DraftField));

  const finalTitle = title || deriveTitle(rawText);
  const statusRaw = String(formData.get("status") ?? "Submitted");

  try {
    const created = createEnhancement({
      tenantId: user.tenantId,
      title: finalTitle,
      brief: String(formData.get("brief") ?? ""),
      rawText,
      requirements: String(formData.get("requirements") ?? ""),
      impacts: String(formData.get("impacts") ?? ""),
      expectedOutcome: String(formData.get("expected_outcome") ?? ""),
      successCriteria: String(formData.get("success_criteria") ?? ""),
      markdown: String(formData.get("markdown") ?? ""),
      outcome: String(formData.get("outcome") ?? ""),
      area: String(formData.get("area") ?? ""),
      sections: sections.join(", "),
      aiFields,
      submittedBy: user.person.email,
      status: isStatus(statusRaw) ? statusRaw : "Submitted",
    });
    redirect(`/vault?highlight=${encodeURIComponent(created.id)}&created=${encodeURIComponent(created.ref)}`);
  } catch (error) {
    // redirect() throws by design; only real failures are reported.
    if (isRedirectError(error)) throw error;
    return { error: error instanceof Error ? error.message : "Could not submit the proposal." };
  }
  return {};
}

function deriveTitle(rawText: string): string {
  const first = rawText.split(/[.!?\n]/)[0]?.trim() ?? "Untitled enhancement";
  return first.length > 90 ? `${first.slice(0, 87)}…` : first || "Untitled enhancement";
}

function isRedirectError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "digest" in error &&
      typeof (error as { digest?: unknown }).digest === "string" &&
      (error as { digest: string }).digest.startsWith("NEXT_REDIRECT"),
  );
}
