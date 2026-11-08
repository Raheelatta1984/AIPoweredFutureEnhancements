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

/* ------------------------------------------------------------- github credentials */

export async function saveGithubTokenAction(_prev: AdminState, formData: FormData): Promise<AdminState> {
  const user = await currentUser();
  if (!user?.canAdmin) return { error: "Only hub admins can change the GitHub token." };

  const { storeGithubToken, clearGithubToken, tokenState } = await import("../../lib/github-credentials.ts");
  const remove = String(formData.get("remove") ?? "") === "1";
  if (remove) {
    clearGithubToken();
    recordAudit({
      tenantId: user.tenantId,
      actor: user.person.email,
      action: "github.token_cleared",
      subject: "settings",
    });
    revalidatePath("/tenants");
    return { ok: true, message: "Stored token removed." };
  }

  const token = String(formData.get("token") ?? "").trim();
  if (!token) return { error: "Paste a token first." };
  const stored = storeGithubToken(token);
  if (!stored.ok) return { error: stored.error };

  // Prove it works before reporting success — a token that cannot read is useless.
  const { verifyToken, listRepos } = await import("../../lib/github.ts");
  const check = await verifyToken();
  recordAudit({
    tenantId: user.tenantId,
    actor: user.person.email,
    action: check.ok ? "github.token_saved" : "github.token_rejected",
    subject: "settings",
    meta: check.ok ? { login: check.login ?? null } : { error: check.error ?? null },
  });
  revalidatePath("/tenants");
  if (!check.ok) {
    return {
      ok: false,
      error: `Saved, but GitHub rejected it (${check.error ?? "unknown error"}). Check the scopes: repo (or public_repo) for publishing.`,
    };
  }
  const listed = await listRepos();
  const state = tokenState();
  return {
    ok: true,
    message: `Token verified as ${check.login ?? "a GitHub account"}${state.hint ? ` (${state.hint})` : ""} — ${listed.repos.length} repositories visible.`,
  };
}

