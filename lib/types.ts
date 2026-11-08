import type { Role } from "./roles.ts";

export type Tenant = {
  id: string;
  slug: string;
  name: string;
  description: string;
  github_repo: string;
  handover_dir: string;
  areas_json: string;
  keyword_map_json: string;
  colour: string;
  enabled: number;
  sort_order: number;
  created_at: string;
};

/** Tenant with JSON columns parsed for the UI. */
export type TenantView = Omit<Tenant, "areas_json" | "keyword_map_json"> & {
  areas: string[];
  keywordMap: Record<string, string>;
};

export type Person = {
  id: string;
  tenant_id: string | null;
  email: string;
  name: string;
  role: Role;
  password_hash: string;
  active: number;
  created_at: string;
};

export type PublicPerson = Omit<Person, "password_hash">;

export type Enhancement = {
  id: string;
  tenant_id: string;
  ref: string;
  title: string;
  brief: string;
  raw_text: string;
  requirements: string;
  impacts: string;
  expected_outcome: string;
  success_criteria: string;
  markdown: string;
  outcome: string;
  status: string;
  area: string;
  sections: string;
  ai_fields: string;
  votes: number;
  submitted_by: string;
  github_path: string;
  handover_path: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

/** Enhancement with ai_fields parsed into an array for rendering. */
export type EnhancementView = Omit<Enhancement, "ai_fields"> & {
  ai_fields: string[];
  aiFields: string[];
};

export type AuditEvent = {
  id: string;
  tenant_id: string | null;
  actor: string;
  action: string;
  subject: string;
  before_json: string | null;
  after_json: string | null;
  meta: string | null;
  at: string;
};

export type SectionCatalogueEntry = {
  tenant_id: string;
  id: string;
  label: string;
  kind: string;
  hint: string;
  sort_order: number;
};

export type Department = {
  id: string;
  tenant_id: string;
  name: string;
  sort_order: number;
};

export type SessionUser = {
  person: PublicPerson;
  tenantId: string | null; // active tenant (hub-level switcher result)
  tenants: TenantView[]; // tenants this person may see
  canSwitchTenant: boolean;
  canAdmin: boolean;
  canManage: boolean;
  canEdit: boolean;
  cookieTenantId: string | null;
};
