# Vault

The Markdown mirror of every proposal in the hub: `vault/<tenant-slug>/ENH-####-slug.md`,
with archived proposals moved into `vault/<tenant-slug>/archive/`.

Each file carries YAML frontmatter — `ref`, `title`, `status`, `tenant`, `app`,
`submitted_by`, `submitted_on`, `area`, `votes`, `app_sections`, `ai_fields`, `source` —
and a footer listing the AI-drafted fields, so machine-drafted text is always
distinguishable from author words.

**Git is the durable record; the database is a working cache.** Re-running
`npm run db:seed` or `npm run enhancement:sync` can rebuild state from these files and the
consuming repositories.

The runtime location is configurable with `ENHANCEMENT_VAULT_DIR` (used by the test suite
and by serverless deploys, where it points at `/tmp` and the UI flags the data as
ephemeral).
