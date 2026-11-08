# Connecting an app in about ten minutes

This hub is **plug-and-play**. A consuming application never changes code to start sending
proposals here: it becomes a **tenant**, which is pure data. The only thing the consuming
repo needs is an agreed folder for handover documents.

Total time: ~10 minutes. No deploy, no CI, no dependency on this repo.

---

## 0. Before you start

| You need | Why |
| --- | --- |
| Hub admin access | adding tenants + people |
| The consuming repo's `owner/repo` | where handovers get published |
| A handover folder name (e.g. `docs/enhancements`) | where documents land in that repo |
| The app's area names (e.g. `Audit, Calendar, Evidence`) | grounds the drafting engine |
| The app's stable IDs (`tab.*`, `sec.*`) | so drafts can reference real sections |
| A GitHub token with `contents:write` on that repo | set as `GITHUB_TOKEN` **on the hub** |

---

## 1. Add the tenant (≈1 min)

`tab.tenants` → **Add a tenant**

| Field | Example | Notes |
| --- | --- | --- |
| App name | `HFM QA Activity Calendar` | shown everywhere |
| GitHub repo | `Raheelatta1984/QA-Activity-Calendar` | `owner/repo`, validated |
| Handover folder | `lib/future-enhancements` | created automatically on first publish |
| Description | one or two lines | shown on the overview |

The slug is derived from the name (`qa-calendar`) and is immutable-ish: it names the vault
folder and the local handover mirror.

## 2. Paste the keyword map (≈2 min)

A JSON object mapping the words your users actually type to one of the app's areas:

```json
{
  "audit": "Audit",
  "auditor": "Audit",
  "checklist": "Audit",
  "calendar": "Calendar",
  "schedule": "Calendar",
  "evidence": "Evidence",
  "dashboard": "Reporting",
  "/readiness|trend/i": "Reporting"
}
```

* Keys are matched case-insensitively as substrings.
* A key written as `/pattern/flags` is treated as a regular expression; an invalid pattern
  is **ignored**, never a crash.
* Non-string values are dropped by the normaliser.
* The engine is grounded in **this tenant's map only**, so vocabulary never leaks between
  tenants.

## 3. Import the stable-ID catalogue (≈3 min)

Paste one entry per line:

```
tab.overview | Overview | program health tiles
tab.calendar | Activity Calendar | month grid of scheduled audits
sec.audit-log | Audit log | chronological audit lifecycle events
sec.kpi-tiles | KPI tiles | readiness, overdue audits, open findings
```

`id | label | hint`. IDs must start with `tab.` or `sec.`. Existing IDs are replaced; new
ones are added. The Studio proposes sections **only** from this list, ranked by word
overlap (`+2` per word) and area match (`+5`).

> No IDs ready? Import the obvious `tab.*` entries today and add `sec.*` as the app grows.
> Drafts degrade gracefully — they simply propose fewer sections.

## 4. Add people (≈2 min)

`tab.people` → **Add a person**: name, email, initial password (≥8 chars), one of

`viewer < editor < manager < exec < admin`

and a **home tenant** (or *Hub — all tenants* for staff who switch). Give the consuming
team at least one `editor` (submit + vote + move stages) and one `manager` (audit trail).

## 5. Set the token on the hub (≈1 min)

```dotenv
GITHUB_TOKEN=ghp_…            # contents:write on the consuming repo
SESSION_SECRET=<32+ random>   # required in production
```

Restart. `tab.overview` → **Publishing target** should show *configured — publishing is
live*. While it is missing, moving a proposal to `Building` is **refused** and the refusal
is audited.

---

## 6. What the consuming repo must do — nothing

There is no SDK, no CI requirement, no schema. Two conventions only:

1. **Documents live in `<handover_dir>/ENH-####-slug.md`** with frontmatter:

   ```yaml
   ---
   ref: ENH-0001
   title: Add quarter-over-quarter audit readiness trend
   status: Building
   tenant: qa-calendar
   app: HFM QA Activity Calendar
   submitted_by: sofia.marino@qa.demo
   submitted_on: "2026-09-01T04:00:00.000Z"
   area: Reporting
   votes: 3
   app_sections:
     - sec.kpi-tiles
     - tab.overview
   ai_fields:
     - title
     - brief
   source: enhancements-hub/Raheelatta1984/QA-Activity-Calendar
   ---
   ```

2. **A merged PR retires the document** by including a marker line in its body:

   ```text
   Handover: lib/future-enhancements/ENH-0001-add-quarter-over-quarter-audit-readiness-trend-<id>.md
   ```

   One or more `Handover:` lines (comma-separated is fine). If the PR body has none, the
   workflow falls back to the handover files the PR actually changed. Only documents whose
   frontmatter says `Building` or `Built` are archived; anything else is skipped with a
   reason in the workflow log.

Then the loop closes: the archive workflow moves the file to `archived/` with
`status: "Archived"`, commits it, closes the intake issue, and the hub's next sync stamps
the proposal `Archived`.

---

## 7. Optional: give implementers a head start

`enhancement-intake.yml` opens **one issue per document** (`arena-handover` label). The body
contains the ref/tenant/status table, the requirements, and a ready-to-paste **Arena Agent
Mode** prompt:

```text
Implement the enhancement in lib/future-enhancements/ENH-0001-….md.
Ref: ENH-0001; tenant: qa-calendar.
Read the document first, keep its stated scope, touch only the app sections it lists,
and do not change unrelated behaviour.
When the work is merged, include this line in the PR body:
Handover: lib/future-enhancements/ENH-0001-….md
```

The issue body carries a hidden `<!-- handover: path -->` marker, so re-running the
workflow updates the same issue instead of opening duplicates.

## 8. Verify

```bash
# on the hub
npm run enhancement:sync -- --dry-run   # shows what would change
```

`tab.handovers` shows every mirrored document with a match badge:

| Badge | Meaning |
| --- | --- |
| `linked` | `handover_path` points at this exact file |
| `in sync` | same status on both sides, different path |
| `drifted` | document status differs from the in-app status |
| `unmatched` | no record with that ref in this tenant (refs are tenant-scoped) |

Press **Sync docs** (editor+) to apply the reconciliation.

---

## Checklist

- [ ] Tenant added with `github_repo` + `handover_dir`
- [ ] Areas defined; keyword map pasted (JSON validated)
- [ ] Catalogue imported (`tab.*` / `sec.*`)
- [ ] Editor + manager people added with home tenant
- [ ] `GITHUB_TOKEN` set on the hub; publishing target shows *live*
- [ ] One proposal submitted in the Studio; vault file visible in `vault/<slug>/`
- [ ] Proposal moved to `Building`; document appears in the consuming repo
- [ ] PR merged with a `Handover:` line; document archived and proposal stamped `Archived`
