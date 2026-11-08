# AI-Powered Future Enhancements

A standalone, **multi-tenant enhancement-intake platform**. Any GitHub project plugs into
it as a **data-only tenant** — no code change, no CI, no deploy in the consuming repo.
Proposals are captured with **live, local, AI-assisted drafting**, tracked through a
lifecycle, mirrored to per-tenant Markdown, and approved handovers are **published into
the consuming repository** as Markdown documents where git becomes the durable record.

```
 Next.js 15 (App Router) · React 19 · TypeScript · SQLite (node:sqlite)
 Zero runtime dependencies beyond next / react / tsx
```

---

## Quickstart

```bash
npm install
npm run db:migrate     # applies db/migrations/001_init.sql
npm run db:seed        # two demo tenants, six people, four proposals
npm run dev            # http://localhost:3000  (binds 0.0.0.0)
```

Sign in as `amara.okafor@hub.demo` / `demo1234` (hub-level admin, can switch tenants).

Optional — publish handovers for real:

```bash
cp .env.example .env
# GITHUB_TOKEN=ghp_…   (needs contents:write on the consuming repo)
```

Without a token the hub still works end to end, but **moving a proposal to `Building`
is refused** with a visible error instead of silently pretending the document exists.

### All scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | `next dev -H 0.0.0.0 -p 3000` (runs `db:embed` first) |
| `npm run build` | production build (runs `db:embed` first) |
| `npm start` | serve the production build on `0.0.0.0:3000` |
| `npm test` | `node:test` + `tsx` suite (81 tests) |
| `npm run typecheck` | `tsc --noEmit`, strict |
| `npm run db:embed` | bakes `db/migrations/*.sql` into `db/migrations.generated.ts` |
| `npm run db:migrate` | applies migrations to `DATABASE_FILE` |
| `npm run db:seed` | demo content (`SEED_DEMO_DATA=false` skips it) |
| `npm run db:reset` | drops the database and re-seeds — refuses in production |
| `npm run enhancement:sync` | reconciles repo handover docs with in-app statuses (`-- --dry-run` supported) |

---

## Demo accounts

All six accounts use the password **`demo1234`**.

| Person | Email | Role | Home | Can do |
| --- | --- | --- | --- | --- |
| Amara Okafor | `amara.okafor@hub.demo` | admin | hub | everything, tenant switcher |
| Priya Raman | `priya.raman@hub.demo` | exec | hub | audit trail, tenant switcher, read |
| Lachlan Wu | `lachlan.wu@qa.demo` | manager | QA | audit trail, edit, submit, vote |
| Sofia Marino | `sofia.marino@qa.demo` | editor | QA | submit, vote, move stages, regenerate |
| Hana Sato | `hana.sato@qa.demo` | viewer | QA | read-only (no vote button, count visible) |
| Noah Bennett | `noah.bennett@northwind.demo` | editor | Northwind | Northwind only — cross-tenant reads are refused |

Role ladder: `viewer < editor < manager < exec < admin`.
`canEdit = rank ≥ editor`, `canManage = rank ≥ manager` (audit tab), admin-only tabs 404
for everyone else.

---

## Tabs (stable IDs)

Every heading shows its stable ID. The same convention applies to the consuming app's
own sections (`tab.*` / `sec.*`), which is why a catalogue import is enough to plug an
app in.

| Tab | Stable ID | Minimum role | What it is |
| --- | --- | --- | --- |
| Overview | `tab.overview` | viewer | stage KPIs, newest proposals, publishing target |
| Studio | `tab.studio` | viewer (submit: editor) | raw textarea → nine drafted fields, per-field accept / re-roll |
| Vault | `tab.vault` | viewer (write: editor) | pipeline board, stage chips, votes, Markdown download, status moves, archive, delete |
| Handovers | `tab.handovers` | viewer (sync: editor) | repo-doc reconciliation with match badges + sync button |
| Tenants | `tab.tenants` | **admin** (404 otherwise) | add/edit tenants, areas, keyword map, catalogue import |
| People | `tab.people` | **admin** (404 otherwise) | roles, home tenant, active flag, self-deactivate guard |
| Audit | `tab.audit` | **manager** (404 otherwise) | 120 most recent events with before/after JSON |

---

## Lifecycle

```
Submitted → Reviewing → Accepted → Building → Built → Archived
                                             ↘ Rejected
```

* `Submitted` — created in the Studio; `ENH-####` allocated sequentially **per tenant**;
  the vault file is written before the response returns.
* `Building` — **publishes the handover document** to `<tenant repo>/<handover_dir>/`.
  If the publish fails, the stage does **not** move and the failure is shown.
