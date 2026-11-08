import { AppShell, PageHead } from "../../components/Shell.tsx";
import { Card, Notice } from "../../components/ui.tsx";
import { auditDiff, listAuditEvents } from "../../lib/audit.ts";
import { isEphemeralDatabase } from "../../lib/db.ts";
import { requireManager } from "../../lib/session.ts";
import { relativeTime } from "../../lib/rules.ts";

export const dynamic = "force-dynamic";

const ACTION_TONE: Record<string, string> = {
  created: "mint",
  published: "mint",
  sync: "accent",
  failed: "rose",
  deleted: "rose",
  archived: "amber",
  login: "violet",
  logout: "violet",
};

function tone(action: string): string {
  for (const [needle, value] of Object.entries(ACTION_TONE)) {
    if (action.includes(needle)) return value;
  }
  return "";
}

export default async function AuditPage() {
  const user = await requireManager();
  const events = listAuditEvents(user.tenantId, 120);

  return (
    <AppShell user={user} active="audit" ephemeral={isEphemeralDatabase()}>
      <PageHead
        sid="tab.audit"
        user={user}
        title="Audit trail"
        subtitle="Every write records an event: submissions, publishes, refusals, status moves, votes, syncs, admin changes and sign-ins. Manager role or above — everyone else gets a 404."
      />

      <div className="stack">
        <Notice tone="info">
          Showing the most recent {events.length} event(s) for {user.tenants.find((t) => t.id === user.tenantId)?.name ?? "this tenant"}.
          Refused publishes are recorded explicitly so the trail never implies a document exists that does not.
        </Notice>

        <Card title="Events" sid="sec.audit-events">
          {events.length === 0 ? (
            <div className="empty">No events recorded yet.</div>
          ) : (
            <div className="stack" style={{ gap: 8 }}>
              {events.map((event) => {
                const diff = auditDiff(event);
                return (
                  <details key={event.id} className="field-card" style={{ padding: "9px 12px" }}>
                    <summary style={{ cursor: "pointer" }}>
                      <span className="row tight">
                        <span className={`tag ${tone(event.action)}`}>{event.action}</span>
                        {event.subject ? <span className="mono tiny">{event.subject}</span> : null}
                        <span className="tiny dim">{event.actor}</span>
                        <span className="spacer" />
                        <span className="tiny dim nowrap" title={event.at}>
                          {relativeTime(event.at)}
                        </span>
                      </span>
                    </summary>
                    <div className="stack" style={{ gap: 8, marginTop: 10 }}>
                      {diff.length > 0 ? (
                        <table>
                          <thead>
                            <tr>
                              <th>Field</th>
                              <th>Before</th>
                              <th>After</th>
                            </tr>
                          </thead>
                          <tbody>
                            {diff.map((row) => (
                              <tr key={row.key}>
                                <td className="mono tiny">{row.key}</td>
                                <td className="tiny error">{row.before === undefined ? "—" : JSON.stringify(row.before)}</td>
                                <td className="tiny ok">{row.after === undefined ? "—" : JSON.stringify(row.after)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : null}
                      <div className="grid cols-2" style={{ gap: 10 }}>
                        <div>
                          <div className="tiny dim" style={{ marginBottom: 4 }}>
                            before_json
                          </div>
                          <pre>{event.before_json ?? "null"}</pre>
                        </div>
                        <div>
                          <div className="tiny dim" style={{ marginBottom: 4 }}>
                            after_json
                          </div>
                          <pre>{event.after_json ?? "null"}</pre>
                        </div>
                      </div>
                      {event.meta ? (
                        <div>
                          <div className="tiny dim" style={{ marginBottom: 4 }}>
                            meta
                          </div>
                          <pre>{event.meta}</pre>
                        </div>
                      ) : null}
                    </div>
                  </details>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
