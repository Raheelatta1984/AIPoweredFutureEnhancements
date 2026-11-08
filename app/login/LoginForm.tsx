"use client";

import { useActionState, useState } from "react";

import { loginAction, type LoginState } from "../actions/auth.ts";

type DemoAccount = { email: string; name: string; role: string; note: string };

export function LoginForm({ demoAccounts, demoPassword }: { demoAccounts: DemoAccount[]; demoPassword: string }) {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(loginAction, {});
  const [email, setEmail] = useState("amara.okafor@hub.demo");
  const [password, setPassword] = useState(demoPassword);

  return (
    <>
      <div className="row tight">
        <h2>Sign in</h2>
        <span className="sid">tab.login.form</span>
      </div>
      <form action={formAction} className="stack" style={{ gap: 10 }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </div>
        {state.error ? <div className="notice error">{state.error}</div> : null}
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <div className="divider" />
      <div className="tiny dim">
        Demo accounts — all use <span className="mono">{demoPassword}</span>. Click one to fill the form.
      </div>
      <div className="demo-chips">
        {demoAccounts.map((account) => (
          <button
            key={account.email}
            type="button"
            className="demo-chip"
            onClick={() => {
              setEmail(account.email);
              setPassword(demoPassword);
            }}
          >
            <span className="who">{account.name}</span>
            <span className="role">{account.role}</span>
            <span className="tiny dim">{account.note}</span>
          </button>
        ))}
      </div>
    </>
  );
}