* `Archived` — the vault file moves into `vault/<tenant>/archive/` and `archived_at` is
  stamped. Reopening moves it back.
* `Rejected` — terminal; a repo-side archived document can never overwrite it.

---

## Multi-tenancy & plug-and-play

A tenant is one row: `tenants(id, slug, name, description, github_repo, handover_dir,
areas_json, keyword_map_json, colour, enabled, sort_order)` plus its own `departments`,
`section_catalogue` (composite PK `(tenant_id, id)`) and `people`.

* **Isolation is absolute.** Every read and every mutation is tenant-scoped; cross-tenant
  access is refused and covered by tests. Hub-level `admin`/`exec` people switch tenants
  with the `feh_tenant` cookie.
* **The AI never sees another tenant's vocabulary.** The drafting engine is grounded only
  in the active tenant's areas, keyword map and catalogue.
* **The consuming repo needs no code.** Adding a tenant in the admin UI is the entire hub
  side of the integration.

Full ten-minute walkthrough: **[docs/CONNECTING-AN-APP.md](docs/CONNECTING-AN-APP.md)**.

---

## The Studio (local, deterministic AI drafting)

Paste "what needs to change" into the raw textarea. After **12 characters** a 700 ms
debounce drafts **2–3 candidate options** for **nine** fields: `title`, `brief`,
`requirements`, `impacts`, `expectedOutcome`, `successCriteria`, `sections`, `markdown`,
`outcome`.

* **Options, not answers** — you accept a draft or re-roll it; nothing is auto-applied.
* **Author words win** — typing in a field marks it author-owned and suggestions never
  overwrite it again.
* **Sections come from the tenant catalogue** (`+2` per overlapping word, `+5` for an area
  match). The engine cannot invent a stable ID.
* **Transparent** — accepted fields are recorded in `ai_fields` and echoed into the
  Markdown frontmatter, so machine-drafted text is always distinguishable from author text.
* **Local** — `lib/ai.ts` is pure rules (sentence splitting, imperative/modal vocabulary,
  FNV-1a hashing for determinism). **No external AI call is ever made**; proposal text never
  leaves the server.

---

## The vault

```
vault/
  qa-calendar/
    ENH-0001-add-quarter-over-quarter-audit-readiness-trend.md
    archive/
      ENH-0002-attach-evidence-photos-directly-from-the-audit-checklist.md
```

Frontmatter: `ref / title / status / tenant / app / submitted_by / submitted_on / area /
votes / app_sections / ai_fields / source`. The footer lists the AI-drafted fields.

The database is a working cache; **git is the durable record**. `ENHANCEMENT_VAULT_DIR`
relocates the tree (tests, CI, serverless `/tmp` — flagged as *ephemeral* in the UI).

## Handovers

Published into the consuming repo, mirrored locally under `handovers/<tenant>/` so the
feature is demonstrable without a token:

```
handovers/qa-calendar/ENH-0001-…-<record-id>.md
handovers/qa-calendar/archived/ENH-0002-…-<record-id>.md
```

Filenames match `^ENH-[0-9]+-[a-z0-9-]+\.md$` (the `-<record-id>` suffix prevents
collisions and makes re-publishing idempotent). `enhancements.handover_path` tracks the
live link.

`syncEnhancementDocs` runs **at server start** (skip with `ENHANCEMENT_DOC_SYNC=false`) and
via **`npm run enhancement:sync`**, writing `.tmp/enhancement-docs-sync.md`:

| Repo document | Effect |
| --- | --- |
| `archived/…md` with `status: Archived` | record → `Archived` (never overwrites `Rejected`) |
| `status: Building` or `Built` in active folder | record in `Building` → `Built` (never skips stages) |
| file moved | `handover_path` re-pointed, status untouched |
| ref belongs to another tenant | reported `unmatched`, never applied |

---

## GitHub automation

| Workflow | Trigger | What it does |
| --- | --- | --- |
| `ci.yml` | PRs + `main` | Node 22 → typecheck → tests → build |
| `enhancement-intake.yml` | push adding `handovers/*/ENH-*.md`, or dispatch | opens **one durable issue per document**, labelled `arena-handover`, body embeds `<!-- handover: path -->` plus a ready-to-paste Agent Mode prompt; default-branch guarded, `issues:write` |
| `archive-enhancements.yml` | merged PR | parses `Handover:` lines from the PR body (else matches changed files), archives only `Building`/`Built` docs into `archived/` with `status: "Archived"`, commits via `stefanzweifel/git-auto-commit-action@v5`, closes linked issues, writes `ARCHIVED_NAMES_FILE` |

