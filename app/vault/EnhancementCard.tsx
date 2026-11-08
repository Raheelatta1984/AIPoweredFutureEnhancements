import { AiTag, StatusTag } from "../../components/ui.tsx";
import type { EnhancementView } from "../../lib/types.ts";
import { relativeTime, STATUSES } from "../../lib/rules.ts";
import { ActionBar } from "./ActionBar.tsx";

export function EnhancementCard({
  item,
  canEdit,
  highlight,
  tenantSlug,
}: {
  item: EnhancementView;
  canEdit: boolean;
  highlight: boolean;
  tenantSlug: string;
}) {
  const aiFields = item.aiFields.filter((f) => f !== "markdown");
  return (
    <article
      className="proposal"
      id={`enh-${item.id}`}
      style={highlight ? { borderColor: "rgba(79,209,165,0.6)", boxShadow: "0 0 0 2px rgba(79,209,165,0.15)" } : undefined}
    >
      <div className="head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="meta">
            <span className="mono tiny dim">{item.ref}</span>
            <StatusTag status={item.status} />
            {item.area ? <span className="tag">{item.area}</span> : null}
            {item.archived_at ? <span className="tag">archived {relativeTime(item.archived_at)}</span> : null}
          </div>
          <h3 className="title" style={{ marginTop: 6 }}>
            {item.title}
          </h3>
        </div>
        <span className="tiny dim nowrap">{relativeTime(item.created_at)}</span>
      </div>

      {item.brief ? <p className="body">{item.brief}</p> : null}

      {item.sections ? (
        <div className="row tight">
          {item.sections
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
            .map((id) => (
              <span key={id} className="sid">
                {id}
              </span>
            ))}
        </div>
      ) : null}

      {aiFields.length > 0 ? (
        <div className="row tight">
          <span className="tiny dim">AI-drafted:</span>
          {aiFields.map((field) => (
            <AiTag key={field} field={field} />
          ))}
        </div>
      ) : (
        <div className="tiny dim">All author-written.</div>
      )}

      <div className="row tight" style={{ justifyContent: "space-between" }}>
        <div className="row tight">
          {canEdit ? (
            <ActionBar item={item} action="vote" />
          ) : (
            <span className="vote readonly" title="Read-only role: the count is visible, voting is not.">
              ▲ {item.votes} demand
            </span>
          )}
          {canEdit ? (
            <span className="vote readonly" title="Demand signal">
              {item.votes} vote{item.votes === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>
        <div className="row tight">
          <ActionBar item={item} action="regenerate" />
          <ActionBar item={item} action="download" />
        </div>
      </div>

      <div className="tiny dim mono" style={{ wordBreak: "break-all" }}>
        {item.github_path || `vault/${tenantSlug}/…`}
      </div>
      {item.handover_path ? (
        <div className="tiny mono" style={{ color: "var(--mint)", wordBreak: "break-all" }}>
          handover → {item.handover_path}
        </div>
      ) : item.status === "Building" || item.status === "Built" ? (
        <div className="tiny warn">No handover document linked — run a sync from the Handovers tab.</div>
      ) : null}

      {canEdit ? <ActionBar item={item} action="manage" statuses={[...STATUSES]} /> : null}
    </article>
  );
}
