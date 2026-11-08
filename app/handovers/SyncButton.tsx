"use client";

import { useState, useTransition } from "react";

import { syncDocsAction, type SyncActionResult } from "../actions/handovers.ts";

export function SyncButton({ canEdit }: { canEdit: boolean }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<SyncActionResult | null>(null);

  if (!canEdit) {
    return <span className="tag">sync requires editor</span>;
  }

  return (
    <div className="stack" style={{ gap: 8, alignItems: "flex-end" }}>
      <button
        type="button"
        className="btn-sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            try {
              setResult(await syncDocsAction());
            } catch {
              setResult({ ok: false, message: "Sync failed to start." });
            }
          })
        }
      >
        {pending ? "Syncing…" : "↻ Sync docs"}
      </button>
      {result ? (
        <div className={`notice ${result.ok ? "ok" : "error"}`} style={{ maxWidth: 460, padding: "7px 10px" }}>
          <span className="icon">{result.ok ? "✓" : "!"}</span>
          <div className="tiny">{result.message}</div>
        </div>
      ) : null}
    </div>
  );
}