Scripts (all `.mjs`, zero dependencies): `scripts/enhancement-intake.mjs`,
`scripts/archive-enhancements.mjs` (`PR_NUMBER` env), `scripts/close-handover-issues.mjs`.

> The hub stores what it published; it never guesses. Publish failures are recorded in the
> audit trail as `enhancement.publish_failed` and block the stage move.

---

## Configuration

See [`.env.example`](.env.example).

| Variable | Default | Purpose |
| --- | --- | --- |
| `SESSION_SECRET` | dev fallback | HMAC key for the self-contained session cookie (≥16 chars) |
| `DATABASE_FILE` | `data/enhancements.db` (`/tmp` on serverless) | SQLite file |
| `ENHANCEMENT_VAULT_DIR` | `./vault` | vault location |
| `ENHANCEMENT_HANDOVER_DIR` | `./handovers` | local handover mirror |
| `GITHUB_TOKEN` | — | Contents API writes to the consuming repo |
| `SEED_DEMO_DATA` | `true` | `false` = start with an empty hub |
| `ENHANCEMENT_DOC_SYNC` | `true` | `false` = skip the boot-time doc sync |
| `GITHUB_API_URL` | `https://api.github.com` | GitHub Enterprise / test stand-in |
| `AI_PROVIDER` | `local` | documents that drafting is local; no provider is called |

---

## Stack & structure

```
app/            routes: overview, studio, vault, handovers, tenants, people, audit, login
  actions/      "use server" mutations (auth, studio, enhancements, handovers, admin)
components/     dark shell, nav with stable IDs, UI primitives
lib/            ai.ts · rules.ts · db.ts · vault.ts · github.ts · docs-sync.ts · auth.ts …
db/             migrations/001_init.sql + generated embed
scripts/        embed-migrations, migrate, seed, reset, sync-docs-cli, intake/archive/close
tests/          node:test suites (rules, studio, auth, lifecycle, docs-sync, deploy)
handovers/      published documents, mirrored per tenant (+ archived/)
vault/          Markdown mirror of every proposal (+ archive/)
```

## Connecting your projects

An admin opens **/tenants** and finds two panels:

1. **GitHub connection** — paste a token with `Contents: read and write` (fine-grained) or
   `repo` (classic). It is verified against the API on save and encrypted at rest with a key
   derived from `SESSION_SECRET`. `GITHUB_TOKEN` from the environment always takes precedence.
2. **Your GitHub projects** — every repository the token can see, with visibility, archived
   state, last push and whether it is already a tenant. Pick one and click **Connect as
   tenant**, or paste several (`owner/name`, one per line) to connect them in one go. Each
   name is checked against the token first, so a typo is reported instead of creating a
   tenant that can never publish. Connecting creates the tenant row (name, repo,
   `docs/enhancements` handover folder) and nothing else — the consuming repository still
   needs no code, no workflow and no deploy.

The panel opens with **Test connection**, which reports the account and the *number* of
repositories the token can see — `8` where you expect `21` is the signature of a fine-grained
token scoped to selected repos. If the list is empty, the panel says why: no token in use, a token without the `repo` scope,
or an empty `GITHUB_TOKEN` variable in your hosting settings overriding the stored one. On a
serverless host a stored token lives in `/tmp`, so it is lost on the next cold start — set the
environment variable for a lasting connection.

Without a token the hub refuses every move to **Building** and says so — publishing is the
gate, not a background nicety.

## Deploying

`vercel.json` pins `framework: nextjs` — without it Vercel infers a static site and fails
the build with `STATIC_BUILD_NO_OUT_DIR`. Beyond that, nothing needs configuring to *see*
the hub: on a serverless host the database starts empty in `/tmp`, so the first request
runs migrations and (while `SEED_DEMO_DATA` is on) seeds the two demo tenants before
rendering. That state is not durable, and the top bar says so:

| Tag | Meaning |
| --- | --- |
| `dev session secret` | `SESSION_SECRET` missing/&lt;16 chars — cookies are signed with the public fallback |
| `ephemeral /tmp` | no `DATABASE_FILE` on serverless — data resets on every cold start |
| `publishing off` | no `GITHUB_TOKEN` — handover publishing cannot work, so stage moves are refused |

Point `DATABASE_FILE`, `ENHANCEMENT_VAULT_DIR` and `ENHANCEMENT_HANDOVER_DIR` at persistent
storage for real use. Verified end-to-end in serverless mode: build → `VERCEL=1 next start`
with an empty `/tmp` → login, submit, vault, handovers, role isolation all pass (19/19).

**Decisions and their rationale:** [docs/DECISIONS.md](docs/DECISIONS.md).
**Invariants a contributor must not break:** [AGENTS.md](AGENTS.md).

## Licence

See [LICENSE](LICENSE).
