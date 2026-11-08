---
ref: ENH-0002
title: Attach evidence photos directly from the audit checklist
status: Archived
tenant: qa-calendar
app: HFM QA Activity Calendar
submitted_by: lachlan.wu@qa.demo
submitted_on: "2026-09-05T13:00:21.285Z"
area: Evidence
votes: 4
app_sections:
  - sec.evidence-upload
  - sec.audit-checklist
  - tab.evidence
ai_fields:
  - brief
  - successCriteria
source: enhancements-hub/Raheelatta1984/QA-Activity-Calendar
---

# ENH-0002 — Attach evidence photos directly from the audit checklist

> Let auditors capture evidence photos straight from the checklist on a phone and attach them to the audit without going back to a laptop.

## Brief

Auditors photograph evidence on a phone, then re-upload it later from a laptop. Half the packs arrive without the field photos.

## Requirements

- Camera capture from the checklist screen
- Downscale before upload to keep packs small
- Show a thumbnail with the checklist line

## Impacts

Evidence upload and audit checklist sections; no change to existing attachment storage.

## Expected outcome

Evidence packs arrive complete, captured at the point of the audit.

## Success criteria

1. A photo can be taken and attached in under 20 seconds.
2. Files stay under 2 MB after downscaling.
3. Thumbnails appear beside the checklist line.

## Outcome

Fewer findings closed late because evidence was missing.

## App sections

- `sec.evidence-upload`
- `sec.audit-checklist`
- `tab.evidence`

## Author notes

## Evidence capture in the field

Auditors work on a phone but evidence is uploaded from a laptop afterwards.

### Requirements

- Camera capture from the checklist
- Downscale to under 2 MB
- Thumbnail beside the checklist line

---

_AI-drafted fields: brief, successCriteria. Everything else was written by lachlan.wu@qa.demo._
