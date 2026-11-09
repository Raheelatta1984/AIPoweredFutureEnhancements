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

## Why the deployment is shaped this way

**The failure that produced these rules.** The first Vercel deploy ended in
`404 DEPLOYMENT_NOT_FOUND`. The build log looked healthy — install, migrations, `next build`,
the full route table — and then died on the last line:

```
Error: [STATIC_BUILD_NO_OUT_DIR] No Output Directory named "public" found
```

The repository had no `vercel.json`, so the project was created with `framework: null` and was
built as a **static site**. Next's real output (`.next`) was ignored and Vercel went looking
for `public/`. `vercel.json` now pins `framework: nextjs`; the file is one line and it is the
only thing that makes the deploy a Next app.

**Then the app has to survive the host.** Three paths are writable in this code (database,
vault, handover mirror) plus a report file, and a serverless bundle is read-only. Each one
already had an env override, so the fallback is the same rule everywhere: explicit override
first, `/tmp/enhancements/*` on serverless, repository path otherwise. The check is done
inside the function rather than in a module-level constant: a `const SERVERLESS = …` freezes
the first read, which makes the behaviour untestable and surprising when an env var arrives
later (tests, `next start` with `VERCEL=1`).

**And it has to be honest about it.** A hub running on `/tmp` loses every proposal when the
function recycles; a hub signing cookies with the public dev secret accepts forged sessions.
Both are invisible until they hurt. Rather than hide them, the first request bootstraps
(migrate → seed when the database is empty → doc sync) so the demo is usable immediately, and
the top bar states the three risks — `dev session secret`, `ephemeral /tmp`, `publishing off`
— as amber tags. The seed path is `writeVaultFileIfAbsent` / `writeHandoverMirrorIfAbsent`, so
booting beside a populated repository cannot rewrite a committed document.

**Why the reader also needs the committed mirror.** On serverless the mirror lives in `/tmp`
and starts empty, so the demo handovers committed under `handovers/` would vanish. Reads
union both roots (most specific first, deduped by path); writes only ever touch the writable
one. The UI therefore shows real documents on a cold deploy without pretending they are
mutable.

## Why sign-in and publishing failed on the deployed hub

Two reports — "no active account matches those credentials" for every demo account, and a
refusal on every move to **Building** — turned out to be two different kinds of bug.

**Sign-in.** `loginAction` queried `people` directly, while the bootstrap ran only from the
`/login` page and `requireUser()`. On a serverless host the login **POST** can land on an
instance that never rendered the page, and every instance starts with its own empty `/tmp`
database; the query then returns nothing and the hub blames the credentials. The action now
awaits `ensureBootReady()` first, `ensureSeed()` stops caching its own failures, and
readiness requires tenants **and** people so a half-written seed is repaired rather than
trusted. The lesson generalised: any server action that reads seeded data must be able to
build it, not assume some earlier page did.

**Publishing.** The refusal was correct but useless: `GITHUB_TOKEN` was the only accepted
source, and a host with no token has no way to get one, so the gate blocked every stage move
permanently. Tokens now come from the UI as well (`lib/github-credentials.ts`), encrypted with
AES-256-GCM under an HKDF subkey of `SESSION_SECRET` so a database dump is not a repo-write
credential. The environment variable still wins — infrastructure should be able to override
whatever an admin pasted — and undecryptable ciphertext (secret rotated) degrades to "not
configured" with an explanation instead of throwing.

**Discovery.** The obvious follow-on: if the hub holds a token that can see the account's
repositories, an operator should not have to type `owner/repo`. `listRepos()` reads
`/user/repos` and **/tenants** offers one-click connect, prefilling name and handover folder
from the repository itself. Connecting is still just a tenant row — the consuming repo gains
no code, workflow or deploy, which is the whole point of plug-and-play.

## Why "I only see one of my repositories" was not a discovery bug

