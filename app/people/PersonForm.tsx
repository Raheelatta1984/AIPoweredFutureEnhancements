"use client";

import { useActionState } from "react";

import { createPersonAction, updatePersonAction, type AdminState } from "../actions/admin.ts";
import { ROLES, ROLE_LABELS } from "../../lib/roles.ts";
import type { Person, TenantView } from "../../lib/types.ts";

export function PersonForm({
  person,
  tenants,
  isSelf,
}: {
  person?: Person;
  tenants: TenantView[];
  isSelf?: boolean;
}) {
  const editing = Boolean(person);
  const [state, formAction, pending] = useActionState<AdminState, FormData>(
    editing ? updatePersonAction : createPersonAction,
    {},
  );
  const suffix = person?.id ?? "new";

  return (
    <form action={formAction} className="stack" style={{ gap: 10 }}>
      {person ? <input type="hidden" name="id" value={person.id} /> : null}

      {editing ? (
        <div className="small">
          <span className="strong">{person!.name}</span> <span className="mono tiny dim">{person!.email}</span>
        </div>
      ) : (
        <>
          <div className="field">
            <label htmlFor={`pname-${suffix}`}>Full name</label>
            <input id={`pname-${suffix}`} name="name" required placeholder="Jane Citizen" />
          </div>
          <div className="field">
            <label htmlFor={`pemail-${suffix}`}>Email</label>
            <input id={`pemail-${suffix}`} name="email" type="email" required placeholder="jane@example.com" />
          </div>
        </>
      )}

      <div className="field-row">
        <div className="field">
          <label htmlFor={`prole-${suffix}`}>Role</label>
          <select id={`prole-${suffix}`} name="role" defaultValue={person?.role ?? "viewer"} disabled={isSelf}>
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`ptenant-${suffix}`}>Home tenant</label>
          <select id={`ptenant-${suffix}`} name="tenant_id" defaultValue={person?.tenant_id ?? "hub"} disabled={isSelf}>
            <option value="hub">Hub — all tenants</option>
            {tenants.map((tenant) => (
              <option key={tenant.id} value={tenant.id}>
                {tenant.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="field">
        <label htmlFor={`ppass-${suffix}`}>
          {editing ? "Reset password (optional)" : "Initial password"}
        </label>
        <input
          id={`ppass-${suffix}`}
          name="password"
          type="password"
          minLength={editing ? 0 : 8}
          placeholder={editing ? "leave blank to keep" : "at least 8 characters"}
          required={!editing}
        />
      </div>

      {editing ? (
        <div className="check">
          <input
            id={`pactive-${suffix}`}
            type="checkbox"
            name="active"
            defaultChecked={person!.active === 1}
            disabled={isSelf}
          />
          <label htmlFor={`pactive-${suffix}`}>Active</label>
          {isSelf ? <span className="tiny warn">self-deactivation blocked</span> : null}
        </div>
      ) : null}

      {state.error ? <div className="notice error">{state.error}</div> : null}
      {state.ok ? <div className="notice ok">{state.message}</div> : null}

      <div className="row">
        <button type="submit" className={editing ? "btn-sm" : "btn-primary"} disabled={pending}>
          {pending ? "Saving…" : editing ? "Save" : "Add person"}
        </button>
      </div>
    </form>
  );
}
