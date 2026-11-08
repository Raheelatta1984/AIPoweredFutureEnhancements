# Decisions & rationale

Short records of the choices that shaped this hub, and what would have to be true to
revisit them.

---

## 1. The drafting engine is local and deterministic

**Decision.** `lib/ai.ts` is pure rules: sentence splitting, an imperative/modal vocabulary,
FNV-1a hashing for stable variation, and scoring against the tenant's own catalogue. No
network call, ever. `AI_PROVIDER` is documented as `local` and exists only to make that
explicit.

**Why.**
* **Privacy.** Proposal text is internal roadmap material. Sending it to a third-party model
  turns every draft into a data-processing decision. Here the text never leaves the server.
* **Reproducibility.** The same input produces the same options on every machine, so the
  behaviour is testable (`tests/studio.test.ts`) and reviewable. An LLM cannot be asserted
  against without a mock that proves nothing.
* **Cost and latency.** Drafting is free and instant, and works offline in CI.
* **It is a writing aid, not an oracle.** The engine proposes scaffolding and vocabulary; a
  human still owns the substance.

**Revisit if** drafting quality becomes the bottleneck. A provider could be plugged in behind
the same `draftField(rawText, tenant, field, seed)` signature, keeping the option/determinism
contract and the tenant-grounding rule — but it would need an explicit opt-in and a
redaction story first.

## 2. Options, not answers

**Decision.** Every field offers 2–3 candidate drafts. Nothing is auto-applied; the user
accepts or re-rolls per field.

**Why.** A single suggested answer anchors the author and quietly becomes "the" requirement.
Several options invite a choice and make the machine's contribution visible. It also keeps
the UI honest: the user is always one click from a different phrasing, so drafting feels like
a writing tool rather than an authority.

## 3. Author words outrank drafts

**Decision.** Typing in a field marks it author-owned; suggestions are never written over it
again. Only accepted drafts are recorded in `ai_fields`.

**Why.** The moment a suggestion overwrites a human sentence the tool becomes hostile. And
because accepted fields are echoed into the Markdown frontmatter (`ai_fields`) and the footer,
a reader of the document can always tell which text was machine-drafted.

## 4. Sections come only from the tenant's catalogue

**Decision.** Drafted sections are ranked from the tenant's own `section_catalogue`
(`+2`/overlapping word, `+5`/area match). The engine cannot emit an ID the app does not own.

**Why.** A plausible-looking invented section (`sec.audit-trends`) would send implementers to
a screen that does not exist. Restricting the vocabulary makes every draft actionable and
keeps the hub decoupled from any app's internals — it knows the IDs because the app told it,
not because the code knows the app.

## 5. Git is the durable record; the database is a cache

**Decision.** Every proposal is mirrored to `vault/<tenant>/ENH-####-slug.md`; approved
handovers live in the *consuming* repository. SQLite can be replaced by re-syncing.

**Why.** The database file is disposable infrastructure — it is excluded from git, it is
ephemeral on serverless, and it will be lost eventually. Markdown in git has review, history,
blame and a backup story already. Nothing important exists only in SQLite.

## 6. Publish failure is visible and blocks the move

**Decision.** `Building` publishes first; if publishing fails the stage does **not** change,
the error is shown to the operator, and an `enhancement.publish_failed` audit event is
written.

**Why.** The alternative — optimistically moving the status and retrying in the background —
produces the worst possible state: a record that claims a document exists where none does.
Statuses must never lie about where the document is. Refusing the move is annoying for one
person for ten seconds; a silent lie costs a day of confusion later.

## 7. Sessions are self-contained signed tokens

**Decision.** `feh_session` is an HMAC-SHA256-signed token carrying `sub / sid / iat / exp`,
with a `sessions` row purely as a revocation handle.

**Why.** Serverless cold starts and multiple instances make in-memory sessions useless, and a
database round-trip on every request for a stateless read is avoidable. The signature makes
the token unforgeable without a secret; the row makes it revocable (`revoked_at`) when
someone leaves or a password is rotated. Tampering and expiry are covered by tests.

## 8. Demo data is flagged, not assumed

**Decision.** `SEED_DEMO_DATA` (default `true` in dev) seeds two tenants, six people and four
proposals. `SEED_DEMO_DATA=false` starts an empty hub.

**Why.** A demo that is impossible to remove is a liability, and a production deployment that
silently ships `demo1234` accounts is a security incident. The flag makes the choice explicit,
`db:reset` refuses to run under `NODE_ENV=production`, and every seeded proposal is marked
with a `enh-seed-####` id so it is greppable.

## 9. Portable SQL and a thin, hand-written data layer

**Decision.** `db/migrations/001_init.sql` uses plain SQL (no vendor extensions), is embedded
into TypeScript at build time, and is executed through a ~150-line wrapper over `node:sqlite`.

**Why.** No ORM dependency, no code generation, no dialect lock-in: the schema is readable by
anyone and the same file runs on libSQL or any SQL engine with a file backend. Embedding the
SQL (rather than reading `.sql` at runtime) keeps serverless bundles self-contained.

Two details are load-bearing and easy to break:

* `node:sqlite` returns rows with a **null prototype**. Passing those into a React Server
  Component throws *"Only plain objects … can be passed to Client Components"*. `all()` and
  `get()` therefore copy every row with `{ ...row }`.
* Bound values must be `null | number | bigint | string | Uint8Array`. `normalise()` maps
  `undefined → null` and booleans → `0/1`, and parameters are spread positionally (passing an
  array is interpreted as *named* parameters and fails with "Unknown named parameter '0'").

## 10. Tenant isolation is enforced below the UI

**Decision.** Isolation lives in the data accessors (`getEnhancementForTenant`,
`assertTenantAccess`, scoped `UPDATE … WHERE tenant_id = ?`), not in page components.

**Why.** A UI that hides a button is not a security boundary. Cross-tenant reads and
mutations are refused at the data layer and covered by tests; hiding the vote button from
viewers is a *usability* decision on top of the server-side gate, not a substitute for it.

## 11. One durable issue per handover, not one per push

**Decision.** Intake embeds `<!-- handover: path -->` in the issue body and matches on that
marker, updating the existing issue instead of opening a new one.

**Why.** Handover documents get re-published (title edits, re-rolls). Without idempotency a
busy repo accumulates duplicate issues that nobody trusts, and closing them on archive
becomes guesswork.

## 12. A document may promote `Building → Built`, never skip stages

**Decision.** A `Built` handover promotes a record that is in `Building`, and nothing else. A
`Submitted` record stays `Submitted`.

**Why.** Repo documents describe implementation reality, but they are files a script can
write. Allowing a file to jump a proposal from `Submitted` to `Built` would let the pipeline
be rewritten without review. The one exception is archiving, which is a clean terminal state
— and even then `Rejected` is protected because a human rejection outranks a file.
