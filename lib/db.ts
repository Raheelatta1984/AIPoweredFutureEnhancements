/**
 * Thin, dependency-free wrapper over node:sqlite (Node 22.5+).
 *
 * Two hard-won rules live here:
 *  1. node:sqlite returns rows with a NULL prototype. Passing those into a React
 *     Server Component crashes serialization ("Only plain objects ... can be passed
 *     to Client Components"). Every read therefore copies rows with `{ ...row }`.
 *  2. Bound values must be `null | number | bigint | string | Uint8Array`. JS
 *     `undefined` throws and booleans are rejected, so `normalise()` coerces.
 */
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { MIGRATIONS } from "../db/migrations.generated.ts";

export type SqlParam = string | number | bigint | boolean | null | undefined;
export type SqlValue = string | number | bigint | null;

export type Row = Record<string, SqlValue>;

const SERVERLESS =
  Boolean(process.env.VERCEL) ||
  Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME) ||
  Boolean(process.env.NETLIFY);

export function repoRoot(): string {
  // lib/ -> repo root. `process.cwd()` is the repo root in dev and in `next start`.
  return resolve(process.cwd());
}

let ephemeral = false;

/** Absolute path of the SQLite database file (env override honoured). */
export function databaseFile(): string {
  const explicit = process.env.DATABASE_FILE?.trim();
  if (explicit) return resolve(explicit);
  const root = repoRoot();
  if (SERVERLESS) {
    ephemeral = true;
    return join("/tmp", "enhancements", "enhancements.db");
  }
  return join(root, "data", "enhancements.db");
}

export function isEphemeralDatabase(): boolean {
  databaseFile();
  return ephemeral;
}

/** Cost of a truthiness check on JS booleans mapped into SQLite. */
export function normalise(params: SqlParam[] | Record<string, SqlParam>): SqlValue[] | Record<string, SqlValue> {
  const one = (v: SqlParam): SqlValue => {
    if (v === undefined || v === null) return null;
    if (typeof v === "boolean") return v ? 1 : 0;
    return v;
  };
  if (Array.isArray(params)) return params.map(one);
  const out: Record<string, SqlValue> = {};
  for (const [k, v] of Object.entries(params)) out[k] = one(v);
  return out;
}

function plain<T>(row: unknown): T {
  return { ...(row as Record<string, unknown>) } as T;
}

let db: DatabaseSync | null = null;
let migrated = false;

export function getDb(): DatabaseSync {
  if (db) return db;
  const file = databaseFile();
  mkdirSync(dirname(file), { recursive: true });
  const handle = new DatabaseSync(file);
  handle.exec("PRAGMA journal_mode = WAL;");
  handle.exec("PRAGMA foreign_keys = ON;");
  handle.exec("PRAGMA busy_timeout = 5000;");
  db = handle;
  if (!migrated) {
    migrate(handle);
    migrated = true;
  }
  return handle;
}

/** Applies embedded migrations exactly once per database (idempotent). */
export function migrate(handle: DatabaseSync = getDb()): string[] {
  handle.exec(
    "CREATE TABLE IF NOT EXISTS migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);",
  );
  const appliedRows = handle.prepare("SELECT id FROM migrations").all() as Array<{ id: string }>;
  const applied = new Set(appliedRows.map((r) => r.id));
  const ran: string[] = [];
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    handle.exec(migration.sql);
    handle
      .prepare("INSERT INTO migrations (id, applied_at) VALUES (?, ?)")
      .run(migration.id, new Date().toISOString());
    ran.push(migration.id);
  }
  return ran;
}

type Bindable = string | number | bigint | Uint8Array | null;

/** node:sqlite takes positional binds as varargs (an array is read as named params). */
function bind(params: SqlParam[] | Record<string, SqlParam>): Bindable[] | Record<string, Bindable> {
  const normalised = normalise(params);
  if (Array.isArray(normalised)) return normalised.map((v) => (v === null ? null : (v as Bindable)));
  return normalised as Record<string, Bindable>;
}

export function all<T = Row>(sql: string, params: SqlParam[] | Record<string, SqlParam> = []): T[] {
  const bound = bind(params);
  const stmt = getDb().prepare(sql);
  const rows = Array.isArray(bound)
    ? (stmt.all(...(bound as Bindable[])) as unknown[])
    : (stmt.all(bound as Record<string, Bindable>) as unknown[]);
  return rows.map((r) => plain<T>(r));
}

export function get<T = Row>(sql: string, params: SqlParam[] | Record<string, SqlParam> = []): T | null {
  const bound = bind(params);
  const stmt = getDb().prepare(sql);
  const row = Array.isArray(bound)
    ? (stmt.get(...(bound as Bindable[])) as unknown)
    : (stmt.get(bound as Record<string, Bindable>) as unknown);
  return row === undefined || row === null ? null : plain<T>(row);
}

export function run(sql: string, params: SqlParam[] | Record<string, SqlParam> = []) {
  const bound = bind(params);
  const stmt = getDb().prepare(sql);
  return Array.isArray(bound) ? stmt.run(...(bound as Bindable[])) : stmt.run(bound as Record<string, Bindable>);
}

export function exec(sql: string) {
  return getDb().exec(sql);
}

/** Runs `fn` inside an immediate transaction; rethrows on failure. */
export function transaction<T>(fn: () => T): T {
  const handle = getDb();
  handle.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    handle.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      handle.exec("ROLLBACK");
    } catch {
      /* already rolled back */
    }
    throw error;
  }
}

export function setting(key: string): string | null {
  const row = get<{ value: string }>("SELECT value FROM settings WHERE key = ?", [key]);
  return row?.value ?? null;
}

export function setSetting(key: string, value: string) {
  run(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, value],
  );
}

export function count(table: string): number {
  // Table name is internal-only (never user input); values are always bound.
  const row = get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`);
  return Number(row?.n ?? 0);
}

export function databaseExists(): boolean {
  return existsSync(databaseFile());
}

/** Closes the handle (tests + CLI scripts). */
export function closeDb() {
  if (!db) return;
  try {
    db.close();
  } finally {
    db = null;
    migrated = false;
  }
}

/** Test/CLI helper: point the singleton at a brand new file. */
export function resetConnection() {
  closeDb();
}
