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
