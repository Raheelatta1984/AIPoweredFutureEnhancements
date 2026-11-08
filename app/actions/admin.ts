"use server";

import { revalidatePath } from "next/cache";

import { hashPassword, revokeAllForPerson } from "../../lib/auth.ts";
import { recordAudit } from "../../lib/audit.ts";
import { run } from "../../lib/db.ts";
import { tenantSlugFrom } from "../../lib/enhancements.ts";
import { isRole } from "../../lib/roles.ts";
import { currentUser } from "../../lib/session.ts";
import { getTenantById, listTenants, parseJson } from "../../lib/tenants.ts";
import { randomUUID } from "node:crypto";

export type AdminState = { ok?: boolean; error?: string; message?: string };

function parseAreas(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  const parsed = parseJson<unknown>(trimmed, null);
  if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === "string" && v.trim() !== "");
  return trimmed
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseKeywordMap(raw: string): Record<string, string> | null {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  const parsed = parseJson<unknown>(trimmed, null);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

/** Catalogue import: one `id | label | hint` (or comma/tab separated) per line. */
function parseCatalogue(raw: string): Array<{ id: string; label: string; hint: string }> {
  const rows: Array<{ id: string; label: string; hint: string }> = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const parts = trimmed.split(/\s*[|\t]\s*|\s*,\s*/);
    const id = parts[0]?.trim() ?? "";
    if (!/^(tab|sec)\.[A-Za-z0-9_.-]+$/.test(id)) continue;
    rows.push({ id, label: parts[1]?.trim() || id, hint: parts[2]?.trim() ?? "" });
  }
  return rows;
}

