"use client";

import { useActionState } from "react";

import { createTenantAction, updateTenantAction, type AdminState } from "../actions/admin.ts";
import type { SectionCatalogueEntry, TenantView } from "../../lib/types.ts";

export function TenantForm({
  tenant,
  catalogue,
}: {
  tenant?: TenantView;
  catalogue?: SectionCatalogueEntry[];
}) {
  const editing = Boolean(tenant);
  const [state, formAction, pending] = useActionState<AdminState, FormData>(
    editing ? updateTenantAction : createTenantAction,
    {},
  );

  const catalogueText = (catalogue ?? [])
    .map((entry) => `${entry.id} | ${entry.label}${entry.hint ? ` | ${entry.hint}` : ""}`)
    .join("\n");

  return (
    <form action={formAction} className="stack" style={{ gap: 10 }}>
      {tenant ? <input type="hidden" name="id" value={tenant.id} /> : null}
      <div className="field-row">
        <div className="field">
          <label htmlFor={`name-${tenant?.id ?? "new"}`}>App name</label>
          <input
            id={`name-${tenant?.id ?? "new"}`}
            name="name"
            defaultValue={tenant?.name ?? ""}
            placeholder="e.g. Warehouse Picking App"
            required
          />
        </div>
        <div className="field">
          <label htmlFor={`repo-${tenant?.id ?? "new"}`}>GitHub repo</label>
          <input
            id={`repo-${tenant?.id ?? "new"}`}
            name="github_repo"
            defaultValue={tenant?.github_repo ?? ""}
            placeholder="owner/repo"
          />
        </div>
        <div className="field">
          <label htmlFor={`dir-${tenant?.id ?? "new"}`}>Handover folder</label>
          <input
            id={`dir-${tenant?.id ?? "new"}`}
            name="handover_dir"
            defaultValue={tenant?.handover_dir ?? "docs/enhancements"}
            placeholder="docs/enhancements"
          />
        </div>
      </div>

      <div className="field">
        <label htmlFor={`desc-${tenant?.id ?? "new"}`}>Description</label>
        <textarea
          id={`desc-${tenant?.id ?? "new"}`}
          name="description"
          defaultValue={tenant?.description ?? ""}
          rows={2}
          placeholder="One or two lines shown on the overview."
        />
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor={`areas-${tenant?.id ?? "new"}`}>Areas (JSON array or comma list)</label>
          <input
            id={`areas-${tenant?.id ?? "new"}`}
            name="areas_json"
            defaultValue={tenant ? JSON.stringify(tenant.areas) : '["Audit", "Calendar"]'}
          />
        </div>
        {tenant ? (
          <div className="field">
            <label>Colour</label>
            <div className="row tight" style={{ minHeight: 38 }}>
              <span className="badge-dot" style={{ background: tenant.colour }} />
              <span className="mono tiny">{tenant.colour}</span>
            </div>
          </div>
        ) : (
          <div className="field">
            <label htmlFor="colour-new">Colour</label>
            <input id="colour-new" name="colour" defaultValue="#5b8cff" />
          </div>
        )}
      </div>

      <div className="field">
        <label htmlFor={`map-${tenant?.id ?? "new"}`}>Keyword map (JSON: keyword → area)</label>
        <textarea
          id={`map-${tenant?.id ?? "new"}`}
          name="keyword_map_json"
          rows={4}
          defaultValue={
            tenant
              ? JSON.stringify(tenant.keywordMap, null, 2)
              : '{\n  "audit": "Audit",\n  "schedule": "Calendar"\n}'
          }
        />
        <span className="hint">
          Entries that are not strings are ignored; `/pattern/` keys are treated as regular expressions.
        </span>
      </div>

      <div className="field">
        <label htmlFor={`cat-${tenant?.id ?? "new"}`}>Stable-ID catalogue import</label>
        <textarea
          id={`cat-${tenant?.id ?? "new"}`}
          name="catalogue"
          rows={5}
          defaultValue={catalogueText}
          placeholder={"tab.overview | Overview | program health tiles\nsec.audit-log | Audit log"}
        />
        <span className="hint">
          One entry per line: <span className="mono">id | label | hint</span>. Existing IDs are replaced, new ones added.
        </span>
      </div>

      {tenant ? (
        <div className="check">
          <input id={`enabled-${tenant.id}`} type="checkbox" name="enabled" defaultChecked={tenant.enabled === 1} />
          <label htmlFor={`enabled-${tenant.id}`}>Enabled</label>
        </div>
      ) : null}

      {state.error ? <div className="notice error">{state.error}</div> : null}
      {state.ok ? <div className="notice ok">{state.message}</div> : null}

      <div className="row">
        <button type="submit" className={editing ? "btn-sm" : "btn-primary"} disabled={pending}>
          {pending ? "Saving…" : editing ? "Save tenant" : "Add tenant"}
        </button>
      </div>
    </form>
  );
}
