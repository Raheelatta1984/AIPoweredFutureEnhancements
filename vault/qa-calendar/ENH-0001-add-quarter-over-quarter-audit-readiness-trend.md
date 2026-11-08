---
ref: ENH-0001
title: Add quarter-over-quarter audit readiness trend
status: Building
tenant: qa-calendar
app: HFM QA Activity Calendar
submitted_by: sofia.marino@qa.demo
submitted_on: "2026-10-21T13:00:21.282Z"
area: Reporting
votes: 3
app_sections:
  - sec.kpi-tiles
  - sec.report-export
  - tab.overview
ai_fields:
  - title
  - brief
  - requirements
source: enhancements-hub/vault
---

# ENH-0001 — Add quarter-over-quarter audit readiness trend

> We need a ready-to-use trend for audit readiness per quarter so regional managers can see whether evidence capture is improving without exporting the report every month.

## Brief

The readiness KPI tiles only show the current quarter, so trend questions are answered with a manual spreadsheet export.

## Requirements

- Show readiness % for the last four quarters on the KPI tiles
- Let a site filter narrow the trend
- Keep the export unchanged for auditors

## Impacts

Touches the KPI tiles and report export; stored audit records are unchanged.

## Expected outcome

Regional managers answer trend questions in the portal instead of in a spreadsheet.

## Success criteria

1. Trend renders for four quarters.
2. Site filter changes the series.
3. Existing export output is byte-identical.

## Outcome

Walk into the quarterly review with the trend already on screen.

## App sections

- `sec.kpi-tiles`
- `sec.report-export`
- `tab.overview`

## Author notes

## Quarter-over-quarter readiness trend

The KPI tiles currently answer "how are we going this quarter?" and nothing else. Managers export the report monthly to build the trend by hand.

### Requirements

- Four-quarter trend on the KPI tiles
- Site filter narrows the series
- Export output stays identical

---

_AI-drafted fields: title, brief, requirements. Everything else was written by sofia.marino@qa.demo._
