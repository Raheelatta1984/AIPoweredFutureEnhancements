# Handovers

Published enhancement handovers, mirrored locally so the feature is demonstrable
without a GitHub token.

In production the hub writes these documents **into each consuming repository**
(`<github_repo>/<handover_dir>/ENH-####-slug-<record-id>.md`) through the GitHub
Contents API. This folder mirrors the same structure for the two demo tenants:

```
handovers/
  qa-calendar/
    ENH-0001-add-quarter-over-quarter-audit-readiness-trend-enh-seed-0001.md
    archived/
      ENH-0002-attach-evidence-photos-directly-from-the-audit-checklist-enh-seed-0002.md
  northwind/
```

## Rules

- Active documents sit at `<tenant>/ENH-####-slug-<record-id>.md`; archived ones move to
  `<tenant>/archived/` (the legacy `<tenant>/archive/` spelling is still read).
- Filenames match `^ENH-[0-9]+-[a-z0-9-]+\.md$`. The record-id suffix makes re-publishing
  idempotent and keeps two tenants from colliding.
- Only `Building` and `Built` frontmatter is archivable. An archived document sets
  `status: "Archived"` and is never allowed to overwrite a `Rejected` decision.
- A merged PR retires its documents with a `Handover:` line in the body — see
  `docs/CONNECTING-AN-APP.md`.

Run `npm run enhancement:sync` (add `-- --dry-run` to preview) to reconcile these documents
with in-app statuses. The report lands in `.tmp/enhancement-docs-sync.md`.
