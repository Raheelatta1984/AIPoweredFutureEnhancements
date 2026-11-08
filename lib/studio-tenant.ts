/**
 * Shared (sync) helpers for the studio page. Kept out of "use server" modules
 * because pages need typed sync reads.
 */
export { catalogueFor, catalogueEntries, getTenantById, draftTenant as toDraftTenant } from "./tenants.ts";

import type { DraftTenant } from "./ai.ts";
import type { SectionCatalogueEntry, TenantView } from "./types.ts";

export function toDraftTenantInput(tenant: TenantView, catalogue: SectionCatalogueEntry[]): DraftTenant {
  return {
    slug: tenant.slug,
    name: tenant.name,
    areas: tenant.areas,
    keywordMap: tenant.keywordMap,
    catalogue: catalogue.map((entry) => ({
      id: entry.id,
      label: entry.label,
      kind: entry.kind,
      hint: entry.hint,
    })),
  };
}