export async function createTenantAction(_prev: AdminState, formData: FormData): Promise<AdminState> {
  const user = await currentUser();
  if (!user?.canAdmin) return { error: "Only hub admins can add tenants." };

  const name = String(formData.get("name") ?? "").trim();
  const repo = String(formData.get("github_repo") ?? "").trim();
  const handoverDir = String(formData.get("handover_dir") ?? "").trim() || "docs/enhancements";
  const areas = parseAreas(String(formData.get("areas_json") ?? ""));
  const keywordMap = parseKeywordMap(String(formData.get("keyword_map_json") ?? ""));
  const catalogue = parseCatalogue(String(formData.get("catalogue") ?? ""));
  const colour = String(formData.get("colour") ?? "#5b8cff").trim() || "#5b8cff";

  if (!name) return { error: "Give the app a name." };
  if (repo && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    return { error: 'github_repo must look like "owner/repo".' };
  }
  if (keywordMap === null) return { error: "Keyword map must be a JSON object of { keyword: Area }." };

  const existingSlugs = listTenants().map((t) => t.slug);
  const slug = tenantSlugFrom(name, existingSlugs);
  const id = randomUUID();
  run(
    `INSERT INTO tenants (id, slug, name, description, github_repo, handover_dir, areas_json, keyword_map_json, colour, enabled, sort_order, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    [
      id,
      slug,
      name,
      String(formData.get("description") ?? "").trim(),
      repo,
      handoverDir.replace(/^\/+|\/+$/g, ""),
      JSON.stringify(areas),
      JSON.stringify(keywordMap),
      colour,
      100 + existingSlugs.length,
      new Date().toISOString(),
    ],
  );
  catalogue.forEach((entry, index) => {
    run(
      "INSERT OR REPLACE INTO section_catalogue (tenant_id, id, label, kind, hint, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
      [id, entry.id, entry.label, entry.id.startsWith("tab.") ? "tab" : "section", entry.hint, (index + 1) * 10],
    );
  });
  recordAudit({
    tenantId: user.tenantId,
    actor: user.person.email,
    action: "tenant.created",
    subject: slug,
    after: { slug, name, repo, handoverDir, areas, catalogue: catalogue.length },
  });
  revalidatePath("/tenants");
  revalidatePath("/");
  return { ok: true, message: `Added ${name} (${slug}) with ${catalogue.length} catalogue entries.` };
}

export async function updateTenantAction(_prev: AdminState, formData: FormData): Promise<AdminState> {
  const user = await currentUser();
  if (!user?.canAdmin) return { error: "Only hub admins can edit tenants." };
  const id = String(formData.get("id") ?? "");
  const tenant = getTenantById(id);
  if (!tenant) return { error: "Unknown tenant." };

  const enabled = formData.get("enabled") === "on" || formData.get("enabled") === "1" ? 1 : 0;
  const repo = String(formData.get("github_repo") ?? tenant.github_repo).trim();
  if (repo && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    return { error: 'github_repo must look like "owner/repo".' };
  }
  const handoverDir = String(formData.get("handover_dir") ?? tenant.handover_dir).trim() || "docs/enhancements";
  const areasRaw = formData.get("areas_json");
  const mapRaw = formData.get("keyword_map_json");
  const areas = areasRaw === null ? tenant.areas : parseAreas(String(areasRaw));
  const keywordMap = mapRaw === null ? tenant.keywordMap : parseKeywordMap(String(mapRaw));
  if (keywordMap === null) return { error: "Keyword map must be a JSON object of { keyword: Area }." };

  run(
    "UPDATE tenants SET name = ?, description = ?, github_repo = ?, handover_dir = ?, areas_json = ?, keyword_map_json = ?, enabled = ? WHERE id = ?",
    [
      String(formData.get("name") ?? tenant.name).trim() || tenant.name,
      String(formData.get("description") ?? tenant.description).trim(),
      repo,
      handoverDir.replace(/^\/+|\/+$/g, ""),
      JSON.stringify(areas),
      JSON.stringify(keywordMap),
      enabled,
      id,
    ],
  );

  const catalogue = parseCatalogue(String(formData.get("catalogue") ?? ""));
  if (catalogue.length > 0) {
    catalogue.forEach((entry, index) => {
      run(
        "INSERT OR REPLACE INTO section_catalogue (tenant_id, id, label, kind, hint, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
        [id, entry.id, entry.label, entry.id.startsWith("tab.") ? "tab" : "section", entry.hint, (index + 1) * 10],
      );
    });
  }

  recordAudit({
    tenantId: user.tenantId,
    actor: user.person.email,
    action: "tenant.updated",
    subject: tenant.slug,
    before: { repo: tenant.github_repo, handover_dir: tenant.handover_dir, enabled: tenant.enabled },
    after: { repo, handover_dir: handoverDir, enabled, addedCatalogue: catalogue.length },
  });
  revalidatePath("/tenants");
  return { ok: true, message: `Saved ${tenant.name}.` };
}

export async function createPersonAction(_prev: AdminState, formData: FormData): Promise<AdminState> {
  const user = await currentUser();
  if (!user?.canAdmin) return { error: "Only hub admins can add people." };

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim();
  const role = String(formData.get("role") ?? "viewer");
  const password = String(formData.get("password") ?? "");
  const homeTenant = String(formData.get("tenant_id") ?? "");

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Enter a valid email address." };
  if (!name) return { error: "Enter the person's name." };
  if (!isRole(role)) return { error: "Pick a valid role." };
  if (password.length < 8) return { error: "The initial password needs at least 8 characters." };

  const { findPersonByEmail } = await import("../../lib/auth.ts");
  if (findPersonByEmail(email)) return { error: "That email already has an account." };

  const tenantId = homeTenant && homeTenant !== "hub" ? getTenantById(homeTenant)?.id ?? null : null;
  const hash = await hashPassword(password);
  run(
    `INSERT INTO people (id, tenant_id, email, name, role, password_hash, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
    [randomUUID(), tenantId, email, name, role, hash, new Date().toISOString()],
  );
  recordAudit({
    tenantId: user.tenantId,
    actor: user.person.email,
    action: "person.created",
    subject: email,
    after: { email, name, role, homeTenant: tenantId },
  });
  revalidatePath("/people");
  revalidatePath("/tenants");
  return { ok: true, message: `Added ${name} as ${role}.` };
}

export async function updatePersonAction(_prev: AdminState, formData: FormData): Promise<AdminState> {
  const user = await currentUser();
  if (!user?.canAdmin) return { error: "Only hub admins can edit people." };
  const id = String(formData.get("id") ?? "");
  if (id === user.person.id) return { error: "You cannot change your own role or access level." };

  const { findPersonById } = await import("../../lib/auth.ts");
  const person = findPersonById(id);
  if (!person) return { error: "Unknown person." };

  const role = String(formData.get("role") ?? person.role);
  if (!isRole(role)) return { error: "Pick a valid role." };
  const home = String(formData.get("tenant_id") ?? "");
  const tenantId = home && home !== "hub" ? getTenantById(home)?.id ?? null : null;
  const active = formData.get("active") === "on" || formData.get("active") === "1" ? 1 : 0;
  const newPassword = String(formData.get("password") ?? "");

  run("UPDATE people SET role = ?, tenant_id = ?, active = ? WHERE id = ?", [role, tenantId, active, id]);
  if (newPassword) {
    run("UPDATE people SET password_hash = ? WHERE id = ?", [await hashPassword(newPassword), id]);
  }
  if (!active || newPassword) revokeAllForPerson(id);

  recordAudit({
    tenantId: user.tenantId,
    actor: user.person.email,
    action: active ? "person.updated" : "person.deactivated",
    subject: person.email,
    before: { role: person.role, homeTenant: person.tenant_id, active: person.active },
    after: { role, homeTenant: tenantId, active, passwordRotated: Boolean(newPassword) },
  });
  revalidatePath("/people");
  return { ok: true, message: `Saved ${person.name}.` };
}

/** Self-deactivate guard: an admin may never lock themselves out. */
export async function deactivateSelfAction(): Promise<AdminState> {
  const user = await currentUser();
  if (!user?.canAdmin) return { error: "Only hub admins can do that." };
  const row = await import("../../lib/auth.ts").then((m) => m.findPersonById(user.person.id));
  const admins = await import("../../lib/db.ts").then((m) =>
    m.get<{ n: number }>("SELECT COUNT(*) AS n FROM people WHERE role = 'admin' AND active = 1"),
  );
  if (Number(admins?.n ?? 0) <= 1) {
    return { error: "You are the last active admin — create another admin before deactivating yourself." };
  }
  void row;
  return { error: "Sign out and ask another admin to deactivate this account. Self-deactivation is blocked." };
}