/** One-click connect: create a tenant straight from a repository the token can see. */
export async function connectRepoAction(_prev: AdminState, formData: FormData): Promise<AdminState> {
  const user = await currentUser();
  if (!user?.canAdmin) return { error: "Only hub admins can connect repositories." };

  const fullName = String(formData.get("repo") ?? "").trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fullName)) return { error: 'Pick a repository (expected "owner/name").' };

  const { listRepos } = await import("../../lib/github.ts");
  const listed = await listRepos();
  if (!listed.ok) return { error: listed.error ?? "Could not read the repository list." };
  const repo = listed.repos.find((r) => r.fullName.toLowerCase() === fullName.toLowerCase());
  if (!repo) return { error: `${fullName} is not visible to the hub's token.` };

  const tenants = listTenants();
  if (tenants.some((t) => t.github_repo.toLowerCase() === repo.fullName.toLowerCase())) {
    return { error: `${repo.fullName} is already connected to a tenant.` };
  }

  // Prefill from the repository rather than inventing values: the name, a one-line
  // description, and a handover folder that exists in the repo if we can see one.
  const name = String(formData.get("name") ?? "").trim() || repo.name.replace(/[-_]/g, " ");
  const handoverDir = String(formData.get("handover_dir") ?? "").trim() || "docs/enhancements";
  const colour = String(formData.get("colour") ?? "#5b8cff").trim() || "#5b8cff";

  const existingSlugs = tenants.map((t) => t.slug);
  const slug = tenantSlugFrom(name, existingSlugs);
  const id = randomUUID();
  run(
    `INSERT INTO tenants (id, slug, name, description, github_repo, handover_dir, areas_json, keyword_map_json, colour, enabled, sort_order, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    [
      id,
      slug,
      name,
      repo.description ?? `Connected from ${repo.fullName}.`,
      repo.fullName,
      handoverDir.replace(/^\/+|\/+$/g, ""),
      JSON.stringify(["General"]),
      JSON.stringify({}),
      colour,
      100 + existingSlugs.length,
      new Date().toISOString(),
    ],
  );
  recordAudit({
    tenantId: user.tenantId,
    actor: user.person.email,
    action: "tenant.connected",
    subject: slug,
    after: { slug, name, repo: repo.fullName, handoverDir, private: repo.private },
  });
  revalidatePath("/tenants");
  revalidatePath("/");
  return {
    ok: true,
    message: `Connected ${repo.fullName} as "${name}" (${slug}). Publishing writes to ${handoverDir}/ on ${repo.defaultBranch}.`,
  };
}

/**
 * Bulk connect: paste many "owner/name" lines and create a tenant for each.
 *
 * Every name is checked against the token's live repository list first, so a typo
 * becomes a reported error instead of a tenant that can never publish.
 */
export async function connectReposAction(_prev: AdminState, formData: FormData): Promise<AdminState> {
  const user = await currentUser();
  if (!user?.canAdmin) return { error: "Only hub admins can connect repositories." };

  const { parseRepoLines, listRepos } = await import("../../lib/github.ts");
  const parsed = parseRepoLines(String(formData.get("repos") ?? ""));
  if (parsed.valid.length === 0) {
    return {
      error: parsed.invalid.length
        ? `None of those look like "owner/repo": ${parsed.invalid.slice(0, 5).join(", ")}`
        : "Paste at least one repository, one per line.",
    };
  }

  const listed = await listRepos();
  if (!listed.ok) return { error: listed.error ?? "Could not read the repository list." };
  const known = new Map(listed.repos.map((repo) => [repo.fullName.toLowerCase(), repo]));

  const handoverDir = (String(formData.get("handover_dir") ?? "").trim() || "docs/enhancements").replace(
    /^\/+|\/+$/g,
    "",
  );
  const tenants = listTenants();
  const taken = new Set(tenants.map((t) => t.github_repo.toLowerCase()).filter(Boolean));
  let slugs = tenants.map((t) => t.slug);

  const connected: string[] = [];
  const skipped: string[] = [];
  const unknown: string[] = [];

  for (const fullName of parsed.valid) {
    const key = fullName.toLowerCase();
    if (taken.has(key)) {
      skipped.push(`${fullName} (already connected)`);
      continue;
    }
    const repo = known.get(key);
    if (!repo) {
      unknown.push(fullName);
      continue;
    }
    const name = repo.name.replace(/[-_]/g, " ");
    const slug = tenantSlugFrom(name, slugs);
    slugs = [...slugs, slug];
    run(
      `INSERT INTO tenants (id, slug, name, description, github_repo, handover_dir, areas_json, keyword_map_json, colour, enabled, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [
        randomUUID(),
        slug,
        name,
        repo.description ?? `Connected from ${repo.fullName}.`,
        repo.fullName,
        handoverDir,
        JSON.stringify(["General"]),
        JSON.stringify({}),
        "#5b8cff",
        100 + slugs.length,
        new Date().toISOString(),
      ],
    );
    taken.add(key);
    connected.push(repo.fullName);
  }

  recordAudit({
    tenantId: user.tenantId,
    actor: user.person.email,
    action: "tenant.bulk_connected",
    subject: "tenants",
    after: { connected, skipped, unknown, handoverDir },
  });
  revalidatePath("/tenants");
  revalidatePath("/");

  if (connected.length === 0) {
    const why = [
      skipped.length ? `already connected: ${skipped.join(", ")}` : "",
      unknown.length ? `not visible to the token: ${unknown.join(", ")}` : "",
      parsed.invalid.length ? `not "owner/repo": ${parsed.invalid.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    return { error: `Nothing was connected. ${why}` };
  }

  const extras = [
    skipped.length ? `${skipped.length} already connected` : "",
    unknown.length ? `${unknown.length} not visible to the token` : "",
    parsed.invalid.length ? `${parsed.invalid.length} malformed` : "",
  ]
    .filter(Boolean)
    .join(", ");
  return {
    ok: true,
    message: `Connected ${connected.length} project${connected.length === 1 ? "" : "s"} → ${handoverDir}/: ${connected.join(", ")}${extras ? ` (${extras})` : ""}`,
  };
}
