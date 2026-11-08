import { AppShell, PageHead } from "../../components/Shell.tsx";
import { Card, Notice } from "../../components/ui.tsx";
import { listPeople } from "../../lib/auth.ts";
import { isEphemeralDatabase } from "../../lib/db.ts";
import { canSwitchTenantRole, ROLE_LABELS, ROLE_RANK } from "../../lib/roles.ts";
import { requireAdmin } from "../../lib/session.ts";
import { listTenants } from "../../lib/tenants.ts";
import { PersonForm } from "./PersonForm.tsx";

export const dynamic = "force-dynamic";

export default async function PeoplePage() {
  const user = await requireAdmin();
  const people = listPeople();
  const tenants = listTenants();
  const tenantName = (id: string | null) => tenants.find((t) => t.id === id)?.name ?? "Hub (all tenants)";

  return (
    <AppShell user={user} active="people" ephemeral={isEphemeralDatabase()}>
      <PageHead
        sid="tab.people"
        user={user}
        title="People & roles"
        subtitle="Rank order: viewer < editor < manager < exec < admin. Editors submit, vote and move stages; managers see the audit trail; hub-level execs/admins can switch tenants. A person is only visible to the tenants they belong to."
      />

      <div className="stack">
        <Card title="Directory" sid="sec.people-directory">
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Home</th>
                  <th>Status</th>
                  <th>Edit</th>
                </tr>
              </thead>
              <tbody>
                {people.map((person) => (
                  <tr key={person.id}>
                    <td className="strong">
                      {person.name}
                      {person.id === user.person.id ? <span className="tag accent tiny" style={{ marginLeft: 6 }}>you</span> : null}
                    </td>
                    <td className="mono tiny">{person.email}</td>
                    <td>
                      <span className="tag">
                        {ROLE_LABELS[person.role as keyof typeof ROLE_LABELS] ?? person.role}
                        <span className="mono tiny dim">{ROLE_RANK[person.role as keyof typeof ROLE_RANK] ?? "?"}</span>
                      </span>
                    </td>
                    <td className="small">{tenantName(person.tenant_id)}</td>
                    <td>
                      {person.active ? <span className="tag mint">active</span> : <span className="tag rose">inactive</span>}
                    </td>
                    <td>
                      <details>
                        <summary className="tiny dim" style={{ cursor: "pointer" }}>
                          Edit
                        </summary>
                        <div style={{ marginTop: 10, minWidth: 300 }}>
                          <PersonForm person={person} tenants={tenants} isSelf={person.id === user.person.id} />
                        </div>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="grid cols-2">
          <Card title="Add a person" sid="sec.people-new">
            <PersonForm tenants={tenants} />
          </Card>

          <Card title="Role capabilities" sid="sec.people-roles" flat>
            <table>
              <thead>
                <tr>
                  <th>Role</th>
                  <th>Submit / vote / move</th>
                  <th>Audit</th>
                  <th>Tenants + people</th>
                  <th>Switch tenant</th>
                </tr>
              </thead>
              <tbody>
                {(["viewer", "editor", "manager", "exec", "admin"] as const).map((role) => (
                  <tr key={role}>
                    <td className="mono tiny">{role}</td>
                    <td>{ROLE_RANK[role] >= ROLE_RANK.editor ? "yes" : "—"}</td>
                    <td>{ROLE_RANK[role] >= ROLE_RANK.manager ? "yes" : "—"}</td>
                    <td>{role === "admin" ? "yes" : "—"}</td>
                    <td>{canSwitchTenantRole(role, null) ? "hub-level only" : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="divider" />
            <Notice tone="info">
              Self-deactivation is blocked: an admin cannot remove their own access, and the last active admin can never
              be deactivated.
            </Notice>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
