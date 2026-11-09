/**
 * Tenant + catalogue reads. Tenants are pure data: adding one never requires a
 * deploy in the consuming repository, and never touches this codebase.
 */
import { all, get } from "./db.ts";
import type { CatalogueEntry, DraftTenant } from "./ai.ts";
import type { SectionCatalogueEntry, Tenant, TenantView } from "./types.ts";

export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || value.trim() === "") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function toTenantView(row: Tenant): TenantView {
  const areas = parseJson<unknown>(row.areas_json, []);
  const keywordMap = parseJson<unknown>(row.keyword_map_json, {});
  const cleanAreas = Array.isArray(areas) ? areas.filter((a): a is string => typeof a === "string" && a.trim() !== "") : [];
  const cleanMap: Record<string, string> = {};
  if (keywordMap && typeof keywordMap === "object" && !Array.isArray(keywordMap)) {
    for (const [k, v] of Object.entries(keywordMap as Record<string, unknown>)) {
      if (typeof v === "string") cleanMap[k] = v;
    }
  }
  return { ...row, areas: cleanAreas, keywordMap: cleanMap };
}

export function listTenants(): TenantView[] {
  return all<Tenant>("SELECT * FROM tenants ORDER BY sort_order ASC, name ASC").map(toTenantView);
}

export function listEnabledTenants(): TenantView[] {
  return all<Tenant>("SELECT * FROM tenants WHERE enabled = 1 ORDER BY sort_order ASC, name ASC").map(toTenantView);
}

export function getTenantBySlug(slug: string): TenantView | null {
  const row = get<Tenant>("SELECT * FROM tenants WHERE slug = ?", [slug]);
  return row ? toTenantView(row) : null;
}

export function getTenantById(id: string): TenantView | null {
  const row = get<Tenant>("SELECT * FROM tenants WHERE id = ?", [id]);
  return row ? toTenantView(row) : null;
}

/** Hub-level staff may read every tenant; tenant-bound people only their own. */
export function visibleTenants(person: { tenant_id: string | null; role: string }): TenantView[] {
  if (person.tenant_id === null) return listTenants();
  const tenant = getTenantById(person.tenant_id);
  return tenant ? [tenant] : [];
}

/* ------------------------------------------------- remembered tenant selection */

/**
 * Cookie payload for "this is the tenant I am working in": `<person id>|<slug>~<id>`.
 *
 * Two fields are load-bearing:
 *
 *  • **the slug**, because every tenant is a row in a per-instance database and a rebuild
 *    gives the same application a *new id*. Matching on the id alone meant the remembered
 *    tenant no longer existed after a cold start and the hub quietly snapped back to the
 *    first tenant — which reads exactly like "the project I was working in disappeared".
 *    The slug survives a rebuild (seeded tenants are re-seeded with it, and re-connecting
 *    a repository derives the same slug), so selection is restored by slug when the id is
 *    unknown.
 *  • **the person id**, so a selection made by one account is never applied to another
 *    that signs in on the same browser, while a returning user keeps their tenant instead
 *    of being reset to the first one on every sign-in.
 */
export type TenantSelection = { personId: string | null; slug: string | null; id: string | null };

export function tenantCookieValue(personId: string, tenant: Pick<TenantView, "slug" | "id">): string {
  return `${personId}|${tenant.slug}~${tenant.id}`;
}

/**
 * Reads every shape this cookie has ever had (id-only, `slug~id`, `person|slug~id`).
 *
 * The separators are percent-encoded on the wire (`%7C`, and quotes may be added), so the
 * value is decoded first — a cookie the browser hands back verbatim must still parse.
 */
export function parseTenantCookieValue(value: string | null | undefined): TenantSelection | null {
  if (!value || !value.trim()) return null;
  let raw = value.trim();
  if (raw.startsWith('"') && raw.endsWith('"')) raw = raw.slice(1, -1);
  try {
    raw = decodeURIComponent(raw);
  } catch {
    /* a malformed escape is not worth a 500 — parse what we have */
  }
  const [head, ...rest] = raw.split("|");
  const selection = rest.length > 0 ? rest.join("|") : head;
  const personId = rest.length > 0 ? head.trim() || null : null;
  const [maybeSlug, maybeId] = selection.split("~");
  const hasSlug = selection.includes("~");
  const slug = hasSlug && /^[a-z0-9][a-z0-9-]*$/.test(maybeSlug) ? maybeSlug : null;
  const id = (hasSlug ? maybeId : maybeSlug)?.trim() || null;
  return { personId, slug, id };
}

/**
 * Resolves a stored selection against the tenants this request may see.
 *
 * Id first (exact), then slug (survives a rebuild). Null means "nothing to restore" —
 * the caller decides whether that is worth telling the operator about.
 */
export function tenantIdFromCookieValue(
  value: string | null | undefined,
  tenants: TenantView[],
  personId?: string,
): string | null {
  const parsed = parseTenantCookieValue(value);
  if (!parsed) return null;
  // A selection belongs to the account that made it.
  if (parsed.personId && personId && parsed.personId !== personId) return null;
  if (parsed.id) {
    const byId = tenants.find((tenant) => tenant.id === parsed.id);
    if (byId) return byId.id;
  }
  if (parsed.slug) {
    const bySlug = tenants.find((tenant) => tenant.slug === parsed.slug);
    if (bySlug) return bySlug.id;
  }
  return null;
}

export function catalogueFor(tenantId: string): SectionCatalogueEntry[] {
  return all<SectionCatalogueEntry>(
    "SELECT * FROM section_catalogue WHERE tenant_id = ? ORDER BY sort_order ASC, id ASC",
    [tenantId],
  );
}

export function catalogueEntries(tenantId: string): CatalogueEntry[] {
  return catalogueFor(tenantId).map((entry) => ({
    id: entry.id,
    label: entry.label,
    kind: entry.kind,
    hint: entry.hint,
  }));
}

/** The grounding payload handed to lib/ai.ts — tenant data only, nothing else. */
export function draftTenant(tenant: TenantView): DraftTenant {
  return {
    slug: tenant.slug,
    name: tenant.name,
    areas: tenant.areas,
    keywordMap: tenant.keywordMap,
    catalogue: catalogueEntries(tenant.id),
  };
}

export function departmentList(tenantId: string) {
  return all<{ id: string; tenant_id: string; name: string; sort_order: number }>(
    "SELECT * FROM departments WHERE tenant_id = ? ORDER BY sort_order ASC, name ASC",
    [tenantId],
  );
}
