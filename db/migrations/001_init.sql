-- 001_init.sql — AI-Powered Future Enhancements hub
-- Portable SQL only (no vendor extensions) so the same schema runs on node:sqlite,
-- libSQL, or any SQL file-based engine. See docs/DECISIONS.md.

CREATE TABLE IF NOT EXISTS migrations (
  id          TEXT PRIMARY KEY,
  applied_at  TEXT NOT NULL
);

-- A tenant is a connected application. Everything about it is DATA: no code deploy
-- is required in the consuming repository for it to start sending proposals here.
CREATE TABLE IF NOT EXISTS tenants (
  id              TEXT PRIMARY KEY,
  slug            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  github_repo     TEXT NOT NULL DEFAULT '',      -- "owner/repo"
  handover_dir    TEXT NOT NULL DEFAULT 'docs/enhancements',
  areas_json      TEXT NOT NULL DEFAULT '[]',    -- ["QA", "Calendar"] used to ground the AI
  keyword_map_json TEXT NOT NULL DEFAULT '{}',   -- {"audit":"QA", ...} vocabulary grounding
  colour          TEXT NOT NULL DEFAULT '#5b8cff',
  enabled         INTEGER NOT NULL DEFAULT 1,
  sort_order      INTEGER NOT NULL DEFAULT 100,
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS departments (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 100
);

-- The app's own stable IDs (tab.* / sec.*). Composite PK keeps the same stable ID
-- reusable across tenants without collisions.
CREATE TABLE IF NOT EXISTS section_catalogue (
  tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id          TEXT NOT NULL,                     -- "sec.audit-log"
  label       TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'section',   -- tab | section
  hint        TEXT NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 100,
  PRIMARY KEY (tenant_id, id)
);

-- tenant_id NULL = hub-level person (can switch tenants).
CREATE TABLE IF NOT EXISTS people (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT REFERENCES tenants(id) ON DELETE SET NULL,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'viewer',  -- viewer|editor|manager|exec|admin
  password_hash TEXT NOT NULL,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);

-- Revocation ledger for otherwise self-contained signed session cookies.
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  person_id   TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  issued_at   TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  revoked_at  TEXT
);

CREATE TABLE IF NOT EXISTS enhancements (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ref           TEXT NOT NULL,                   -- ENH-0001, sequential per tenant
  title         TEXT NOT NULL,
  brief         TEXT NOT NULL DEFAULT '',
  raw_text      TEXT NOT NULL DEFAULT '',
  requirements  TEXT NOT NULL DEFAULT '',
  impacts       TEXT NOT NULL DEFAULT '',
  expected_outcome TEXT NOT NULL DEFAULT '',
  success_criteria TEXT NOT NULL DEFAULT '',
  markdown      TEXT NOT NULL DEFAULT '',
  outcome       TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'Submitted',
  area          TEXT NOT NULL DEFAULT '',
  sections      TEXT NOT NULL DEFAULT '',        -- comma separated stable IDs
  ai_fields     TEXT NOT NULL DEFAULT '[]',      -- JSON array of AI-drafted fields
  votes         INTEGER NOT NULL DEFAULT 0,
  submitted_by  TEXT NOT NULL DEFAULT '',
  github_path   TEXT NOT NULL DEFAULT '',        -- vault file, repo relative
  handover_path TEXT NOT NULL DEFAULT '',        -- published handover doc
  archived_at   TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (tenant_id, ref)
);

CREATE TABLE IF NOT EXISTS sticky_notes (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  ai_generated INTEGER NOT NULL DEFAULT 0,
  author      TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT,
  actor       TEXT NOT NULL DEFAULT 'system',
  action      TEXT NOT NULL,
  subject     TEXT NOT NULL DEFAULT '',
  before_json TEXT,
  after_json  TEXT,
  meta        TEXT,
  at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_enhancements_tenant_status ON enhancements (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_events (at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_person ON sessions (person_id);
