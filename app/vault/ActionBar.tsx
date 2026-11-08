"use client";

import { useState, useTransition } from "react";

import {
  deleteEnhancementAction,
  downloadVaultAction,
  regenerateAction,
  setStatusAction,
  voteAction,
  type ActionResult,
} from "../actions/enhancements.ts";
import type { EnhancementView } from "../../lib/types.ts";

type Props =
  | { item: EnhancementView; action: "vote" | "regenerate" | "download" }
  | { item: EnhancementView; action: "manage"; statuses: string[] };

export function ActionBar(props: Props) {
  const { item } = props;
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<ActionResult | null>(null);

  const run = (fn: (formData: FormData) => Promise<ActionResult>) => {
    const formData = new FormData();
    formData.set("id", item.id);
    startTransition(async () => {
      try {
        setFeedback(await fn(formData));
      } catch {
        setFeedback({ ok: false, message: "The action could not be completed." });
      }
    });
  };

  if (props.action === "vote") {
    return (
      <>
        <button
          type="button"
          className="btn-sm"
          disabled={pending}
          onClick={() => run(voteAction)}
          title="Add a demand signal (+1). Editor role required."
        >
          {pending ? "…" : "▲"} Vote
        </button>
        {feedback && !feedback.ok ? (
          <span className="tiny error" title={feedback.message}>
            {feedback.message?.slice(0, 80)}
          </span>
        ) : null}
      </>
    );
  }

  if (props.action === "regenerate") {
    return (
      <button
        type="button"
        className="btn-sm btn-ghost"
        disabled={pending}
        onClick={() => run(regenerateAction)}
        title="Rewrite the Markdown file from the database row"
      >
        {pending ? "…" : "↻"} Regenerate
      </button>
    );
  }

  if (props.action === "download") {
    return (
      <button
        type="button"
        className="btn-sm btn-ghost"
        disabled={pending}
        onClick={() => {
          const formData = new FormData();
          formData.set("id", item.id);
          startTransition(async () => {
            try {
              const file = await downloadVaultAction(formData);
              if (!file) return;
              const blob = new Blob([file.markdown], { type: "text/markdown;charset=utf-8" });
              const url = URL.createObjectURL(blob);
              const anchor = document.createElement("a");
              anchor.href = url;
              anchor.download = file.filename;
              document.body.appendChild(anchor);
              anchor.click();
              anchor.remove();
              URL.revokeObjectURL(url);
            } catch {
              setFeedback({ ok: false, message: "Download failed." });
            }
          });
        }}
      >
        ↓ Markdown
      </button>
    );
  }

  const statuses = props.action === "manage" ? props.statuses : [];
  return (
    <div className="stack" style={{ gap: 8, marginTop: 4 }}>
      <div className="row tight">
        <form
          action={(formData) => {
            startTransition(async () => {
              try {
                setFeedback(await setStatusAction(formData));
              } catch {
                setFeedback({ ok: false, message: "The status change could not be completed." });
              }
            });
          }}
          className="row tight"
        >
          <input type="hidden" name="id" value={item.id} />
          <select
            name="status"
            defaultValue={item.status}
            aria-label={`Status for ${item.ref}`}
            style={{ width: "auto", minWidth: 150, padding: "5px 30px 5px 9px", fontSize: 12.5 }}
          >
            {statuses.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
          <button type="submit" className="btn-sm" disabled={pending}>
            {pending ? "…" : "Move"}
          </button>
        </form>
        <span className="spacer" />
        <button
          type="button"
          className="btn-sm btn-ghost"
          disabled={pending}
          onClick={() => run(deleteEnhancementAction)}
          title="Remove the row and its vault file"
        >
          Delete
        </button>
      </div>
      {feedback ? (
        <div className={`notice ${feedback.ok ? "ok" : "error"}`} style={{ padding: "7px 10px" }}>
          <span className="icon">{feedback.ok ? "✓" : "!"}</span>
          <div className="tiny">{feedback.message}</div>
        </div>
      ) : null}
    </div>
  );
}
