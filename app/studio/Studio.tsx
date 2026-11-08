"use client";

import { useActionState, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { submitProposalAction, type SubmitState } from "../actions/studio.ts";
import {
  DRAFT_FIELDS,
  MIN_DRAFT_CHARS,
  draftAll,
  type DraftField,
  type DraftTenant,
} from "../../lib/ai.ts";

type CatalogueChip = { id: string; label: string; kind: string; hint: string };

const FIELD_META: Record<DraftField, { label: string; help: string; rows: number }> = {
  title: { label: "Title", help: "Short, verb-first headline", rows: 1 },
  brief: { label: "Brief", help: "Why this matters, in two sentences", rows: 3 },
  requirements: { label: "Requirements", help: "What must be true when it ships", rows: 5 },
  impacts: { label: "Impacts", help: "What it touches / what must not break", rows: 2 },
  expectedOutcome: { label: "Expected outcome", help: "The change in behaviour", rows: 2 },
  successCriteria: { label: "Success criteria", help: "How you will know it worked", rows: 4 },
  sections: { label: "App sections", help: "Stable IDs from this tenant's catalogue", rows: 0 },
  markdown: { label: "Markdown narrative", help: "Long-form body for the handover doc", rows: 6 },
  outcome: { label: "Outcome statement", help: "One line for the board", rows: 2 },
};

const FIELD_ORDER: DraftField[] = [
  "title",
  "brief",
  "requirements",
  "impacts",
  "expectedOutcome",
  "successCriteria",
  "sections",
  "markdown",
  "outcome",
];

const EMPTY_VALUES = Object.fromEntries(FIELD_ORDER.map((f) => [f, ""])) as Record<DraftField, string>;
const EMPTY_OPTIONS = Object.fromEntries(DRAFT_FIELDS.map((f) => [f, [] as string[]])) as Record<DraftField, string[]>;

const DEBOUNCE_MS = 700;

export function Studio({
  tenantName,
  tenantSlug,
  draftTenant,
  catalogue,
  canSubmit,
}: {
  tenantName: string;
  tenantSlug: string;
  draftTenant: DraftTenant;
  catalogue: CatalogueChip[];
  canSubmit: boolean;
}) {
  const [state, formAction, pending] = useActionState<SubmitState, FormData>(submitProposalAction, {});
  const [raw, setRaw] = useState("");
  const [auto, setAuto] = useState(true);
  const [drafting, setDrafting] = useState(false);
  const [options, setOptions] = useState<Record<DraftField, string[]>>(EMPTY_OPTIONS);
  const [values, setValues] = useState<Record<DraftField, string>>(EMPTY_VALUES);
  const [owned, setOwned] = useState<Set<DraftField>>(new Set());
  const [accepted, setAccepted] = useState<Set<DraftField>>(new Set());
  const [sections, setSections] = useState<string[]>([]);
  const [area, setArea] = useState("");
  const [seeds, setSeeds] = useState<Record<DraftField, number>>(
    Object.fromEntries(DRAFT_FIELDS.map((f) => [f, 0])) as Record<DraftField, number>,
  );
  const [lastDrafted, setLastDrafted] = useState<string>("");
  const [keywords, setKeywords] = useState<string[]>([]);

  const rawRef = useRef(raw);
  rawRef.current = raw;

  const length = raw.trim().length;
  const tooShort = length < MIN_DRAFT_CHARS;

  /** Runs the engine for every field not yet authored by a human. */
  const runDraft = useCallback(
    (text: string) => {
      const result = draftAll(text, draftTenant, 0);
      setKeywords(result.keywords);
      if (result.fields.title.length > 0 && result.area) setArea((current) => current || result.area);
      setOptions((prev) => {
        const next = { ...prev };
        for (const field of DRAFT_FIELDS) {
          // Author-owned fields never get their suggestions overwritten.
          if (ownedRef.current.has(field)) continue;
          next[field] = result.fields[field];
        }
        return next;
      });
      setLastDrafted(new Date().toISOString());
    },
    [draftTenant],
  );

  const ownedRef = useRef(owned);
  ownedRef.current = owned;

  // Debounced live drafting: only once the description is meaningful.
  useEffect(() => {
    if (!auto) return;
    if (length < MIN_DRAFT_CHARS) {
      setOptions(EMPTY_OPTIONS);
      return;
    }
    setDrafting(true);
    const handle = setTimeout(() => {
      runDraft(rawRef.current);
      setDrafting(false);
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(handle);
      setDrafting(false);
    };
  }, [raw, auto, length, runDraft]);

  const reroll = (field: DraftField) => {
    const nextSeed = seeds[field] + 1;
    setSeeds((prev) => ({ ...prev, [field]: nextSeed }));
    const result = draftAll(raw, draftTenant, nextSeed);
    setOptions((prev) => ({ ...prev, [field]: result.fields[field] }));
  };

  const accept = (field: DraftField, value: string) => {
    if (field === "sections") {
      const known = new Set(catalogue.map((c) => c.id));
      const ids = value
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter((s) => known.has(s));
      setSections(ids);
      setValues((prev) => ({ ...prev, sections: ids.join(", ") }));
    } else {
      setValues((prev) => ({ ...prev, [field]: value }));
    }
    setOwned((prev) => {
      const next = new Set(prev);
      next.delete(field);
      return next;
    });
    setAccepted((prev) => new Set(prev).add(field));
  };

  const typeInto = (field: DraftField, value: string) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    setOwned((prev) => new Set(prev).add(field));
    setAccepted((prev) => {
      const next = new Set(prev);
      next.delete(field);
      return next;
    });
  };

  const fillAll = () => {
    if (tooShort) return;
    const result = draftAll(raw, draftTenant, 0);
    const nextValues = { ...values };
    const nextAccepted = new Set(accepted);
    for (const field of FIELD_ORDER) {
      if (owned.has(field)) continue;
      const first = result.fields[field][0];
      if (!first) continue;
      nextValues[field] = first;
      nextAccepted.add(field);
      if (field === "sections") {
        const known = new Set(catalogue.map((c) => c.id));
        setSections(first.split(/[,\s]+/).filter((id) => known.has(id)));
      }
    }
    setValues(nextValues);
    setAccepted(nextAccepted);
    setOptions(result.fields);
    setKeywords(result.keywords);
    if (result.area) setArea(result.area);
  };

  const clearDraft = () => {
    setValues(EMPTY_VALUES);
    setOptions(EMPTY_OPTIONS);
    setOwned(new Set());
    setAccepted(new Set());
    setSections([]);
    setArea("");
  };

  const toggleSection = (id: string) => {
    setSections((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
    setOwned((prev) => new Set(prev).add("sections"));
  };

  const aiFieldList = useMemo(() => FIELD_ORDER.filter((field) => accepted.has(field) && values[field]), [accepted, values]);
  const sectionValue = sections.join(", ");

  return (
    <form action={formAction} className="stack">
      {/* Hidden inputs the server action reads. raw_text mirrors the textarea so
          "Fill all" / submit never sees an empty key. */}
      <input type="hidden" name="raw_text" value={raw} />
      <input type="hidden" name="sections" value={sectionValue} />
      {aiFieldList.map((field) => (
        <input key={field} type="hidden" name="ai_fields" value={field} />
      ))}

      <div className="studio-grid">
        <div className="stack">
          <section className="card">
            <div className="card-head">
              <h2>
                What needs to change? <span className="sid">sec.studio-raw</span>
              </h2>
              <div className="spacer" />
              <span className="tiny dim mono">{tenantSlug}</span>
            </div>
            <div className="raw-box">
              <textarea
                value={raw}
                onChange={(event) => setRaw(event.target.value)}
                placeholder={`e.g. "We need a quarter-by-quarter audit readiness trend on the overview so regional managers stop exporting the report every month."`}
                aria-label="What needs to change?"
              />
            </div>
            <div className="draft-status" style={{ marginTop: 8 }}>
              {tooShort ? (
                <span>
                  {MIN_DRAFT_CHARS - length > 0
                    ? `${MIN_DRAFT_CHARS - length} more character${MIN_DRAFT_CHARS - length === 1 ? "" : "s"} before drafting starts`
                    : "Drafting will start once the description is meaningful"}
                </span>
              ) : drafting ? (
                <span>✦ drafting…</span>
              ) : lastDrafted ? (
                <span>✦ options ready · {drafting ? "" : "deterministic, local"}</span>
              ) : (
                <span>waiting for input</span>
              )}
              <span className="spacer" />
              <span className="mono">{length} chars</span>
            </div>
            <div className="divider" />
            <div className="field-row">
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="area">Area</label>
                <select id="area" name="area" value={area} onChange={(event) => setArea(event.target.value)}>
                  <option value="">— none —</option>
                  {draftTenant.areas.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Automation</label>
                <div className="row tight" style={{ minHeight: 38 }}>
                  <span className={auto ? "tag mint" : "tag"}>{auto ? "on" : "off"}</span>
                  <button type="button" className="btn-sm btn-ghost" onClick={() => setAuto((v) => !v)}>
                    {auto ? "Disable" : "Enable"} auto-draft
                  </button>
                </div>
              </div>
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <button type="button" className="btn-sm" onClick={fillAll} disabled={tooShort}>
                ✦ Fill all fields
              </button>
              <button type="button" className="btn-sm btn-ghost" onClick={clearDraft}>
                Clear drafted values
              </button>
              <span className="spacer" />
              <span className="tiny dim">{aiFieldList.length} AI field(s)</span>
            </div>
            {keywords.length > 0 ? (
              <div className="row tight" style={{ marginTop: 10 }}>
                <span className="tiny dim">matched:</span>
                {keywords.map((keyword) => (
                  <span key={keyword} className="tag accent">
                    {keyword}
                  </span>
                ))}
              </div>
            ) : null}
          </section>

          <section className="card">
            <div className="card-head">
              <h2>
                Catalogue <span className="sid">sec.studio-catalogue</span>
              </h2>
              <div className="spacer" />
              <span className="tiny dim">{catalogue.length} stable IDs</span>
            </div>
            <div className="section-pick">
              {catalogue.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className={sections.includes(entry.id) ? "chip on" : "chip"}
                  onClick={() => toggleSection(entry.id)}
                  title={entry.hint || entry.label}
                >
                  {entry.id}
                </button>
              ))}
            </div>
            <p className="tiny dim" style={{ marginTop: 10 }}>
              Only this tenant&apos;s IDs are ever proposed — the engine can never invent a section that{" "}
              {tenantName} does not already own.
            </p>
          </section>

          <section className="card">
            <div className="card-head">
              <h2>
                Submit <span className="sid">sec.studio-submit</span>
              </h2>
            </div>
            {state.error ? <div className="notice error">{state.error}</div> : null}
            <p className="tiny dim" style={{ marginBottom: 12 }}>
              Submitting allocates the next sequential <span className="mono">ENH-####</span> for this tenant and writes
              the vault file. Fields accepted from a draft are recorded in <span className="mono">ai_fields</span> and
              echoed in the Markdown frontmatter.
            </p>
            <div className="row">
              <button type="submit" className="btn-primary" disabled={!canSubmit || pending}>
                {pending ? "Submitting…" : "Submit proposal"}
              </button>
              {!canSubmit ? <span className="tiny warn">read-only role</span> : null}
            </div>
          </section>
        </div>

        <div className="stack">
          {FIELD_ORDER.map((field) => {
            const meta = FIELD_META[field];
            const fieldOptions = options[field] ?? [];
            const isOwned = owned.has(field);
            const isAccepted = accepted.has(field);
            return (
              <section key={field} className={`field-card${isAccepted ? " ai" : ""}`}>
                <div className="label-row">
                  <span className="name">{meta.label}</span>
                  {isAccepted ? <span className="tag accent ai">✦ AI-drafted</span> : null}
                  {isOwned ? <span className="tag violet">author word</span> : null}
                  <span className="spacer" />
                  <span className="tiny dim">{meta.help}</span>
                </div>

                {field === "sections" ? (
                  <div className="row tight">
                    <span className="mono tiny">{sections.length > 0 ? sections.join(", ") : "— none selected —"}</span>
                  </div>
                ) : (
                  <textarea
                    value={values[field]}
                    rows={meta.rows}
                    name={field}
                    onChange={(event) => typeInto(field, event.target.value)}
                    placeholder={tooShort ? "Describe the change first…" : `Draft options appear below`}
                    disabled={!canSubmit}
                  />
                )}

                {fieldOptions.length > 0 ? (
                  <div className="options">
                    {fieldOptions.map((option, index) => (
                      <button
                        key={`${field}-${index}-${option.slice(0, 12)}`}
                        type="button"
                        className={values[field] === option ? "option chosen" : "option"}
                        onClick={() => accept(field, option)}
                        disabled={!canSubmit}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                ) : (
                  <span className="tiny dim">
                    {tooShort ? "— nothing drafted —" : auto ? "— no options for this text —" : "— automation off —"}
                  </span>
                )}

                <div className="row tight">
                  <button
                    type="button"
                    className="btn-sm btn-ghost"
                    onClick={() => reroll(field)}
                    disabled={tooShort || !canSubmit}
                  >
                    ↻ Re-roll
                  </button>
                  {fieldOptions[0] && values[field] !== fieldOptions[0] ? (
                    <button type="button" className="btn-sm btn-ghost" onClick={() => accept(field, fieldOptions[0])}>
                      Accept draft
                    </button>
                  ) : null}
                  {isOwned ? (
                    <button
                      type="button"
                      className="btn-sm btn-ghost"
                      onClick={() => {
                        setOwned((prev) => {
                          const next = new Set(prev);
                          next.delete(field);
                          return next;
                        });
                        const result = draftAll(raw, draftTenant, seeds[field]);
                        setOptions((prev) => ({ ...prev, [field]: result.fields[field] }));
                      }}
                      disabled={tooShort}
                    >
                      Allow drafts again
                    </button>
                  ) : null}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </form>
  );
}
