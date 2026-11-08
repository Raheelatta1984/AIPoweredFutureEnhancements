/** Role ladder: viewer < editor < manager < exec < admin. */
export const ROLES = ["viewer", "editor", "manager", "exec", "admin"] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_RANK: Record<Role, number> = {
  viewer: 1,
  editor: 2,
  manager: 3,
  exec: 4,
  admin: 5,
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function roleRank(role: string): number {
  return isRole(role) ? ROLE_RANK[role] : 0;
}

/** Any role at editor or above may mutate enhancement content. */
export function canEditRole(role: string): boolean {
  return roleRank(role) >= ROLE_RANK.editor;
}

/** Manager and above: audit trail visibility. */
export function canManageRole(role: string): boolean {
  return roleRank(role) >= ROLE_RANK.manager;
}

/** Admin only: tenants + people administration. */
export function canAdminRole(role: string): boolean {
  return roleRank(role) >= ROLE_RANK.admin;
}

/** Hub-level (tenant_id = null) admin/exec may switch tenants. */
export function canSwitchTenantRole(role: string, tenantId: string | null): boolean {
  if (tenantId !== null) return false;
  return roleRank(role) >= ROLE_RANK.exec;
}

export const ROLE_LABELS: Record<Role, string> = {
  viewer: "Viewer",
  editor: "Editor",
  manager: "Manager",
  exec: "Exec",
  admin: "Admin",
};