`listRepos()` was correct and the token was valid: `/user/repos` returned exactly what it was
allowed to return. The report ("I have many projects on GitHub and I can only see one
repository") still needed fixing, because the screen gave the operator no way to tell a
**scoped credential** from a **broken feature** — and the honest answer, "GitHub only told us
about one", was not on the page anywhere.

The fix is to compare numbers instead of showing one:

| Number | Source | What a gap means |
| --- | --- | --- |
| repositories this token lists | `/user/repos` (paged) | what the hub can connect and publish into |
| public repositories on the profile | `/users/<owner>/repos` (`Link: rel="last"`) | what the operator expects to see |
| total GitHub reports for the credential | `Link: rel="last"` on `/user/repos` | a page cap (1000) rather than a scope |

`lib/repo-discovery.ts` turns those three into one sentence and a cause (`scoped-token`,
`no-token`, `truncated`, `failed`), and every write path uses it: **Test connection**, *Save and
verify*, a single connect, a bulk connect. A connect attempt that names an invisible repository
now returns the scope explanation with the fix, rather than "not visible to the hub's token".

Two related decisions:

**Discovery runs on request.** It used to be awaited inside the `/tenants` render, so an
unreachable GitHub API blocked the admin screen and every page view paid two round-trips. The
`feh_gh_repos` cookie records the intent (**Load my projects** / **Hide**); the list itself is
still fetched fresh on each render, never cached — a stale repository list is worse than a wait.

**The list is not a table.** Eight columns of metadata pushed the one thing an operator needs —
"is this mine, and can I connect it?" — below the fold on a phone. Repositories are cards now,
with the connect form above them and the bulk form collapsed.

**The switcher was the real screen.** The follow-up report named it exactly: the white popup
over the Overview page is the tenant switcher (`<select>` + **Switch**), and it can only list
tenants. Two tenants existed, so two rows appeared, and the honest reading of that screen —
"my repositories are missing" — was wrong in a way the UI invited. Connecting was also a
one-at-a-time `<select>`, which made "connect twenty projects" a twenty-step chore. The picker
now ticks many and connects them in one submit, and **Connect all N visible projects** (gated
on a confirmation checkbox) mirrors the token's whole repository list into tenants. The panel
also states, in the place the confusion occurred, that the top-bar switcher lists tenants only.

A note on what this cannot fix: if the token genuinely cannot see a repository, the hub cannot
connect it or publish into it either. The remedy is always on the GitHub side (repository access
on a fine-grained token, the `repo` scope on a classic one, SSO approval for an organisation) —
so the panel names it instead of retrying.

## Why the hub admin was told "only hub admins can add"

Reported after signing in as Amara (admin): connecting or adding a repository answered
*"Only hub admins can add tenants."* The account was correct, the password was correct, and
the page had just rendered as the admin. Nothing about the role was wrong.

`currentUser()` resolves the cookie against **this instance's** database, and every guard was
written as `if (!user?.canAdmin) return { error: "Only hub admins …" }`. So *any* reason the
session failed to resolve — no cookie, a rotated `SESSION_SECRET`, a deactivated account, a
revoked session, or a serverless cold start that rebuilt `/tmp` between the page render and
the form post — was reported as a permission problem. Two of those were live on Vercel:

1. **The seed used `randomUUID()`.** A rebuilt `/tmp` database gave the same demo person a
   *different* id, so a cookie minted before the cold start pointed at a person that no longer
   existed. Seeded people and tenants now use `stableId()` (readable prefix + SHA-256 tail), so
   a rebuilt database is byte-identical for the rows an identity must survive.
2. **A missing sessions row was treated as revoked.** The sessions table exists so an admin
   can revoke early — but "no row here" is the normal state on an instance that never saw the
   sign-in. `isSessionActive()` now returns false only for a row that *exists and is revoked*;
   absence is trusted, because the cookie is signed and time-boxed. `hasSessionRecord()` keeps
   the distinction available, and `/tenants` uses it to say "verified from your cookie" once.

The reporting is fixed too, and that is the part that must not regress: `requireAdminAction()`
and `requireUserAction()` return the reason (`describeSessionFailure`), so a stale cookie reads
"sign in again" and only a genuine role mismatch mentions admins. `tests/github.test.mts` fails
the build if any server action reintroduces `!user?.canAdmin`.

Verified with two processes, not one: sign in → stop the server → delete the database → start a
new process → replay the cookie. `/tenants` renders, the notice appears, adding a tenant works,
and Test connection keeps working (the in-process version of that test is invalid — an open
SQLite handle keeps serving rows from a file that was unlinked underneath it).

## Why tenants were "visible in Overview but not in Studio, Vault or Handovers"

They were: every one of those pages is scoped to `user.tenantId`, and the top-bar switcher
rendered the same two tenants on all seven routes (verified by fetching each route and reading
the markup). What differed was **how obvious it was**. Overview's title *was* the tenant name,
so the context could not be missed. Everywhere else the tenant appeared only in the top bar,
which on a phone wraps and scrolls away — and the top bar is also where an admin, having just
added a tenant on `/tenants`, is least likely to look.

The fix is presentation, and it is one component: `TenantContext` in `components/Shell.tsx`,
rendered by `PageHead` under the title on every page. It shows the active tenant as a coloured
chip, offers the others as one-click switches for accounts that may switch (`canSwitchTenant`
is unchanged — a tenant-bound person still sees exactly one tenant and no switch), and says
which action to take when nothing is selected. Overview's title became "Overview" so the tenant
is named in the same place as on every other tab.

Two traps worth recording:

* **A `<select>` is not a tenant list on a phone.** It renders one line and the rest is behind a
  native picker; a screenshot of it looks like "only one tenant exists".
* **Server actions ignore a POST without `Origin`.** `switchTenantAction` correctly redirected
  but changed nothing when driven by a harness that omitted the header; a browser always sends
  it. If a harness reports that a switch "does nothing", add `Origin` before changing code.

The regression test is structural on purpose: `tests/github.test.mts` asserts that every page
passes `user` to `PageHead`, so a new tab cannot quietly lose the context again.

## Why the chosen tenant kept "disappearing"

*"I'm losing access to my project and all the project from all the tabs is disappearing. The
project should remain selected after the switch all the time."*

Two separate faults produced one symptom.

1. **The selection cookie stored a bare id.** Every tenant is a row in the instance's SQLite
   file — on a serverless host, `/tmp`, which starts empty on a cold start. A selection made in
   the browser therefore pointed at an id that no longer existed, `resolveSession` found no
   match, and it fell back to `tenants[0]`. Nothing was logged and nothing was shown: the hub
   simply displayed a different application after every switch, which is exactly what "the
   project disappears" looks like from the outside. The cookie now carries
   `<person id>|<slug>~<id>` and resolution tries the id, then the slug. The slug is durable by
   construction — seeded tenants are re-seeded under the same slug, and re-connecting a
   repository derives it the same way — so the same application is restored even though its id
   was reissued.
2. **The tenant itself really was unstable.** Tenants created in the UI got `randomUUID()`, so
   re-adding one after a cold start produced a *new* application with a new id. Ids are now
   derived, `stableId("tenant", slug)`, matching what seeded rows already did.

Three smaller things fell out of the same report:

* **A switch always redirected to `/`.** Switching on Studio or in the Vault threw away the page
  you were reading, which reads as losing your place. The form now carries the page's path
  (`pathForSid`, derived from the stable ID `PageHead` already receives) and the action
  redirects there — validated against protocol-relative and cross-host targets.
* **Signing out wiped the preference.** It was deleted alongside the session cookie, so every
  sign-in reset the tenant. The selection is bound to a person id instead, is kept across a
  sign-out, and is ignored (not applied) when a different account signs in on that browser.
* **Nothing was ever said.** A selection that cannot be restored now sets
  `tenantNotice: "rebuilt"` and `TenantNotice` renders under the title: which tenant is missing,
  why (the instance's database was rebuilt), and where to re-add it. Silence is what made a
  data-lifecycle bug read as an authorisation bug.

**This does not make tenants durable.** They still live on one instance's `/tmp`; a cold start
still removes every tenant created in the browser. The honest fix for that is
`DATABASE_FILE` on persistent storage (the top bar keeps warning `ephemeral /tmp`), and the hub
now says what happened instead of losing the operator's selection in silence.
