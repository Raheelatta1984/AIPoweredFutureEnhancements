# AGENTS.md — invariants

Hard rules for anyone (human or agent) changing this repository. Each one exists because
breaking it produces a failure that is expensive to diagnose. `docs/DECISIONS.md` explains
the reasoning; this file is the checklist.

---

## Data layer

1. **Never return a raw `node:sqlite` row.** Rows have a null prototype and crash React
   Server Component serialization. `lib/db.ts` copies every row with `{ ...row }` — do not
   bypass `all()` / `get()`.
2. **Never bind `undefined` or a boolean.** `normalise()` maps `undefined → null` and
   booleans → `0/1`. Bind positional parameters as arguments (`stmt.all(...params)`);
   passing an array is read as *named* parameters and fails with `Unknown named parameter`.
3. **Every query is tenant-scoped.** `SELECT`/`UPDATE`/`DELETE` on `enhancements`,
   `people`, `sticky_notes` and `section_catalogue` must include `tenant_id = ?`. Cross-tenant
   access is refused at the data layer, not hidden in the UI.
4. **Schema changes go through a new file** in `db/migrations/` (`002_*.sql`, …) and are
   picked up by `npm run db:embed` (runs in `predev` / `prebuild`). Keep the SQL portable —
   no vendor extensions.
5. **Every write records an audit event** via `recordAudit()` from `lib/audit.ts`, including
   failures (`enhancement.publish_failed`).

## Server / client boundaries

6. **`"use server"` modules may only export async functions.** Exporting a constant, a type
   helper or a sync function breaks `next build`. `listAuditEvents` and other sync helpers
   live in `lib/`, not in an actions file.
7. **`redirect()` throws — never swallow it.** Server actions that redirect must rethrow
   errors whose `digest` starts with `NEXT_REDIRECT` (see `app/actions/studio.ts`).
8. **The Studio form contract.** The raw textarea mirrors into a hidden `raw_text` input and
   the Area select is `name="area"`. Without both, the action receives empty keys and
   "Fill all" / submit silently produce blank proposals.

## Authorization

9. **Gate mutations on the server.** `canEdit` (editor+) for submit / vote / move / regenerate
   / delete / sync; `canManage` (manager+) for the audit tab; `canAdmin` (admin) for tenants
   and people. Hiding a button is a courtesy, never the boundary.
10. **Voting is editor-gated server-side and hidden in the UI for viewers**, who see a
    read-only count badge.
11. **Admin-only tabs 404 for everyone else** (`requireAdmin`); the audit tab requires
    manager (`requireManager`).
12. **Self-deactivation is blocked**, and the last active admin can never be deactivated.

## The drafting engine

13. **No external calls.** `lib/ai.ts` must stay pure and deterministic — no `fetch`, no
    clock, no randomness. Same input ⇒ same options.
14. **Two to three options per field, never one.** A single answer anchors the author and
    makes the machine's contribution invisible.
15. **Grounded only in the active tenant.** Areas, keyword map and catalogue of that tenant
    only. A draft must never mention another tenant's name, vocabulary or stable IDs.
16. **Nothing below 12 characters.** `MIN_DRAFT_CHARS` guards the debounce and every draft
    function.
17. **Author-owned fields are never overwritten.** Typing marks the field author-owned and
    only accepted drafts are recorded in `ai_fields`.
18. **Section IDs come from the catalogue only.** The engine may propose fewer (or none),
    never invent one. Malformed keyword patterns are ignored, not fatal.
19. **Imperative vocabulary stays in sync.** Words such as `give track plan forecast schedule
    include` must remain in the `IMPERATIVES` set so live drafting and "Fill all" agree.

## Documents

20. **Git is the durable record.** Every proposal gets a vault file; approved handovers live
    in the consuming repository. A failure to write or publish is reported, never swallowed.
21. **Archive moves, it does not copy.** `vault/<tenant>/archive/` and `handovers/<tenant>/archived/`
    hold the only copy; reopening moves it back. `archived_at` is stamped on archive and
    cleared on reopen.
22. **`handover_path` describes reality.** Write it only after a successful publish or sync.
    Never set it optimistically.
23. **A publish failure blocks the stage move.** Refuse `Building` when the document cannot
    be written, and say why.
24. **Docs may not skip the pipeline.** An archived doc sets `Archived` (but never overwrites
    `Rejected`); a `Built` doc promotes exactly `Building → Built`.
25. **Handover filenames match `^ENH-[0-9]+-[a-z0-9-]+\.md$`** and carry the record-id suffix
    so re-publishing is idempotent.
26. **Intake is idempotent.** Issues are matched by the hidden `<!-- handover: path -->`
    marker; never open a second issue for the same document.

## Deployment

27. **`vercel.json` must keep `framework: nextjs`.** Without it the project is inferred as a
    static site and every build dies with `STATIC_BUILD_NO_OUT_DIR`. This is a one-line file
    that costs hours to rediscover.
28. **Serverless paths stay lazy and out of the bundle.** Vercel mounts the bundle read-only,
    so `databaseFile()`, `vaultRoot()`, `handoverMirrorRoot()` and the sync report all fall
    back to `/tmp/enhancements/*` when `VERCEL`/`AWS_LAMBDA_FUNCTION_NAME` is set. Read the
    flags *inside* the function, never in a module-level `const` — a frozen constant makes the
    behaviour untestable and invisible to env overrides.
29. **First request must be able to build the database.** `ensureBootReady()` (via
    `requireUser`) migrates, seeds when empty and `SEED_DEMO_DATA` is on, then starts the doc
    sync. Pages `await` it, so nothing renders against a half-built database.
30. **Seeding never rewrites an existing document.** `writeVaultFileIfAbsent` /
    `writeHandoverMirrorIfAbsent` exist so `db:seed` cannot churn `submitted_on` in committed
    fixtures; `seed()` reports `skipped: true` when the hub already has tenants.
31. **Warn loudly, never silently.** `runtimeWarnings()` renders a top-bar tag for a dev
    session secret, ephemeral storage and disabled publishing. A deployment must never look
    healthy while losing data or accepting forgeable cookies.

## Verification before you push

```bash
npm run typecheck     # strict, must be clean
npm test              # node:test + tsx, all green
npm run build         # never while `next dev` is running (shared .next corruption)
```

Test files: `rules` (pure helpers), `studio` (drafting engine), `auth` (scrypt, sessions,
revocation, tenant-access guard), `lifecycle` (submit → publish → archive → delete),
`docs-sync` (repo reconciliation) and `deploy` (seed idempotency, serverless paths, runtime
warnings). Files that use top-level await must be `.mts`, because
tsx compiles a plain `.ts` to CJS and CJS rejects top-level await.

Add a test for every behavioural change. If a rule above needs to change, update this file,
`docs/DECISIONS.md` and the tests in the same commit.
