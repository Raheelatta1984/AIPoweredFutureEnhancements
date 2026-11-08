"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import type { AdminState } from "../actions/admin.ts";

/**
 * A form whose action returns `AdminState`, with the result rendered next to it.
 *
 * This exists so the surrounding panel can stay a server component: it renders the
 * repository list (server data) and only the pending/result plumbing crosses the
 * boundary. Keep this file free of server-only imports — a client module that reaches
 * `node:crypto` or `node:fs` will fail `next build` with UnhandledSchemeError.
 */
export function ActionForm({
  action,
  className,
  style,
  children,
}: {
  action: (prev: AdminState, formData: FormData) => Promise<AdminState>;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const [state, formAction] = useActionState<AdminState, FormData>(action, {});
  return (
    <form action={formAction} className={className} style={style}>
      {children}
      {state.error ? (
        <p className="notice error" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.message ? (
        <p className="notice ok" role="status">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

/** Submit button that reflects the enclosing form's pending state. */
export function SubmitButton({
  children,
  pendingLabel,
  className = "btn-primary",
  disabled,
}: {
  children: React.ReactNode;
  pendingLabel: string;
  className?: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending || disabled}>
      {pending ? pendingLabel : children}
    </button>
  );
}
