/**
 * Audit trail helpers. Kept OUT of any "use server" module: those may only export
 * async functions, and `listAuditEvents` is a typed sync read used by the audit tab.
 */
import { randomUUID } from "node:crypto";

import { all, run } from "./db.ts";
import type { AuditEvent } from "./types.ts";

export type AuditInput = {
  tenantId?: string | null;
  actor?: string;
  action: string;
  subject?: string;
  before?: unknown;
  after?: unknown;
  meta?: unknown;
};

function serialise(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function recordAudit(input: AuditInput): void {
  run(
    `INSERT INTO audit_events (id, tenant_id, actor, action, subject, before_json, after_json, meta, at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      input.tenantId ?? null,
      input.actor ?? "system",
      input.action,
      input.subject ?? "",
      serialise(input.before),
      serialise(input.after),
      serialise(input.meta),
      new Date().toISOString(),
    ],
  );
}

export function listAuditEvents(tenantId: string | null, limit = 120): AuditEvent[] {
  if (tenantId) {
    return all<AuditEvent>(
      "SELECT * FROM audit_events WHERE tenant_id = ? ORDER BY at DESC LIMIT ?",
      [tenantId, limit],
    );
  }
  return all<AuditEvent>("SELECT * FROM audit_events ORDER BY at DESC LIMIT ?", [limit]);
}

export type AuditDiff = { key: string; before: unknown; after: unknown };

function parse(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : { value: parsed };
  } catch {
    return { value };
  }
}

/** Field-level diff for the before/after JSON panels. */
export function auditDiff(event: AuditEvent): AuditDiff[] {
  const before = parse(event.before_json);
  const after = parse(event.after_json);
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const out: AuditDiff[] = [];
  for (const key of [...keys].sort()) {
    const b = before?.[key];
    const a = after?.[key];
    if (JSON.stringify(b) === JSON.stringify(a)) continue;
    out.push({ key, before: b, after: a });
  }
  return out;
}
