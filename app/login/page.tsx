import { redirect } from "next/navigation";

import { LoginForm } from "./LoginForm.tsx";
import { DEMO_PASSWORD } from "../../lib/flags.ts";
import { ensureBootReady } from "../../lib/boot.ts";
import { currentUser } from "../../lib/session.ts";
import { listTenants } from "../../lib/tenants.ts";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  // Login is the first page anyone sees: make sure the demo hub exists before listing it.
  await ensureBootReady();
  const user = await currentUser();
  if (user) redirect("/");

  const tenants = listTenants();
  const demoAccounts = [
    { email: "amara.okafor@hub.demo", name: "Amara Okafor", role: "admin", note: "hub-level · switches tenants" },
    { email: "priya.raman@hub.demo", name: "Priya Raman", role: "exec", note: "hub-level · audit + read" },
    { email: "lachlan.wu@qa.demo", name: "Lachlan Wu", role: "manager", note: "QA · audit trail" },
    { email: "sofia.marino@qa.demo", name: "Sofia Marino", role: "editor", note: "QA · can submit + vote" },
    { email: "hana.sato@qa.demo", name: "Hana Sato", role: "viewer", note: "QA · read-only" },
    { email: "noah.bennett@northwind.demo", name: "Noah Bennett", role: "editor", note: "Northwind · separate tenant" },
  ];

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-left">
          <div className="row">
            <span className="brand-mark">FE</span>
            <h1 style={{ fontSize: 23 }}>Future Enhancements</h1>
            <span className="sid">tab.login</span>
          </div>
          <p className="muted small">
            A standalone, multi-tenant intake hub. Every connected application is pure data — add a tenant, paste its
            stable-ID catalogue and keyword map, and it can capture proposals immediately. Approved handovers are
            published into the consuming repository as Markdown, where git becomes the durable record.
          </p>
          <div className="row tight" style={{ marginBottom: 2 }}>
            <span className="small strong">Connected tenants</span>
            <span className="sid">sec.login.tenants</span>
            <span className="tiny dim">apps this hub already serves — not your GitHub repositories</span>
          </div>
          <div className="grid cols-2" style={{ gap: 10 }}>
            {tenants.map((tenant) => (
              <div key={tenant.id} className="card flat" style={{ padding: 12 }}>
                <div className="row tight" style={{ marginBottom: 4 }}>
                  <span className="badge-dot" style={{ background: tenant.colour }} />
                  <span className="strong small">{tenant.name}</span>
                </div>
                <div className="tiny dim mono">{tenant.github_repo || "no repo linked"}</div>
                <div className="tiny dim" style={{ marginTop: 4 }}>
                  {tenant.areas.join(" · ")}
                </div>
              </div>
            ))}
          </div>
          <div className="notice info" role="note">
            <span className="icon">i</span>
            <div>
              <strong>Looking for your GitHub projects?</strong> Sign in as an admin (Amara) and open{" "}
              <span className="mono">/tenants</span> — the repository picker lives there, behind authentication, because
              it needs the hub&apos;s GitHub token. It cannot be shown on this public page.
            </div>
          </div>
          <div className="tiny dim">
            Local, deterministic drafting — no model calls, so proposal text never leaves this server.
          </div>
        </div>
        <div className="login-right">
          <LoginForm demoAccounts={demoAccounts} demoPassword={DEMO_PASSWORD} />
        </div>
      </div>
    </div>
  );
}
